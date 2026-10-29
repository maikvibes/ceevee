import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { app } from 'electron'
import db, { hasCandidatesUpdatedAt } from '../db'
import { VectorSearchService } from './VectorSearchService'

const PROFILE_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'location', 'job_type', 'headline', 'summary', 'tags'] as const
const LEGACY_MANUAL_FIELDS = [...PROFILE_FIELDS]

type Profile = Record<string, any>
export type StagedFile = { managedPath: string; sourcePath: string; filename: string; size: number; hash: string }
type Version = { id: number; candidate_id: number; managed_path: string | null; source_path: string | null; original_filename: string; file_size: number | null; content_hash: string | null; raw_text: string | null; parsed_snapshot: string; created_at: string }

function normalizedName(value: unknown): string {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}
function normalizedEmail(value: unknown): string { return String(value || '').trim().toLowerCase() }
function normalizedPhone(value: unknown): string { return String(value || '').replace(/\D/g, '') }
function snapshot(profile: Profile): Profile {
  return Object.fromEntries(PROFILE_FIELDS.map((field) => [field, field === 'tags' ? (Array.isArray(profile.tags) ? profile.tags : (() => { try { return JSON.parse(profile.tags || '[]') } catch { return [] } })()) : (profile[field] || '')]))
}

export class CVVersionService {
  private static indexing = new Map<number, Promise<boolean>>()
  static get root(): string { return path.join(app.getPath('userData'), 'cv-files') }

  static stageFile(sourcePath: string, enforceLimit = true): StagedFile {
    fs.mkdirSync(this.root, { recursive: true })
    const extension = path.extname(sourcePath).toLowerCase().replace(/[^.a-z0-9]/g, '')
    const managedPath = path.join(this.root, `${randomUUID()}${extension}`)
    let created = false
    let registered = false
    try {
      const input = fs.openSync(sourcePath, 'r')
      try {
        if (enforceLimit && fs.fstatSync(input).size > 20 * 1024 * 1024) throw new Error('File exceeds 20MB limit for processing and Notion sync.')
        const output = fs.openSync(managedPath, 'wx')
        created = true
        try {
          db.prepare('INSERT INTO cv_staged_files (managed_path) VALUES (?)').run(managedPath)
          registered = true
          const hash = createHash('sha256')
          const buffer = Buffer.allocUnsafe(1024 * 1024)
          let size = 0
          for (;;) {
            const bytes = fs.readSync(input, buffer, 0, buffer.length, null)
            if (!bytes) break
            size += bytes
            if (enforceLimit && size > 20 * 1024 * 1024) throw new Error('File exceeds 20MB limit for processing and Notion sync.')
            hash.update(buffer.subarray(0, bytes))
            let written = 0
            while (written < bytes) {
              const count = fs.writeSync(output, buffer, written, bytes - written)
              if (!count) throw new Error('Could not finish copying the CV file.')
              written += count
            }
          }
          return { managedPath, sourcePath, filename: path.basename(sourcePath), size, hash: hash.digest('hex') }
        } finally { fs.closeSync(output) }
      } finally { fs.closeSync(input) }
    } catch (error) {
      if (created) {
        try {
          if (registered) this.discardFile(managedPath)
          else fs.unlinkSync(managedPath)
        } catch (cleanupError) { console.error('[CVVersion] Could not clean up a failed copy:', cleanupError) }
      }
      throw error
    }
  }

  static validateStaged(staged: StagedFile): void {
    this.assertManaged(staged.managedPath)
    const input = fs.openSync(staged.managedPath, 'r')
    try {
      const hash = createHash('sha256')
      const buffer = Buffer.allocUnsafe(1024 * 1024)
      let size = 0
      for (;;) {
        const count = fs.readSync(input, buffer, 0, buffer.length, null)
        if (!count) break
        size += count
        if (size > 20 * 1024 * 1024) throw new Error('File exceeds 20MB limit for processing and Notion sync.')
        hash.update(buffer.subarray(0, count))
      }
      if (size !== staged.size || hash.digest('hex') !== staged.hash) throw new Error('The queued managed CV copy changed or is incomplete.')
    } finally { fs.closeSync(input) }
  }

