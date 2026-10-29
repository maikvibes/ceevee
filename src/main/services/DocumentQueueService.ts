import db, { hasTasksUpdatedAt } from '../db'
import { FileParsingService } from './FileParsingService'
import { AIProcessingService } from './AIProcessingService'
import { KeyStoreService } from './KeyStoreService'
import { NotionSyncService } from './NotionSyncService'
import { BrowserWindow } from 'electron'
import { CVVersionService, type StagedFile } from './CVVersionService'
import path from 'node:path'

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

  isProcessing(): boolean { return this.queue.pending > 0 }

  clearQueue() {
    this.queue.clear()
  }

  /**
   * Resumes unfinished tasks from the database upon startup.
   */
  async resumeUnfinishedTasks() {
    const unfinishedTasks = db.prepare(`
      SELECT * FROM document_tasks
      WHERE status != 'Complete' AND status != 'Failed' AND status != 'Warning' AND status != 'Needs Review'
    `).all() as { id: number; file_path: string; provider: string | null; candidate_id: number | null; staged_path: string | null; staged_hash: string | null; staged_size: number | null }[]

    for (const task of unfinishedTasks) {
      if (task.candidate_id !== null && db.prepare('SELECT id FROM candidates WHERE id = ?').get(task.candidate_id)) {
        this.updateTaskStatus(task.id, 'Warning', task.file_path, 'The CV was saved before processing was interrupted. Check search indexing and Notion sync.')
        continue
      }
      if (db.prepare('SELECT id FROM cv_match_reviews WHERE task_id = ?').get(task.id)) {
        this.updateTaskStatus(task.id, 'Needs Review', task.file_path)
        continue
      }
      const staged = task.staged_path && task.staged_hash && task.staged_size !== null
        ? { managedPath: task.staged_path, sourcePath: task.file_path, filename: path.basename(task.file_path), size: task.staged_size, hash: task.staged_hash }
        : undefined
      this.enqueue(task.file_path, task.id, task.provider || undefined, staged)
    }
  }

  /**
   * Adds a new document to the database queue and starts processing.
   */
  async enqueueNew(filePath: string, provider: string) {
    const staged = CVVersionService.stageFile(filePath)
    let taskId: number
    try {
      taskId = db.transaction(() => {
        db.prepare(`INSERT INTO app_settings (setting_key, setting_value) VALUES ('active_ai_provider', ?)
          ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`).run(provider)
        const result = db.prepare(`INSERT INTO document_tasks (file_path, status, provider, staged_path, staged_hash, staged_size)
          VALUES (?, 'Queued', ?, ?, ?, ?)`).run(filePath, provider, staged.managedPath, staged.hash, staged.size)
        return Number(result.lastInsertRowid)
      })()
    } catch (error) {
      CVVersionService.discardFile(staged.managedPath)
      throw error
    }
    this.notifyUI(taskId, 'Queued', filePath)
    this.enqueue(filePath, taskId, provider, staged)
  }

  async retryTask(taskId: number) {
    const task = db.prepare("SELECT * FROM document_tasks WHERE id = ? AND status = 'Failed'").get(taskId) as { file_path: string; provider: string | null; staged_path: string | null; staged_hash: string | null; staged_size: number | null } | undefined
    if (!task) throw new Error('Only failed tasks can be retried.')
    const staged = task.staged_path && task.staged_hash && task.staged_size !== null
      ? { managedPath: task.staged_path, sourcePath: task.file_path, filename: path.basename(task.file_path), size: task.staged_size, hash: task.staged_hash }
      : CVVersionService.stageFile(task.file_path)
    db.prepare("UPDATE document_tasks SET status = 'Queued', error_message = NULL, staged_path = ?, staged_hash = ?, staged_size = ? WHERE id = ?")
      .run(staged.managedPath, staged.hash, staged.size, taskId)
    this.notifyUI(taskId, 'Queued', task.file_path)
    this.enqueue(task.file_path, taskId, task.provider || undefined, staged)
  }

  private enqueue(filePath: string, taskId: number, provider?: string, staged?: StagedFile) {
    this.queue.add(async () => {
      try {
        await this.processDocument(filePath, taskId, provider, staged)
      } catch (err: any) {
        this.updateTaskStatus(taskId, 'Failed', filePath, err.message)
      }
    })
  }

  private async processDocument(filePath: string, taskId: number, provider?: string, queuedStage?: StagedFile) {
    const staged = queuedStage || CVVersionService.stageFile(filePath)
    if (!queuedStage) db.prepare('UPDATE document_tasks SET staged_path = ?, staged_hash = ?, staged_size = ? WHERE id = ?').run(staged.managedPath, staged.hash, staged.size, taskId)
    try {
      if (queuedStage) CVVersionService.validateStaged(staged)
      const existingCandidate = CVVersionService.findIdentical(staged.hash)
      if (existingCandidate !== null) {
        db.prepare('UPDATE document_tasks SET candidate_id = ?, staged_path = NULL, staged_hash = NULL, staged_size = NULL WHERE id = ?').run(existingCandidate, taskId)
        CVVersionService.discardFile(staged.managedPath)
        this.updateTaskStatus(taskId, 'Complete', filePath)
        return
      }
      const llmSetting = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'llm_ocr_enabled'").get() as { setting_value?: string } | undefined
      const alwaysSetting = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'llm_ocr_always'").get() as { setting_value?: string } | undefined
      const llmOcrEnabled = llmSetting?.setting_value !== 'false'
      const supportedFile = /\.(pdf|png|jpe?g|webp)$/i.test(filePath)
      const alwaysSendFile = llmOcrEnabled && alwaysSetting?.setting_value === 'true' && supportedFile

      this.updateTaskStatus(taskId, alwaysSendFile ? 'Analyzing document...' : 'Extracting', filePath)
      let rawText = ''
      let parseFailure = ''
      if (!alwaysSendFile) {
        try {
          rawText = await FileParsingService.parseFile(staged.managedPath, (status) => {
            this.updateTaskStatus(taskId, status, filePath)
          })
        } catch (parseError: any) {
          parseFailure = parseError.message || String(parseError)
          console.warn('[Queue] Initial parser failed:', parseFailure)
        }
      }

      const isTextTooShort = !rawText || rawText.trim().length < 100
      const sendFile = alwaysSendFile || (isTextTooShort && llmOcrEnabled && supportedFile)
      if (isTextTooShort && !sendFile) {
        const details = parseFailure ? ` Local OCR error: ${parseFailure}` : ''
        const suggestion = !llmOcrEnabled && supportedFile ? ' Enable LLM file processing in AI Provider Settings to analyze the document with your selected model.' : ''
        throw new Error(`Local text extraction could not read enough text.${details}${suggestion}`)
      }
      const savedProvider = !provider ? db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'active_ai_provider'").get() as { setting_value?: string } | undefined : undefined
      const activeProvider = provider || savedProvider?.setting_value || 'openrouter'
      const keyRow = db.prepare('SELECT encrypted_key, iv, auth_tag, model, base_url FROM api_key_store WHERE provider = ?').get(activeProvider) as { encrypted_key: string; iv: string; auth_tag: string; model: string | null; base_url: string | null } | undefined
      if (!keyRow) throw new Error(`Configure ${activeProvider} in AI Provider Settings before processing documents.`)

      const decryptedKey = KeyStoreService.decrypt(keyRow.encrypted_key, keyRow.iv, keyRow.auth_tag)
      this.updateTaskStatus(taskId, sendFile ? 'Analyzing document...' : 'Analyzing', filePath)
      let extractedData: any
      try {
        extractedData = await AIProcessingService.extractCandidateData(rawText, activeProvider, decryptedKey, keyRow.model || '', sendFile ? staged.managedPath : undefined, keyRow.base_url || undefined)
      } catch (error: any) {
        if (sendFile) throw new Error(`Could not analyze the document with ${activeProvider}. Check that the selected model supports document or image input: ${error.message}`)
        throw error
      }
      if (sendFile && !rawText.trim()) rawText = `[Document analyzed via ${activeProvider} / ${keyRow.model || 'provider default'}]`

      const outcome = CVVersionService.ingest(staged, rawText, extractedData, taskId)
      if (outcome.review) {
        this.updateTaskStatus(taskId, 'Needs Review', filePath)
        return
      }
      const newCandidateId = outcome.candidateId!
      if (outcome.duplicate) {
        this.updateTaskStatus(taskId, 'Complete', filePath)
        return
      }

      // 4. Optional semantic vector indexing
      const indexed = await CVVersionService.refreshIndex(newCandidateId)

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

      // 6. Mark Complete; failed index jobs remain queued for retry.
      if (!indexed) this.updateTaskStatus(taskId, 'Warning', filePath, 'Search indexing failed and will be retried.')
      else this.updateTaskStatus(taskId, 'Complete', filePath)
    } catch (error) {
      // The staged copy remains attached to the failed task so it can be retried.
      throw error
    }
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
