import { ipcMain, dialog } from 'electron'
import db, { hasCandidatesUpdatedAt } from '../db'
import { NotionSyncService } from '../services/NotionSyncService'
import { CandidateSearchService } from '../services/CandidateSearchService'
import { CandidateSearchFilter } from '../services/CandidateSearchService'
import { CVVersionService } from '../services/CVVersionService'
import { parse } from 'json2csv'
import fs from 'fs'

async function syncVersionChange(candidateId: number): Promise<string[]> {
  const warnings: string[] = []
  if (!await CVVersionService.refreshIndex(candidateId)) warnings.push('Search indexing failed and will be retried.')
  if (NotionSyncService.isAutoSyncEnabled()) {
    try { await NotionSyncService.syncCandidate(candidateId) }
    catch (error: any) { warnings.push(`Notion sync failed: ${error.message}`) }
  }
  return warnings
}

class CandidateController {
  registerHandlers() {
    ipcMain.handle('get-candidates', async (_, params: { 
      search?: string, 
      filters?: { id: string, value: any }[],
      sorting?: { id: string, desc: boolean }[],
      offset: number, 
      limit: number 
    }) => {
      try {
        const { search, filters, sorting, offset, limit } = params
        
        let query = 'SELECT * FROM candidates WHERE 1=1'
        let countQuery = 'SELECT COUNT(*) as total FROM candidates WHERE 1=1'
        const queryParams: any[] = []

        if (search && search.trim() !== '') {
          const searchClause = ' AND (first_name LIKE ? OR last_name LIKE ? OR headline LIKE ? OR raw_text LIKE ?)'
          query += searchClause
          countQuery += searchClause
          const searchParam = `%${search}%`
          queryParams.push(searchParam, searchParam, searchParam, searchParam)
        }

        if (filters && filters.length > 0) {
          for (const f of filters) {
            if (f.id === 'tags') {
              // Special case for tags since they are JSON arrays
              query += ' AND tags LIKE ?'
              countQuery += ' AND tags LIKE ?'
              queryParams.push(`%${f.value}%`)
            } else if (f.id === 'job_type' || f.id === 'status') {
              query += ` AND ${f.id} = ?`
              countQuery += ` AND ${f.id} = ?`
              queryParams.push(f.value)
            } else if (f.id === 'location') {
              query += ' AND location = ?'
              countQuery += ' AND location = ?'
              queryParams.push(f.value)
            } else if (f.id === 'created_at_start') {
              query += ' AND date(created_at) >= date(?)'
              countQuery += ' AND date(created_at) >= date(?)'
              queryParams.push(f.value)
            } else if (f.id === 'created_at_end') {
              query += ' AND date(created_at) <= date(?)'
              countQuery += ' AND date(created_at) <= date(?)'
              queryParams.push(f.value)
            } else {
              query += ` AND ${f.id} LIKE ?`
              countQuery += ` AND ${f.id} LIKE ?`
              queryParams.push(`%${f.value}%`)
            }
          }
        }

        if (sorting && sorting.length > 0) {
          const orderClauses = sorting.map(s => {
            // Basic sanitization
            const col = s.id.replace(/[^a-zA-Z0-9_]/g, '')
            return `${col} ${s.desc ? 'DESC' : 'ASC'}`
          })
          query += ` ORDER BY ${orderClauses.join(', ')}`
        } else {
          query += ' ORDER BY created_at DESC'
        }

        query += ' LIMIT ? OFFSET ?'
        
        const stmt = db.prepare(query)
        const candidates = stmt.all(...queryParams, limit, offset)

        const countResult = db.prepare(countQuery).get(...queryParams) as { total: number }

        return { success: true, data: candidates, total: countResult.total }
      } catch (error: any) {
        console.error('[CandidateController] Error fetching candidates:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('get-candidate', async (_, id: number) => {
      try {
        const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(id)
        if (!candidate) return { success: false, error: 'Candidate not found' }
        return { success: true, data: candidate }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('get-candidate-by-filepath', async (_, filePath: string) => {
      try {
        const candidate = db.prepare(`SELECT candidate_id AS id FROM document_tasks WHERE file_path = ? AND candidate_id IS NOT NULL ORDER BY id DESC LIMIT 1`).get(filePath) || db.prepare('SELECT candidate_id AS id FROM candidate_cv_versions WHERE source_path = ? OR managed_path = ? ORDER BY id DESC LIMIT 1').get(filePath, filePath) as any
        if (!candidate) return { success: false, error: 'Candidate not found' }
        return { success: true, id: candidate.id }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('get-candidate-merge-history', async (_, candidateId: number) => {
      try { return { success: true, data: CVVersionService.listMergeHistory(candidateId) } }
      catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle('get-duplicate-candidates', async () => {
      try { return { success: true, data: CVVersionService.findDuplicateCandidates() } }
      catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle('merge-candidates', async (_, targetId: number, sourceId: number) => {
      try {
        CVVersionService.mergeCandidates(targetId, sourceId)
        const warnings: string[] = []
        if (!await CVVersionService.refreshIndex(sourceId)) warnings.push('Old search index cleanup will be retried.')
        warnings.push(...await syncVersionChange(targetId))
        return { success: true, warning: warnings.join(' ') || undefined }
      } catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle('get-cv-storage-usage', async () => {
      try { return { success: true, totalStorage: CVVersionService.storageUsage() } }
      catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle('copy-existing-cvs', async () => {
      try { const data = CVVersionService.copyExistingFiles(); void CVVersionService.retryIndexes(); return { success: true, data } }
      catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle('get-cv-versions', async (_, candidateId: number) => {
      try { return { success: true, data: CVVersionService.list(candidateId), totalStorage: CVVersionService.storageUsage() } }
      catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle('read-cv-version', async (_, candidateId: number, versionId: number) => {
      try {
        const version = CVVersionService.getVersion(candidateId, versionId)
        if (!version.managed_path || !fs.existsSync(version.managed_path)) throw new Error('This CV file is unavailable.')
        const data = fs.readFileSync(version.managed_path)
        return { success: true, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), filename: version.original_filename, rawText: version.raw_text || '' }
      } catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle('reset-profile-to-current-cv', async (_, candidateId: number) => {
      try {
        CVVersionService.resetProfileToCurrentCv(candidateId)
        const warnings = await syncVersionChange(candidateId)
        return { success: true, warning: warnings.join(' ') || undefined }
      } catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle('set-current-cv-version', async (_, candidateId: number, versionId: number) => {
      try {
        CVVersionService.setCurrent(candidateId, versionId)
        const warnings = await syncVersionChange(candidateId)
        return { success: true, warning: warnings.join(' ') || undefined }
      } catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle('delete-cv-version', async (_, candidateId: number, versionId: number) => {
      try {
        const result = CVVersionService.deleteVersion(candidateId, versionId)
        const warnings = await syncVersionChange(candidateId)
        if (!result.fileRemoved) warnings.push('The managed file could not be deleted. Cleanup will be retried.')
        return { success: true, warning: warnings.join(' ') || undefined }
      } catch (error: any) { return { success: false, error: error.message } }
    })

    ipcMain.handle('export-candidates-csv', async (_, params: { search?: string, status?: string, tag?: string }) => {
      try {
        const { search, status, tag } = params
        let query = 'SELECT * FROM candidates WHERE 1=1'
        const queryParams: any[] = []

        if (search && search.trim() !== '') {
          query += ' AND (first_name LIKE ? OR last_name LIKE ? OR headline LIKE ? OR raw_text LIKE ?)'
          const searchParam = `%${search}%`
          queryParams.push(searchParam, searchParam, searchParam, searchParam)
        }
        if (status && status !== 'all') {
          query += ' AND status = ?'
          queryParams.push(status)
        }
        if (tag && tag !== 'all') {
          query += ' AND tags LIKE ?'
          queryParams.push(`%${tag}%`)
        }

        query += ' ORDER BY created_at DESC'
        const candidates = db.prepare(query).all(...queryParams) as any[]

        if (candidates.length === 0) {
          return { success: false, error: 'No candidates found to export' }
        }

        // Format data
        const dataToExport = candidates.map(c => ({
          ID: c.id,
          FirstName: c.first_name,
          LastName: c.last_name,
          Email: c.email,
          Phone: c.phone,
          Location: c.location,
          JobType: c.job_type,
          Status: c.status,
          Tags: JSON.parse(c.tags || '[]').join(', '),
          CreatedAt: c.created_at
        }))

        const csvString = parse(dataToExport)
        
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Export Candidates',
          defaultPath: 'candidates.csv',
          filters: [{ name: 'CSV Files', extensions: ['csv'] }]
        })

        if (canceled || !filePath) return { success: true, canceled: true }

        fs.writeFileSync(filePath, csvString, 'utf8')
        return { success: true, filePath }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sync-candidate-to-notion', async (_, id: number) => {
      try {
        return await NotionSyncService.syncCandidate(id)
      } catch (error: any) {
        console.error('[CandidateController] Notion sync failed:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('update-candidate', async (_, id: number, updates: Record<string, any>) => {
      try {
        const allowedFields = ['first_name', 'last_name', 'email', 'phone', 'location', 'job_type', 'headline', 'status']
        const setClauses: string[] = []
        const values: any[] = []
        
        for (const [key, value] of Object.entries(updates)) {
          if (allowedFields.includes(key)) {
            setClauses.push(`${key} = ?`)
            values.push(value)
          }
        }
        
        if (setClauses.length === 0) return { success: false, error: 'No valid fields to update' }
        
        const updatedTimeClause = hasCandidatesUpdatedAt ? ', updated_at = CURRENT_TIMESTAMP' : ''
        const query = `UPDATE candidates SET ${setClauses.join(', ')}${updatedTimeClause} WHERE id = ?`
        values.push(id)
        db.transaction(() => {
          db.prepare(query).run(...values)
          const row = db.prepare('SELECT manual_fields FROM candidates WHERE id = ?').get(id) as { manual_fields: string } | undefined
          if (!row) throw new Error('Candidate not found')
          let fields: string[] = []
          try { fields = JSON.parse(row.manual_fields || '[]') } catch { fields = [] }
          for (const key of Object.keys(updates)) if (allowedFields.includes(key) && key !== 'status' && !fields.includes(key)) fields.push(key)
          db.prepare('UPDATE candidates SET manual_fields = ? WHERE id = ?').run(JSON.stringify(fields), id)
          CVVersionService.markForReindex(id)
        })()
        const indexed = await CVVersionService.refreshIndex(id)
        return { success: true, warning: indexed ? undefined : 'Search indexing failed and will be retried.' }
      } catch (error: any) {
        console.error('[CandidateController] Error updating candidate:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('delete-candidate', async (_, id: number) => {
      try {
        const removed = CVVersionService.deleteCandidate(id)
        const indexed = await CVVersionService.refreshIndex(id)
        return { success: true, warning: [removed ? '' : 'Some managed files could not be deleted; cleanup will be retried.', indexed ? '' : 'Search index cleanup failed and will be retried.'].filter(Boolean).join(' ') || undefined }
      } catch (error: any) {
        console.error('[CandidateController] Error deleting candidate:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('search-candidates-for-job-description', async (_, params: {
      jobDescription: string
      filters?: CandidateSearchFilter[]
      limit?: number
      saveToHistory?: boolean
    }) => {
      try {
        const result = await CandidateSearchService.search(params)
        if (result.success && params.jobDescription.trim() && params.saveToHistory !== false) {
          const lastRow = db.prepare('SELECT job_description FROM job_search_history ORDER BY created_at DESC LIMIT 1').get() as any
          if (!lastRow || lastRow.job_description !== params.jobDescription.trim()) {
            db.prepare(`
              INSERT INTO job_search_history (job_description, filters, result_count, semantic_available)
              VALUES (?, ?, ?, ?)
            `).run(
              params.jobDescription.trim(),
              JSON.stringify(params.filters || []),
              result.data.results.length,
              result.data.semantic.available ? 1 : 0
            )
          }
        }
        return result
      } catch (error: unknown) {
        console.error('[CandidateController] Error searching candidates for JD:', error)
        return { success: false, error: getErrorMessage(error) }
      }
    })

    ipcMain.handle('get-job-search-history', async (_, limit = 20) => {
      try {
        const rows = db.prepare(`
          SELECT * FROM job_search_history
          ORDER BY created_at DESC
          LIMIT ?
        `).all(limit) as JobSearchHistoryRow[]
        return {
          success: true,
          data: rows.map((row) => ({
            ...row,
            filters: JSON.parse(row.filters || '[]'),
            semantic_available: Boolean(row.semantic_available)
          }))
        }
      } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) }
      }
    })

    ipcMain.handle('get-dashboard-stats', async () => {
      try {
        const totalCandidatesResult = db.prepare('SELECT COUNT(*) as count FROM candidates').get() as { count: number }
        const pendingResult = db.prepare("SELECT COUNT(*) as count FROM candidates WHERE status = 'Pending Review'").get() as { count: number }
        const recentResult = db.prepare("SELECT COUNT(*) as count FROM candidates WHERE created_at >= date('now', '-7 days')").get() as { count: number }

        const tasksCompleteResult = db.prepare("SELECT COUNT(*) as count FROM document_tasks WHERE status = 'Complete'").get() as { count: number }
        const tasksFailedResult = db.prepare("SELECT COUNT(*) as count FROM document_tasks WHERE status = 'Failed'").get() as { count: number }

        const pipeline = db.prepare('SELECT status, COUNT(*) as count FROM candidates GROUP BY status').all() as any[]
        const jobTypes = db.prepare('SELECT job_type, COUNT(*) as count FROM candidates GROUP BY job_type').all() as any[]
        const velocity = db.prepare("SELECT date(created_at) as date, COUNT(*) as count FROM candidates WHERE created_at >= date('now', '-30 days') GROUP BY date(created_at) ORDER BY date(created_at) ASC").all() as any[]
        
        // Skills map
        const candidatesWithTags = db.prepare('SELECT tags FROM candidates').all() as any[]
        const skillCounts: Record<string, number> = {}
        for (const c of candidatesWithTags) {
          try {
            const tags = JSON.parse(c.tags || '[]')
            for (const t of tags) {
              skillCounts[t] = (skillCounts[t] || 0) + 1
            }
          } catch (e) {}
        }
        
        const topSkills = Object.entries(skillCounts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10)

        return {
          success: true,
          data: {
            totalCandidates: totalCandidatesResult.count,
            pendingReviews: pendingResult.count,
            recentAdditions: recentResult.count,
            tasksComplete: tasksCompleteResult.count,
            tasksFailed: tasksFailedResult.count,
            pipeline,
            jobTypes: jobTypes.map(j => ({ name: j.job_type || 'Unspecified', count: j.count })),
            velocity,
            topSkills
          }
        }
      } catch (error: any) {
        console.error('[CandidateController] Error fetching dashboard stats:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('get-distinct-locations', async () => {
      try {
        const rows = db.prepare(
          `SELECT DISTINCT location FROM candidates
           WHERE location IS NOT NULL AND location != ''
           ORDER BY location ASC`
        ).all() as { location: string }[]
        return { success: true, data: rows.map(r => r.location) }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('delete-duplicate-candidates', async () => ({
      success: false,
      error: 'Automatic duplicate deletion is disabled to protect CV history. Review potential matches in the processing queue.'
    }))

  }
}

export const candidateController = new CandidateController()

interface JobSearchHistoryRow {
  id: number
  job_description: string
  filters: string
  result_count: number
  semantic_available: number
  created_at: string
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
