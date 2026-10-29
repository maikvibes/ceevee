import { app } from 'electron'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import db from '../db'
import { SearchableCandidate } from './CandidateSearchScoring'

const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
const DIMENSIONS = 384
type IndexStatus = 'disabled' | 'not_indexed' | 'indexing' | 'indexed' | 'stale' | 'error'
export interface VectorSearchSettings {
  vector_search_enabled: boolean
  embedding_provider: 'local'
  embedding_model: string
  embedding_dimension: number
  embedding_index_status: IndexStatus
}
interface ChunkRow { content_hash: string; embedding: Buffer; model: string; dimensions: number }
interface Candidate extends SearchableCandidate { current_cv_version_id: number | null; summary?: string | null }
interface Ranked { candidateId: number; document: string; source: string; distance: number }

class SemanticWorker {
  private worker: Worker | undefined
  private nextId = 0
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void }>()

  request<T>(payload: object): Promise<T> {
    if (!this.worker) {
      const worker = new Worker(join(__dirname, 'semantic-worker.js'), { workerData: { model: MODEL, dtype: 'q8', cacheDir: join(app.getPath('userData'), 'models'), dbPath: join(app.getPath('userData'), 'database.sqlite') } })
      this.worker = worker
      worker.on('message', (message: { id: number; result?: unknown; error?: string }) => {
        const request = this.pending.get(message.id)
        if (!request) return
        this.pending.delete(message.id)
        if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result)
      })
      const failed = (error: Error) => {
        if (this.worker !== worker) return
        this.worker = undefined
        for (const request of this.pending.values()) request.reject(error)
        this.pending.clear()
      }
      worker.on('error', failed)
      worker.on('exit', (code) => failed(new Error(`Local search worker exited (${code}).`)))
    }
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ id, ...payload })
    })
  }
}
const worker = new SemanticWorker()

export class VectorSearchService {
  private static lastError = ''

