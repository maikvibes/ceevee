import db, { hasTasksUpdatedAt } from '../db'
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
    let rawText = ''
    try {
      rawText = await FileParsingService.parseFile(filePath, (status) => {
        this.updateTaskStatus(taskId, status, filePath)
      })
    } catch (parseError: any) {
      console.warn('[Queue] Initial parser failed:', parseError.message)
    }

    let extractedData: any = null
    const isTextTooShort = !rawText || rawText.trim().length < 100

    if (isTextTooShort) {
      const ocrProviderRow = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'ocr_provider'").get() as any
      const ocrProvider = ocrProviderRow?.setting_value || 'none'

      if (ocrProvider !== 'none') {
        console.log(`[Queue] Text is too short. Falling back to LLM OCR with provider ${ocrProvider}`)
        this.updateTaskStatus(taskId, 'LLM OCR...', filePath)
        
        const ocrKeyRow = db.prepare("SELECT encrypted_key, iv, auth_tag FROM api_key_store WHERE provider = 'ocr'").get() as any
        
        if (ocrKeyRow) {
          const decryptedOcrKey = KeyStoreService.decrypt(ocrKeyRow.encrypted_key, ocrKeyRow.iv, ocrKeyRow.auth_tag)
          const ocrSettings = db.prepare('SELECT model, base_url FROM api_key_store WHERE provider = ?').get(ocrProvider) as { model?: string; base_url?: string } | undefined
          const ocrModel = ocrSettings?.model?.trim()
          if (!ocrModel) throw new Error(`Select and save a model for ${ocrProvider} in AI Provider Settings before using OCR.`)
          
          try {
            extractedData = await AIProcessingService.extractCandidateData(
              '',
              ocrProvider,
              decryptedOcrKey,
              ocrModel,
              filePath,
              ocrSettings?.base_url || undefined
            )
            rawText = `[Extracted via Multimodal LLM OCR (${ocrProvider} / ${ocrModel})]`
          } catch (ocrErr: any) {
            console.error('[Queue] LLM OCR Fallback failed:', ocrErr)
            throw new Error(`Standard parsing failed and LLM OCR fallback failed: ${ocrErr.message}`)
          }
        } else {
          throw new Error('Standard parsing failed. LLM OCR is enabled but API Key is not configured.')
        }
      } else {
        throw new Error('Standard parsing failed (text too short or unreadable) and no LLM OCR fallback is configured.')
      }
    }

    // 2. AI Processing
    if (!extractedData) {
      this.updateTaskStatus(taskId, 'Analyzing', filePath)
      const activeProvider = provider || 'openrouter' // Default fallback
      const keyRow = db.prepare('SELECT encrypted_key, iv, auth_tag, model, base_url FROM api_key_store WHERE provider = ?').get(activeProvider) as any
      if (!keyRow) {
        throw new Error(`API Key for ${activeProvider} not configured. Please add it in settings.`)
      }

      const decryptedKey = KeyStoreService.decrypt(keyRow.encrypted_key, keyRow.iv, keyRow.auth_tag)
      extractedData = await AIProcessingService.extractCandidateData(rawText, activeProvider, decryptedKey, keyRow.model, undefined, keyRow.base_url || undefined)
    }

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
    const updatedTimeClause = hasTasksUpdatedAt ? ', updated_at = CURRENT_TIMESTAMP' : ''
    if (errorMessage !== undefined) {
      db.prepare(`UPDATE document_tasks SET status = ?, error_message = ?${updatedTimeClause} WHERE id = ?`)
        .run(status, errorMessage, taskId)
    } else {
      db.prepare(`UPDATE document_tasks SET status = ?${updatedTimeClause} WHERE id = ?`)
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
