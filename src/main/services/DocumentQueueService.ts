import db from '../db'
import { FileParsingService } from './FileParsingService'
import { AIProcessingService } from './AIProcessingService'
import { KeyStoreService } from './KeyStoreService'
import { NotionSyncService } from './NotionSyncService'
import { BrowserWindow } from 'electron'
import { VectorSearchService } from './VectorSearchService'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PQueue = require('p-queue').default || require('p-queue')

export class DocumentQueueService {
  private queue: any
  private mainWindow: BrowserWindow | null = null

  constructor() {
    this.queue = new PQueue({ concurrency: 2 }) // Process 2 CVs in parallel
  }

  setWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  clearQueue() {
    this.queue.clear()
  }

  /**
   * Resumes unfinished tasks from the database upon startup.
   */
  async resumeUnfinishedTasks() {
    const unfinishedTasks = db.prepare(`
      SELECT * FROM document_tasks 
      WHERE status != 'Complete' AND status != 'Failed' AND status != 'Warning'
    `).all() as { id: number, file_path: string }[]

    for (const task of unfinishedTasks) {
      console.log(`[Queue] Resuming task ${task.id} for ${task.file_path}`)
      this.enqueue(task.file_path, task.id as number)
    }
  }

  /**
   * Adds a new document to the database queue and starts processing.
   */
  async enqueueNew(filePath: string, provider: string) {
    const insert = db.prepare(`
      INSERT INTO document_tasks (file_path, status)
      VALUES (?, 'Queued')
    `)
    const result = insert.run(filePath)
    const taskId = result.lastInsertRowid as number

    this.notifyUI(taskId, 'Queued', filePath)
    return this.enqueue(filePath, taskId, provider)
  }

  private enqueue(filePath: string, taskId: number, provider?: string) {
    this.queue.add(async () => {
      try {
        await this.processDocument(filePath, taskId, provider)
      } catch (err: any) {
        this.updateTaskStatus(taskId, 'Failed', filePath, err.message)
      }
    })
  }

  private async processDocument(filePath: string, taskId: number, provider?: string) {
    // 0. Size Validation
    const fs = require('fs')
    const stats = fs.statSync(filePath)
    const sizeInMB = stats.size / (1024 * 1024)
    if (sizeInMB > 20) {
      throw new Error('File exceeds 20MB limit for processing and Notion sync.')
    }

    // 1. Extract
    this.updateTaskStatus(taskId, 'Extracting', filePath)
    const rawText = await FileParsingService.parseFile(filePath, (status) => {
      this.updateTaskStatus(taskId, status, filePath)
    })

    // 2. AI Processing
    this.updateTaskStatus(taskId, 'Analyzing', filePath)

    // Fetch decrypted API Key
    const activeProvider = provider || 'openrouter' // Default fallback
    const keyRow = db.prepare('SELECT encrypted_key, iv, auth_tag, model FROM api_key_store WHERE provider = ?').get(activeProvider) as any
    if (!keyRow) {
      throw new Error(`API Key for ${activeProvider} not configured. Please add it in settings.`)
    }

    const decryptedKey = KeyStoreService.decrypt(keyRow.encrypted_key, keyRow.iv, keyRow.auth_tag)

    const extractedData = await AIProcessingService.extractCandidateData(rawText, activeProvider, decryptedKey, keyRow.model)

    // 3. Save to Candidates Table
    const insertCandidate = db.prepare(`
      INSERT INTO candidates (
        first_name, last_name, email, phone, location, job_type, headline, summary, tags, raw_text, file_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertInfo = insertCandidate.run(
      extractedData.first_name,
      extractedData.last_name,
      extractedData.email,
      extractedData.phone,
      extractedData.location,
      extractedData.job_type,
      extractedData.headline,
      extractedData.summary,
      JSON.stringify(extractedData.tags),
      rawText,
      filePath
    )
    const newCandidateId = insertInfo.lastInsertRowid as number

    // 4. Optional semantic vector indexing
    await VectorSearchService.indexCandidate(newCandidateId)

    // 5. Notion Auto-Sync
    try {
      if (NotionSyncService.isAutoSyncEnabled()) {
        await NotionSyncService.syncCandidate(newCandidateId, (progressStatus) => {
          this.updateTaskStatus(taskId, progressStatus, filePath)
        })
      }
    } catch (err: any) {
      console.error('[DocumentQueueService] Notion auto-sync failed:', err)
      this.updateTaskStatus(taskId, 'Warning', filePath, `Notion Sync Failed: ${err.message}`)
      return
    }

    // 6. Mark Complete
    this.updateTaskStatus(taskId, 'Complete', filePath)
  }

  private updateTaskStatus(taskId: number, status: string, context?: string, errorMessage?: string) {
    if (errorMessage !== undefined) {
      db.prepare(`UPDATE document_tasks SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(status, errorMessage, taskId)
    } else {
      db.prepare(`UPDATE document_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(status, taskId)
    }

    this.notifyUI(taskId, status, context, errorMessage)
  }

  private notifyUI(taskId: number, status: string, context?: string, errorMessage?: string) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('document-progress', { taskId, status, context, errorMessage })
    }
  }
}

export const documentQueue = new DocumentQueueService()
