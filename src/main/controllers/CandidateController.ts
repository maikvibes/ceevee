import { ipcMain, dialog } from 'electron'
import db from '../db'
import { NotionSyncService } from '../services/NotionSyncService'
import { CandidateSearchService } from '../services/CandidateSearchService'
import { CandidateSearchFilter } from '../services/CandidateSearchService'
import { VectorSearchService } from '../services/VectorSearchService'
import { parse } from 'json2csv'
import fs from 'fs'

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
        const candidate = db.prepare('SELECT id FROM candidates WHERE file_path = ? ORDER BY created_at DESC LIMIT 1').get(filePath) as any
        if (!candidate) return { success: false, error: 'Candidate not found' }
        return { success: true, id: candidate.id }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
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
      return await NotionSyncService.syncCandidate(id)
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
        
        const query = `UPDATE candidates SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        values.push(id)
        db.prepare(query).run(...values)
        return { success: true }
      } catch (error: any) {
        console.error('[CandidateController] Error updating candidate:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('delete-candidate', async (_, id: number) => {
      try {
        try {
          await VectorSearchService.deleteCandidate(id)
        } catch (error) {
          console.warn('[CandidateController] Failed to delete candidate vectors:', error)
        }
        db.prepare('DELETE FROM notion_sync_history WHERE candidate_id = ?').run(id)
        db.prepare('DELETE FROM candidates WHERE id = ?').run(id)
        return { success: true }
      } catch (error: any) {
        console.error('[CandidateController] Error deleting candidate:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('search-candidates-for-job-description', async (_, params: {
      jobDescription: string
      filters?: CandidateSearchFilter[]
      limit?: number
    }) => {
      try {
        const result = await CandidateSearchService.search(params)
        if (result.success && params.jobDescription.trim()) {
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