  private static assertManaged(file: string) {
    const relative = path.relative(this.root, file)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) throw new Error('Invalid managed CV path.')
  }

  static discardFile(file: string): boolean {
    this.assertManaged(file)
    // Never remove a managed file that another version or pending review still uses.
    const referenced = db.prepare(`SELECT 1 FROM candidate_cv_versions WHERE managed_path = ?
      UNION SELECT 1 FROM cv_match_reviews WHERE managed_path = ? LIMIT 1`).get(file, file)
    if (referenced) {
      db.prepare('DELETE FROM cv_file_cleanup WHERE managed_path = ?').run(file)
      db.prepare('DELETE FROM cv_staged_files WHERE managed_path = ?').run(file)
      return true
    }
    try {
      fs.unlinkSync(file)
      db.prepare('DELETE FROM cv_file_cleanup WHERE managed_path = ?').run(file)
      db.prepare('DELETE FROM cv_staged_files WHERE managed_path = ?').run(file)
      return true
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        db.prepare('DELETE FROM cv_file_cleanup WHERE managed_path = ?').run(file)
        db.prepare('DELETE FROM cv_staged_files WHERE managed_path = ?').run(file)
        return true
      }
      db.prepare('INSERT INTO cv_file_cleanup (managed_path, last_error) VALUES (?, ?) ON CONFLICT(managed_path) DO UPDATE SET last_error = excluded.last_error').run(file, error.message)
      return false
    }
  }

  private static retainStaged(file: string): void {
    db.prepare('DELETE FROM cv_staged_files WHERE managed_path = ?').run(file)
  }

  static recoverStagedFiles(): void {
    // Give other running instances and large in-progress imports ample time to finish.
    const stale = db.prepare(`SELECT managed_path FROM cv_staged_files s
      WHERE datetime(s.created_at) < datetime('now', '-1 day')
        AND NOT EXISTS (SELECT 1 FROM candidate_cv_versions v WHERE v.managed_path = s.managed_path)
        AND NOT EXISTS (SELECT 1 FROM cv_match_reviews r WHERE r.managed_path = s.managed_path)
        AND NOT EXISTS (SELECT 1 FROM document_tasks t WHERE t.staged_path = s.managed_path)`).all() as { managed_path: string }[]
    for (const file of stale) {
      try { this.discardFile(file.managed_path) } catch (error) { console.error('[CVVersion] Staging cleanup failed:', error) }
    }
  }

  static retryCleanup(): void {
    const rows = db.prepare('SELECT managed_path FROM cv_file_cleanup').all() as { managed_path: string }[]
    for (const row of rows) {
      try { this.discardFile(row.managed_path) } catch (error) { console.error('[CVVersion] Cleanup failed:', error) }
    }
  }

  static migrateLegacy(): void {
    const candidates = db.prepare(`SELECT * FROM candidates c WHERE ((c.file_path IS NOT NULL AND c.file_path != '') OR (c.raw_text IS NOT NULL AND c.raw_text != '')) AND c.current_cv_version_id IS NULL AND NOT EXISTS (SELECT 1 FROM candidate_cv_versions v WHERE v.candidate_id = c.id)`).all() as Profile[]
    for (const candidate of candidates) {
      let staged: StagedFile | undefined
      try {
        if (candidate.file_path) {
          try { staged = this.stageFile(candidate.file_path, false) } catch (error) { console.warn(`[CVVersion] Legacy file unavailable for candidate ${candidate.id}:`, error) }
        }
        db.transaction(() => {
          const result = db.prepare(`INSERT INTO candidate_cv_versions (candidate_id, original_filename, source_path, managed_path, file_size, content_hash, raw_text, parsed_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(candidate.id, candidate.file_path ? path.basename(candidate.file_path) : 'Original CV unavailable', candidate.file_path || null, staged?.managedPath || null, staged?.size ?? null, staged?.hash || null, candidate.raw_text || '', JSON.stringify(snapshot(candidate)), candidate.created_at || new Date().toISOString())
          db.prepare('UPDATE candidates SET current_cv_version_id = ?, file_path = ?, manual_fields = ? WHERE id = ?').run(result.lastInsertRowid, staged?.managedPath || null, JSON.stringify(LEGACY_MANUAL_FIELDS), candidate.id)
          this.enqueueIndex(candidate.id, 'upsert')
          if (staged) this.retainStaged(staged.managedPath)
        })()
      } catch (error) {
        if (staged) this.discardFile(staged.managedPath)
        console.error(`[CVVersion] Could not migrate candidate ${candidate.id}:`, error)
      }
    }
    this.retryCleanup()
  }

  static copyExistingFiles(): { copied: number; unavailable: number; alreadyManaged: number; totalStorage: number } {
    const existingIds = new Set((db.prepare('SELECT id FROM candidate_cv_versions').all() as { id: number }[]).map((row) => row.id))
    this.migrateLegacy()
    const versions = db.prepare('SELECT id, candidate_id, source_path, managed_path FROM candidate_cv_versions').all() as { id: number; candidate_id: number; source_path: string | null; managed_path: string | null }[]
    let copied = 0, unavailable = 0, alreadyManaged = 0
    for (const version of versions) {
      if (!existingIds.has(version.id)) {
        if (version.managed_path && fs.existsSync(version.managed_path)) copied++
        else unavailable++
        continue
      }
      if (version.managed_path && fs.existsSync(version.managed_path)) { alreadyManaged++; continue }
      if (!version.source_path) { unavailable++; continue }
      let staged: StagedFile | undefined
      try {
        staged = this.stageFile(version.source_path, false)
        const file = staged
        db.transaction(() => {
          const duplicate = db.prepare('SELECT id FROM candidate_cv_versions WHERE candidate_id = ? AND (content_hash = ? OR original_content_hash = ?) AND id != ?').get(version.candidate_id, file.hash, file.hash, version.id)
          db.prepare('UPDATE candidate_cv_versions SET managed_path = ?, file_size = ?, content_hash = ?, original_content_hash = ? WHERE id = ?')
            .run(file.managedPath, file.size, duplicate ? null : file.hash, duplicate ? file.hash : null, version.id)
          const result = db.prepare('UPDATE candidates SET file_path = ? WHERE id = ? AND current_cv_version_id = ?').run(file.managedPath, version.candidate_id, version.id)
          if (result.changes) this.enqueueIndex(version.candidate_id, 'upsert')
          this.retainStaged(file.managedPath)
        })()
        copied++
      } catch (error) {
        if (staged) this.discardFile(staged.managedPath)
        console.warn(`[CVVersion] Could not copy version ${version.id}:`, error)
        unavailable++
      }
    }
    return { copied, unavailable, alreadyManaged, totalStorage: this.storageUsage() }
  }

  private static findMatches(data: Profile): { candidateIds: number[]; exactId?: number } {
    const email = normalizedEmail(data.email)
    const nameFirst = normalizedName(data.first_name)
    const nameLast = normalizedName(data.last_name)
    const phone = normalizedPhone(data.phone)
    const rows = db.prepare('SELECT id, email, phone, first_name, last_name FROM candidates').all() as Profile[]
    const emailMatches = email ? rows.filter((row) => normalizedEmail(row.email) === email) : []
    if (emailMatches.length === 1) {
      const match = emailMatches[0]
      const first = normalizedName(match.first_name), last = normalizedName(match.last_name), oldPhone = normalizedPhone(match.phone)
      const conflict = (first && nameFirst && first !== nameFirst) || (last && nameLast && last !== nameLast) || (oldPhone && phone && oldPhone !== phone)
      if (!conflict) return { candidateIds: [match.id], exactId: match.id }
      return { candidateIds: [match.id] }
    }
    if (emailMatches.length > 1) return { candidateIds: emailMatches.map((row) => row.id) }
    const weak = rows.filter((row) => (phone && normalizedPhone(row.phone) === phone) || (nameFirst && nameLast && normalizedName(row.first_name) === nameFirst && normalizedName(row.last_name) === nameLast))
    return { candidateIds: weak.map((row) => row.id) }
  }

  static findIdentical(hash: string): number | null {
    const rows = db.prepare('SELECT DISTINCT candidate_id FROM candidate_cv_versions WHERE content_hash = ? OR original_content_hash = ?').all(hash, hash) as { candidate_id: number }[]
    return rows.length === 1 ? rows[0].candidate_id : null
  }

  static ingest(staged: StagedFile, rawText: string, data: Profile, taskId: number): { candidateId?: number; review: boolean; duplicate: boolean } {
    const identical = db.prepare('SELECT DISTINCT candidate_id FROM candidate_cv_versions WHERE content_hash = ? OR original_content_hash = ?').all(staged.hash, staged.hash) as { candidate_id: number }[]
    if (identical.length === 1) {
      db.prepare('UPDATE document_tasks SET candidate_id = ?, staged_path = NULL, staged_hash = NULL, staged_size = NULL WHERE id = ?').run(identical[0].candidate_id, taskId)
      this.discardFile(staged.managedPath)
      return { candidateId: identical[0].candidate_id, review: false, duplicate: true }
    }
    const matches = this.findMatches(data)
    if (identical.length > 1) matches.candidateIds = Array.from(new Set([...matches.candidateIds, ...identical.map((row) => row.candidate_id)]))
    if (identical.length > 1) matches.exactId = undefined
    if (!matches.exactId && matches.candidateIds.length) {
      db.transaction(() => {
        db.prepare(`INSERT INTO cv_match_reviews (task_id, source_path, managed_path, original_filename, file_size, content_hash, raw_text, parsed_snapshot, candidate_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(taskId, staged.sourcePath, staged.managedPath, staged.filename, staged.size, staged.hash, rawText, JSON.stringify(snapshot(data)), JSON.stringify(matches.candidateIds))
        this.retainStaged(staged.managedPath)
        db.prepare("UPDATE document_tasks SET status = 'Needs Review', staged_path = NULL, staged_hash = NULL, staged_size = NULL WHERE id = ?").run(taskId)
      })()
      return { review: true, duplicate: false }
    }
    const result = db.transaction(() => {
      const outcome = this.insertVersion(staged, rawText, data, matches.exactId)
      db.prepare('UPDATE document_tasks SET candidate_id = ?, staged_path = NULL, staged_hash = NULL, staged_size = NULL WHERE id = ?').run(outcome.candidateId, taskId)
      return outcome
    })()
    if (result.duplicate) this.discardFile(staged.managedPath)
    return { ...result, review: false }
  }

  private static insertVersion(staged: StagedFile, rawText: string, data: Profile, candidateId?: number): { candidateId: number; duplicate: boolean } {
    let id = candidateId
    if (id) {
      const duplicate = db.prepare('SELECT id FROM candidate_cv_versions WHERE candidate_id = ? AND (content_hash = ? OR original_content_hash = ?)').get(id, staged.hash, staged.hash)
      if (duplicate) return { candidateId: id, duplicate: true }
    } else {
      const result = db.prepare(`INSERT INTO candidates (first_name, last_name, email, phone, location, job_type, headline, summary, tags, raw_text, file_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(data.first_name || '', data.last_name || '', data.email || '', data.phone || '', data.location || '', data.job_type || '', data.headline || '', data.summary || '', JSON.stringify(Array.isArray(data.tags) ? data.tags : []), rawText, staged.managedPath)
      id = Number(result.lastInsertRowid)
    }
    const version = db.prepare(`INSERT INTO candidate_cv_versions (candidate_id, original_filename, source_path, managed_path, file_size, content_hash, raw_text, parsed_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, staged.filename, staged.sourcePath, staged.managedPath, staged.size, staged.hash, rawText, JSON.stringify(snapshot(data)))
    this.applyVersion(id, Number(version.lastInsertRowid))
    this.retainStaged(staged.managedPath)
    return { candidateId: id, duplicate: false }
  }

  private static enqueueIndex(candidateId: number, operation: 'upsert' | 'delete') {
    db.prepare(`INSERT INTO cv_reindex_jobs (candidate_id, operation, revision) VALUES (?, ?, 1)
      ON CONFLICT(candidate_id) DO UPDATE SET operation = excluded.operation, revision = revision + 1`).run(candidateId, operation)
  }

  static markForReindex(candidateId: number): void { this.enqueueIndex(candidateId, 'upsert') }

  static async refreshIndex(candidateId: number): Promise<boolean> {
    while (this.indexing.has(candidateId)) await this.indexing.get(candidateId)!.catch(() => false)
    const work = (async () => {
      const job = db.prepare('SELECT operation, revision FROM cv_reindex_jobs WHERE candidate_id = ?').get(candidateId) as { operation: string; revision: number } | undefined
      if (!job) return true
      // Paused indexing is intentional, not a failed import. Keep the job for resume.
      if (job.operation === 'upsert' && !VectorSearchService.getSettings().vector_search_enabled) return true
      try {
        const ok = job.operation === 'delete' ? (await VectorSearchService.deleteCandidate(candidateId), true) : await VectorSearchService.indexCandidate(candidateId, true, job.revision)
        if (ok) {
          db.prepare('DELETE FROM cv_reindex_jobs WHERE candidate_id = ? AND revision = ?').run(candidateId, job.revision)
          const pending = db.prepare('SELECT COUNT(*) AS count FROM cv_reindex_jobs').get() as { count: number }
          if (pending.count && VectorSearchService.getSettings().vector_search_enabled) {
            db.prepare(`INSERT INTO app_settings (setting_key, setting_value) VALUES ('embedding_index_status', 'stale')
              ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`).run()
          }
        }
        return ok
      } catch (error) {
        console.warn('[CVVersion] Search index update deferred:', error)
        return false
      }
    })()
    this.indexing.set(candidateId, work)
    try { return await work } finally { if (this.indexing.get(candidateId) === work) this.indexing.delete(candidateId) }
  }

  static async retryIndexes() {
    if (!VectorSearchService.getSettings().vector_search_enabled) return
    const jobs = db.prepare('SELECT candidate_id FROM cv_reindex_jobs').all() as { candidate_id: number }[]
    let failures = 0
    for (const job of jobs) {
      if (!VectorSearchService.getSettings().vector_search_enabled) break
      if (await this.refreshIndex(job.candidate_id)) failures = 0
      else if (++failures >= 3) break
    }
  }

  private static applyVersion(candidateId: number, versionId: number): void {
    const candidate = db.prepare('SELECT manual_fields FROM candidates WHERE id = ?').get(candidateId) as { manual_fields: string } | undefined
    const version = db.prepare('SELECT * FROM candidate_cv_versions WHERE id = ? AND candidate_id = ?').get(versionId, candidateId) as Version | undefined
    if (!candidate || !version) throw new Error('CV version not found for this candidate.')
    let manual: string[] = []
    try { manual = JSON.parse(candidate.manual_fields || '[]') } catch { manual = [...LEGACY_MANUAL_FIELDS] }
    const data = JSON.parse(version.parsed_snapshot) as Profile
    const updates = PROFILE_FIELDS.filter((field) => !manual.includes(field))
    const clauses = updates.map((field) => `${field} = ?`)
    const values = updates.map((field) => field === 'tags' ? JSON.stringify(Array.isArray(data.tags) ? data.tags : []) : (data[field] || ''))
    db.prepare(`UPDATE candidates SET ${clauses.length ? clauses.join(', ') + ', ' : ''}current_cv_version_id = ?, raw_text = ?, file_path = ?${hasCandidatesUpdatedAt ? ', updated_at = CURRENT_TIMESTAMP' : ''} WHERE id = ?`)
      .run(...values, versionId, version.raw_text || '', version.managed_path, candidateId)
    this.enqueueIndex(candidateId, 'upsert')
  }

  static list(candidateId: number) {
    const candidate = db.prepare('SELECT current_cv_version_id FROM candidates WHERE id = ?').get(candidateId) as { current_cv_version_id: number | null } | undefined
    if (!candidate) throw new Error('Candidate not found.')
    const versions = db.prepare('SELECT id, candidate_id, original_filename, source_path, managed_path, file_size, created_at, raw_text FROM candidate_cv_versions WHERE candidate_id = ? ORDER BY datetime(created_at) DESC, id DESC').all(candidateId) as Version[]
    return versions.map((version) => ({ ...version, is_current: version.id === candidate.current_cv_version_id, available: !!version.managed_path && fs.existsSync(version.managed_path) }))
  }

  static resetProfileToCurrentCv(candidateId: number): void {
    db.transaction(() => {
      const candidate = db.prepare('SELECT current_cv_version_id FROM candidates WHERE id = ?').get(candidateId) as { current_cv_version_id: number | null } | undefined
      if (!candidate?.current_cv_version_id) throw new Error('This candidate has no current CV version.')
      db.prepare("UPDATE candidates SET manual_fields = '[]' WHERE id = ?").run(candidateId)
      this.applyVersion(candidateId, candidate.current_cv_version_id)
    })()
  }

  static setCurrent(candidateId: number, versionId: number) { db.transaction(() => this.applyVersion(candidateId, versionId))() }

  static deleteVersion(candidateId: number, versionId: number) {
    let file: string | null = null
    db.transaction(() => {
      const version = db.prepare('SELECT * FROM candidate_cv_versions WHERE id = ? AND candidate_id = ?').get(versionId, candidateId) as Version | undefined
      if (!version) throw new Error('CV version not found for this candidate.')
      const candidate = db.prepare('SELECT current_cv_version_id FROM candidates WHERE id = ?').get(candidateId) as { current_cv_version_id: number | null }
      file = version.managed_path
      if (file) this.assertManaged(file)
      db.prepare('DELETE FROM candidate_cv_versions WHERE id = ?').run(versionId)
      if (candidate.current_cv_version_id === versionId) {
        const previous = db.prepare('SELECT id FROM candidate_cv_versions WHERE candidate_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1').get(candidateId) as { id: number } | undefined
        if (previous) this.applyVersion(candidateId, previous.id)
        else {
          db.prepare(`UPDATE candidates SET current_cv_version_id = NULL, raw_text = NULL, file_path = NULL${hasCandidatesUpdatedAt ? ', updated_at = CURRENT_TIMESTAMP' : ''} WHERE id = ?`).run(candidateId)
          this.enqueueIndex(candidateId, 'delete')
        }
      }
      if (file) db.prepare('INSERT OR IGNORE INTO cv_file_cleanup (managed_path) VALUES (?)').run(file)
    })()
    return { fileRemoved: file ? this.discardFile(file) : true }
  }

  static getVersion(candidateId: number, versionId: number) {
    const version = db.prepare('SELECT * FROM candidate_cv_versions WHERE id = ? AND candidate_id = ?').get(versionId, candidateId) as Version | undefined
    if (!version) throw new Error('CV version not found.')
    if (version.managed_path) this.assertManaged(version.managed_path)
    return version
  }

  static deleteCandidate(candidateId: number) {
    const files = db.prepare('SELECT managed_path FROM candidate_cv_versions WHERE candidate_id = ? AND managed_path IS NOT NULL').all(candidateId) as { managed_path: string }[]
    for (const file of files) this.assertManaged(file.managed_path)
    db.transaction(() => {
      for (const file of files) db.prepare('INSERT OR IGNORE INTO cv_file_cleanup (managed_path) VALUES (?)').run(file.managed_path)
      db.prepare('DELETE FROM notion_sync_history WHERE candidate_id = ?').run(candidateId)
      db.prepare('DELETE FROM cv_merge_history WHERE target_candidate_id = ?').run(candidateId)
      db.prepare('DELETE FROM notion_candidate_pages WHERE candidate_id = ?').run(candidateId)
      db.prepare('DELETE FROM candidate_cv_versions WHERE candidate_id = ?').run(candidateId)
      db.prepare('DELETE FROM candidates WHERE id = ?').run(candidateId)
      this.enqueueIndex(candidateId, 'delete')
    })()
    return files.map((file) => this.discardFile(file.managed_path)).every(Boolean)
  }

  static deleteAllData(): boolean {
    const files = db.prepare('SELECT managed_path FROM candidate_cv_versions WHERE managed_path IS NOT NULL UNION SELECT managed_path FROM cv_match_reviews UNION SELECT managed_path FROM cv_staged_files').all() as { managed_path: string }[]
    for (const file of files) this.assertManaged(file.managed_path)
    db.transaction(() => {
      for (const file of files) db.prepare('INSERT OR IGNORE INTO cv_file_cleanup (managed_path) VALUES (?)').run(file.managed_path)
      const candidates = db.prepare('SELECT id FROM candidates').all() as { id: number }[]
      for (const candidate of candidates) this.enqueueIndex(candidate.id, 'delete')
      db.prepare('DELETE FROM notion_sync_history').run()
      db.prepare('DELETE FROM cv_merge_history').run()
      db.prepare('DELETE FROM notion_candidate_pages').run()
      db.prepare('DELETE FROM cv_match_reviews').run()
      db.prepare('DELETE FROM candidate_cv_versions').run()
      db.prepare('DELETE FROM document_tasks').run()
      db.prepare('DELETE FROM candidates').run()
      db.prepare('DELETE FROM job_search_history').run()
    })()
    return files.map((file) => this.discardFile(file.managed_path)).every(Boolean)
  }

  static storageUsage(): number {
    if (!fs.existsSync(this.root)) return 0
    return fs.readdirSync(this.root, { withFileTypes: true }).reduce((total, entry) => {
      if (!entry.isFile()) return total
      try { return total + fs.statSync(path.join(this.root, entry.name)).size } catch { return total }
    }, 0)
  }

  static listMergeHistory(candidateId: number) {
    const rows = db.prepare('SELECT id, source_candidate_id, source_candidate_json, source_notion_json, merged_at FROM cv_merge_history WHERE target_candidate_id = ? ORDER BY id DESC').all(candidateId) as { id: number; source_candidate_id: number; source_candidate_json: string; source_notion_json: string | null; merged_at: string }[]
    return rows.map((row) => {
      const candidate = JSON.parse(row.source_candidate_json) as Profile
      const notion = row.source_notion_json ? JSON.parse(row.source_notion_json) as { page_url?: string } : null
      return { id: row.id, sourceCandidateId: row.source_candidate_id, mergedAt: row.merged_at,
        firstName: candidate.first_name || '', lastName: candidate.last_name || '', email: candidate.email || '',
        phone: candidate.phone || '', headline: candidate.headline || '', status: candidate.status || '',
        notionPageUrl: notion?.page_url || null }
    })
  }

  static findDuplicateCandidates() {
    const rows = db.prepare('SELECT id, first_name, last_name, email, phone FROM candidates ORDER BY id').all() as Profile[]
    const groups = new Map<string, Profile[]>()
    for (const row of rows) {
      const email = normalizedEmail(row.email), phone = normalizedPhone(row.phone)
      const first = normalizedName(row.first_name), last = normalizedName(row.last_name)
      const keys = [email ? `email:${email}` : '', phone ? `phone:${phone}` : '', first && last ? `name:${first}:${last}` : ''].filter(Boolean)
      for (const key of keys) groups.set(key, [...(groups.get(key) || []), row])
    }
    const pairs = new Map<string, { first: Profile; second: Profile; reasons: string[] }>()
    for (const [key, group] of groups) {
      for (let i = 0; i < group.length && pairs.size < 200; i++) for (let j = i + 1; j < group.length && pairs.size < 200; j++) {
        const pairKey = `${group[i].id}:${group[j].id}`
        const pair = pairs.get(pairKey) || { first: group[i], second: group[j], reasons: [] }
        const reason = key.split(':')[0]
        if (!pair.reasons.includes(reason)) pair.reasons.push(reason)
        pairs.set(pairKey, pair)
      }
    }
    return Array.from(pairs.values()).slice(0, 200)
  }

  static mergeCandidates(targetId: number, sourceId: number) {
    if (targetId === sourceId) throw new Error('Choose two different candidates.')
    db.transaction(() => {
      const target = db.prepare('SELECT * FROM candidates WHERE id = ?').get(targetId) as Profile | undefined
      const source = db.prepare('SELECT * FROM candidates WHERE id = ?').get(sourceId) as Profile | undefined
      if (!target || !source) throw new Error('Candidate not found.')
      const sourceNotion = db.prepare('SELECT * FROM notion_candidate_pages WHERE candidate_id = ?').get(sourceId)
      let targetNotion = db.prepare('SELECT candidate_id FROM notion_candidate_pages WHERE candidate_id = ?').get(targetId)
      if (!targetNotion) {
        const prior = db.prepare("SELECT notion_page_url FROM notion_sync_history WHERE candidate_id = ? AND status = 'Success' AND notion_page_url IS NOT NULL ORDER BY id DESC LIMIT 1").get(targetId) as { notion_page_url: string } | undefined
        if (prior) {
          const pageId = prior.notion_page_url.replace(/-/g, '').match(/([0-9a-f]{32})(?:[?#/]|$)/i)?.[1]
          if (!pageId) throw new Error('Could not identify the kept candidate?s existing Notion page; merge was not performed.')
          db.prepare('INSERT INTO notion_candidate_pages (candidate_id, page_id, page_url, synced_version_id) VALUES (?, ?, ?, NULL)').run(targetId, pageId, prior.notion_page_url)
          targetNotion = { candidate_id: targetId }
        }
      }
      db.prepare('INSERT INTO cv_merge_history (target_candidate_id, source_candidate_id, source_candidate_json, source_notion_json) VALUES (?, ?, ?, ?)')
        .run(targetId, sourceId, JSON.stringify(source), sourceNotion ? JSON.stringify(sourceNotion) : null)
      const versions = db.prepare('SELECT id, content_hash FROM candidate_cv_versions WHERE candidate_id = ? ORDER BY id').all(sourceId) as { id: number; content_hash: string | null }[]
      for (const version of versions) {
        const same = version.content_hash && db.prepare('SELECT id FROM candidate_cv_versions WHERE candidate_id = ? AND content_hash = ?').get(targetId, version.content_hash)
        if (same) db.prepare('UPDATE candidate_cv_versions SET candidate_id = ?, original_content_hash = content_hash, content_hash = NULL WHERE id = ?').run(targetId, version.id)
        else db.prepare('UPDATE candidate_cv_versions SET candidate_id = ? WHERE id = ?').run(targetId, version.id)
      }
      db.prepare('UPDATE cv_merge_history SET target_candidate_id = ? WHERE target_candidate_id = ?').run(targetId, sourceId)
      db.prepare('UPDATE notion_sync_history SET candidate_id = ? WHERE candidate_id = ?').run(targetId, sourceId)
      db.prepare('UPDATE document_tasks SET candidate_id = ? WHERE candidate_id = ?').run(targetId, sourceId)
      if (!targetNotion && sourceNotion) db.prepare('UPDATE notion_candidate_pages SET candidate_id = ? WHERE candidate_id = ?').run(targetId, sourceId)
      else db.prepare('DELETE FROM notion_candidate_pages WHERE candidate_id = ?').run(sourceId)
      const reviews = db.prepare('SELECT id, candidate_ids FROM cv_match_reviews').all() as { id: number; candidate_ids: string }[]
      for (const review of reviews) {
        const ids = JSON.parse(review.candidate_ids) as number[]
        if (ids.includes(sourceId)) db.prepare('UPDATE cv_match_reviews SET candidate_ids = ? WHERE id = ?').run(JSON.stringify(Array.from(new Set(ids.map((id) => id === sourceId ? targetId : id)))), review.id)
      }
      db.prepare('DELETE FROM candidates WHERE id = ?').run(sourceId)
      this.enqueueIndex(sourceId, 'delete')
      if (!target.current_cv_version_id && source.current_cv_version_id) this.applyVersion(targetId, source.current_cv_version_id)
    })()
  }

  static getReview(taskId: number) {
    const review = db.prepare('SELECT * FROM cv_match_reviews WHERE task_id = ?').get(taskId) as any
    if (!review) throw new Error('Review not found.')
    const candidates = (JSON.parse(review.candidate_ids) as number[]).map((id) => db.prepare('SELECT id, first_name, last_name, email, phone FROM candidates WHERE id = ?').get(id)).filter(Boolean)
    return { taskId, filename: review.original_filename, candidates, incoming: JSON.parse(review.parsed_snapshot) }
  }

  static resolveReview(taskId: number, candidateId: number | null) {
    const review = db.prepare('SELECT * FROM cv_match_reviews WHERE task_id = ?').get(taskId) as any
    if (!review) throw new Error('Review not found.')
    if (candidateId !== null && !(JSON.parse(review.candidate_ids) as number[]).includes(candidateId)) throw new Error('Candidate is not a match for this review.')
    const staged: StagedFile = { sourcePath: review.source_path, managedPath: review.managed_path, filename: review.original_filename, size: review.file_size, hash: review.content_hash }
    const result = db.transaction(() => {
      const outcome = this.insertVersion(staged, review.raw_text, JSON.parse(review.parsed_snapshot), candidateId ?? undefined)
      db.prepare('DELETE FROM cv_match_reviews WHERE task_id = ?').run(taskId)
      db.prepare("UPDATE document_tasks SET status = 'Complete', candidate_id = ?, error_message = NULL WHERE id = ?").run(outcome.candidateId, taskId)
      return outcome
    })()
    if (result.duplicate) this.discardFile(staged.managedPath)
    return result
  }
}