  static getSettings(): VectorSearchSettings {
    const rows = db.prepare("SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('vector_search_enabled', 'embedding_index_status')").all() as { setting_key: string; setting_value: string }[]
    const values = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]))
    const enabled = values.vector_search_enabled === 'true'
    return { vector_search_enabled: enabled, embedding_provider: 'local', embedding_model: MODEL, embedding_dimension: DIMENSIONS,
      embedding_index_status: enabled ? (values.embedding_index_status || 'not_indexed') as IndexStatus : 'disabled' }
  }

  static saveSettings(next: Partial<VectorSearchSettings>): VectorSearchSettings {
    const enabled = next.vector_search_enabled ?? this.getSettings().vector_search_enabled
    db.prepare("INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES ('vector_search_enabled', ?)").run(String(enabled))
    if (enabled && this.getSettings().embedding_index_status === 'disabled') this.setIndexStatus('not_indexed')
    return this.getSettings()
  }

  static async getStatus() {
    const settings = this.getSettings()
    const candidateCount = (db.prepare('SELECT COUNT(*) AS count FROM candidates').get() as { count: number }).count
    const indexedChunks = (db.prepare('SELECT COUNT(*) AS count FROM semantic_chunks WHERE model = ? AND dimensions = ?').get(MODEL, DIMENSIONS) as { count: number }).count
    const pending = (db.prepare('SELECT COUNT(*) AS count FROM cv_reindex_jobs').get() as { count: number }).count
    const message = !settings.vector_search_enabled ? 'Semantic search is paused.' : this.lastError || (pending ? `${settings.embedding_index_status === 'indexing' ? 'Loading the model or indexing. ' : ''}${pending} candidates waiting to index.` : 'Local index is up to date.')
    return { settings, indexedChunks, candidateCount, pending, message }
  }

  static async indexCandidate(candidateId: number, markReady = true, revision?: number): Promise<boolean> {
    if (!this.getSettings().vector_search_enabled) return false
    try {
      const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as Candidate | undefined
      if (!candidate) { await this.deleteCandidate(candidateId); return true }
      const raw = candidate.raw_text || ''
      const fromProfile = !raw.trim() || /^\s*\[Document analyzed via /i.test(raw)
      const source = fromProfile ? 'profile' : 'cv'
      const text = fromProfile ? [candidate.first_name, candidate.last_name, candidate.headline, candidate.job_type, candidate.summary, candidate.tags].filter(Boolean).join('\n') : raw
      const chunks = chunkText(text)
      const previous = db.prepare('SELECT content_hash, embedding, model, dimensions FROM semantic_chunks WHERE candidate_id = ?').all(candidateId) as ChunkRow[]
      const cached = new Map(previous.filter((row) => row.model === MODEL && row.dimensions === DIMENSIONS).map((row) => [row.content_hash, row.embedding]))
      const hashes = chunks.map((chunk) => createHash('sha256').update(chunk).digest('hex'))
      const missing = [...new Set(hashes.filter((hash) => !cached.has(hash)))]
      if (missing.length) {
        this.setIndexStatus('indexing')
        // Small batches bound memory and let the worker accept search requests between candidates.
        for (let i = 0; i < missing.length; i += 8) {
          if (!this.getSettings().vector_search_enabled) return false
          const batch = missing.slice(i, i + 8)
          const vectors = await worker.request<number[][]>({ type: 'embed', texts: batch.map((hash) => chunks[hashes.indexOf(hash)]) })
          if (vectors.length !== batch.length || vectors.some((vector) => vector.length !== DIMENSIONS || vector.some((n) => !Number.isFinite(n)))) throw new Error('Local embedding model returned an unexpected vector dimension.')
          batch.forEach((hash, index) => cached.set(hash, Buffer.from(new Float32Array(vectors[index]).buffer)))
        }
      }
      const committed = db.transaction(() => {
        const current = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as Candidate | undefined
        const job = db.prepare('SELECT revision FROM cv_reindex_jobs WHERE candidate_id = ?').get(candidateId) as { revision: number } | undefined
        if (!this.getSettings().vector_search_enabled || !current || current.current_cv_version_id !== candidate.current_cv_version_id || current.raw_text !== candidate.raw_text || current.first_name !== candidate.first_name || current.last_name !== candidate.last_name || current.job_type !== candidate.job_type || current.headline !== candidate.headline || current.summary !== candidate.summary || current.tags !== candidate.tags || (revision !== undefined && job?.revision !== revision)) return false
        db.prepare('DELETE FROM semantic_chunks WHERE candidate_id = ?').run(candidateId)
        const insert = db.prepare('INSERT INTO semantic_chunks (candidate_id, version_id, chunk_index, content_hash, document, source, model, dimensions, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        chunks.forEach((chunk, i) => insert.run(candidateId, candidate.current_cv_version_id, i, hashes[i], chunk, source, MODEL, DIMENSIONS, cached.get(hashes[i])))
        return true
      })()
      if (committed && markReady) this.setIndexStatus('indexed')
      this.lastError = ''
      return committed
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.setIndexStatus('error')
      console.error('[Local search] Indexing failed:', error)
      return false
    }
  }

  static async deleteCandidate(candidateId: number) { db.prepare('DELETE FROM semantic_chunks WHERE candidate_id = ?').run(candidateId) }

  static async reindexAll() {
    if (!this.getSettings().vector_search_enabled) throw new Error('Enable semantic search first.')
    const result = db.prepare("INSERT INTO cv_reindex_jobs (candidate_id, operation, revision) SELECT id, 'upsert', 1 FROM candidates WHERE 1 ON CONFLICT(candidate_id) DO UPDATE SET operation = 'upsert', revision = revision + 1").run()
    this.setIndexStatus('stale')
    this.lastError = ''
    const { CVVersionService } = await import('./CVVersionService')
    void CVVersionService.retryIndexes()
    return { indexedCandidates: result.changes }
  }

  static async query(text: string, limit = 12, filters: { id: string; value: string | number | boolean | null }[] = []) {
    if (!this.getSettings().vector_search_enabled) return { available: false, reason: 'Semantic search is disabled.', results: [] }
    const ready = db.prepare('SELECT 1 FROM semantic_chunks s JOIN candidates c ON c.id = s.candidate_id WHERE s.model = ? AND s.dimensions = ? AND s.version_id IS c.current_cv_version_id AND NOT EXISTS (SELECT 1 FROM cv_reindex_jobs j WHERE j.candidate_id = s.candidate_id) LIMIT 1').get(MODEL, DIMENSIONS)
    if (!ready) return { available: false, reason: 'The local semantic index is not ready yet.', results: [] }
    const [query] = await worker.request<number[][]>({ type: 'embed', texts: [text] })
    if (!query || query.length !== DIMENSIONS) throw new Error('Local embedding model returned an unexpected vector dimension.')
    const ranked = await worker.request<Ranked[]>({ type: 'rank', query, filters, limit })
    return { available: true, reason: null, results: ranked.map((row, i) => ({ ...row, id: `${row.candidateId}:${i}`, metadata: { source: row.source } })) }
  }

  private static setIndexStatus(status: IndexStatus) { db.prepare("INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES ('embedding_index_status', ?)").run(status) }
}

export function chunkText(rawText: string): string[] {
  const text = rawText.replace(/\s+/g, ' ').trim()
  if (!text) return []
  const chunks: string[] = []
  for (let i = 0; i < text.length && chunks.length < 96; i += 280) chunks.push(text.slice(i, i + 320).trim())
  return chunks
}
