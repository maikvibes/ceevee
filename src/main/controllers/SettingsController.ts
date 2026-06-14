import { ipcMain } from 'electron'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import db from '../db'
import { KeyStoreService } from '../services/KeyStoreService'
import { documentQueue } from '../services/DocumentQueueService'
import { VectorSearchService, VectorSearchSettings } from '../services/VectorSearchService'
import { EmbeddingProviderName } from '../services/EmbeddingProvider'

class SettingsController {
  registerHandlers() {
    ipcMain.handle('get-custom-tags', async () => {
      try {
        const tags = db.prepare('SELECT * FROM custom_tags ORDER BY category, name').all()
        return { success: true, data: tags }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('add-custom-tag', async (_, params: { name: string, category: string }) => {
      try {
        const stmt = db.prepare('INSERT INTO custom_tags (name, category) VALUES (?, ?)')
        const info = stmt.run(params.name, params.category)
        return { success: true, id: info.lastInsertRowid }
      } catch (error: any) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return { success: false, error: 'Tag already exists.' }
        }
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('delete-custom-tag', async (_, id: number) => {
      try {
        db.prepare('DELETE FROM custom_tags WHERE id = ?').run(id)
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // --- KeyStore Endpoints ---
    
    ipcMain.handle('is-keystore-locked', () => {
      return KeyStoreService.isLocked()
    })

    ipcMain.handle('unlock-keystore', async (_, password: string) => {
      try {
        await KeyStoreService.unlock(password)
        
        const row = db.prepare('SELECT encrypted_key, iv, auth_tag FROM api_key_store LIMIT 1').get() as any
        if (row) {
          try {
            KeyStoreService.decrypt(row.encrypted_key, row.iv, row.auth_tag)
          } catch (e) {
            KeyStoreService.lock()
            return { success: false, error: 'Incorrect Master Password' }
          }
        }

        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('has-saved-keys', async () => {
      try {
        const row = db.prepare('SELECT COUNT(*) as count FROM api_key_store').get() as any
        return { success: true, data: row.count > 0 }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('reset-keystore', async () => {
      try {
        KeyStoreService.lock()
        db.prepare('DELETE FROM api_key_store').run()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('delete-all-data', async () => {
      try {
        documentQueue.clearQueue()
        // Artificial delay for UX so the loading animation is visible to the user
        await new Promise(resolve => setTimeout(resolve, 800))
        
        db.transaction(() => {
          db.prepare('DELETE FROM notion_sync_history').run()
          db.prepare('DELETE FROM document_tasks').run()
          db.prepare('DELETE FROM candidates').run()
          db.prepare('DELETE FROM job_search_history').run()
        })()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('lock-keystore', async () => {
      try {
        KeyStoreService.lock()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('save-api-key', async (_, params: { provider: string, key: string, model: string }) => {
      try {
        if (KeyStoreService.isLocked()) {
          return { success: false, error: 'Keystore is locked' }
        }

        const { encryptedKey, iv, authTag } = KeyStoreService.encrypt(params.key.trim().replace(/^Bearer\s+/i, ''))
        
        const stmt = db.prepare(`
          INSERT INTO api_key_store (provider, encrypted_key, iv, auth_tag, model, updated_at) 
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(provider) DO UPDATE SET 
            encrypted_key = excluded.encrypted_key,
            iv = excluded.iv,
            auth_tag = excluded.auth_tag,
            model = excluded.model,
            updated_at = CURRENT_TIMESTAMP
        `)
        
        stmt.run(params.provider, encryptedKey, iv, authTag, params.model)
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('get-saved-provider-settings', async (_, provider: string) => {
      try {
        const row = db.prepare('SELECT model FROM api_key_store WHERE provider = ?').get(provider) as any
        // We don't return the key, only non-sensitive config
        return { success: true, data: { model: row?.model || '' } }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('get-api-key', async (_, provider: string) => {
      try {
        if (KeyStoreService.isLocked()) {
          return { success: false, error: 'Keystore is locked' }
        }
        const row = db.prepare('SELECT encrypted_key, iv, auth_tag FROM api_key_store WHERE provider = ?').get(provider) as any
        if (!row) return { success: true, data: '' }
        
        const decryptedKey = KeyStoreService.decrypt(row.encrypted_key, row.iv, row.auth_tag)
        return { success: true, data: decryptedKey }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('get-models', async (_, provider: string) => {
      try {
        const models = db.prepare('SELECT model_id, name FROM ai_models WHERE provider = ? ORDER BY name').all(provider)
        return { success: true, data: models }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('fetch-models', async (_, provider: string) => {
      try {
        if (provider === 'anthropic') {
          // Anthropic doesn't have an endpoint, seed manually
          const standardModels = [
            { id: 'claude-3-5-sonnet-20240620', name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }
          ]
          const insert = db.prepare('INSERT OR IGNORE INTO ai_models (provider, model_id, name) VALUES (?, ?, ?)')
          db.transaction(() => {
            for (const m of standardModels) insert.run(provider, m.id, m.name)
          })()
          return { success: true }
        }

        if (provider === 'openrouter') {
          const keyRow = db.prepare('SELECT encrypted_key, iv, auth_tag FROM api_key_store WHERE provider = ?').get(provider) as EncryptedKeyRow | undefined
          if (!keyRow) throw new Error('Save an OpenRouter API key before fetching models.')

          const { OpenRouter } = await import('@openrouter/sdk')
          const openRouter = new OpenRouter({
            apiKey: KeyStoreService.decrypt(keyRow.encrypted_key, keyRow.iv, keyRow.auth_tag),
            httpReferer: 'http://localhost',
            appTitle: 'CeeVee',
            appCategories: 'productivity'
          })
          const data = await openRouter.models.list() as OpenRouterModelListResponse
          
          const insert = db.prepare('INSERT OR IGNORE INTO ai_models (provider, model_id, name) VALUES (?, ?, ?)')
          db.transaction(() => {
            for (const m of data.data || []) {
              insert.run(provider, m.id, m.name || m.id)
            }
          })()
          return { success: true }
        }

        if (provider === 'openai') {
          if (KeyStoreService.isLocked()) {
            return { success: false, error: 'Keystore is locked' }
          }

          const row = db.prepare('SELECT encrypted_key, iv, auth_tag FROM api_key_store WHERE provider = ?').get(provider) as any
          if (!row) {
            return { success: false, error: 'OpenAI API key not configured. Please save it before fetching models.' }
          }

          const apiKey = KeyStoreService.decrypt(row.encrypted_key, row.iv, row.auth_tag)
          const client = new OpenAI({ apiKey })
          const models: Array<{ id: string }> = []
          for await (const model of client.models.list()) {
            models.push(model)
          }

          const insert = db.prepare(`
            INSERT INTO ai_models (provider, model_id, name)
            VALUES (?, ?, ?)
            ON CONFLICT(provider, model_id) DO UPDATE SET name = excluded.name
          `)
          db.transaction(() => {
            for (const model of models) {
              insert.run(provider, model.id, model.id)
            }
          })()
          return { success: true }
        }

        if (provider === 'gemini') {
          if (KeyStoreService.isLocked()) {
            return { success: false, error: 'Keystore is locked' }
          }

          const row = db.prepare('SELECT encrypted_key, iv, auth_tag FROM api_key_store WHERE provider = ?').get(provider) as any
          if (!row) {
            return { success: false, error: 'Gemini API key not configured. Please save it before fetching models.' }
          }

          const apiKey = KeyStoreService.decrypt(row.encrypted_key, row.iv, row.auth_tag)
          const client = new GoogleGenAI({ apiKey })
          const models: Array<{ name: string, displayName?: string }> = []
          const pager = await client.models.list()
          for await (const model of pager) {
            if (model.name && model.supportedActions?.includes('generateContent')) {
              models.push({ name: model.name, displayName: model.displayName })
            }
          }

          const insert = db.prepare(`
            INSERT INTO ai_models (provider, model_id, name)
            VALUES (?, ?, ?)
            ON CONFLICT(provider, model_id) DO UPDATE SET name = excluded.name
          `)
          db.transaction(() => {
            for (const model of models) {
              insert.run(provider, model.name, model.displayName || model.name)
            }
          })()
          return { success: true }
        }
        
        return { success: false, error: 'Provider not supported for model fetching' }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // --- App Settings ---
    ipcMain.handle('get-app-setting', async (_, key: string) => {
      try {
        const row = db.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').get(key) as any
        return { success: true, value: row?.setting_value || null }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('set-app-setting', async (_, params: { key: string, value: string }) => {
      try {
        db.prepare(`
          INSERT INTO app_settings (setting_key, setting_value)
          VALUES (?, ?)
          ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
        `).run(params.key, params.value)
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('get-vector-search-status', async () => {
      try {
        const status = await VectorSearchService.getStatus()
        return { success: true, data: status }
      } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) }
      }
    })

    ipcMain.handle('test-vector-db-connection', async (_, config: unknown) => {
      try {
        const data = await VectorSearchService.testConnection(config as Partial<VectorSearchSettings>)
        return { success: true, data }
      } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) }
      }
    })

    ipcMain.handle('save-vector-search-settings', async (_, settings: Partial<VectorSearchSettings>) => {
      try {
        const data = VectorSearchService.saveSettings(settings)
        return { success: true, data }
      } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) }
      }
    })

    ipcMain.handle('reindex-candidate-vectors', async () => {
      try {
        const data = await VectorSearchService.reindexAll()
        return { success: true, data }
      } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) }
      }
    })

    ipcMain.handle('get-embedding-models', async (_, provider: EmbeddingProviderName) => {
      try {
        const data = await VectorSearchService.getEmbeddingModels(provider)
        return { success: true, data }
      } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) }
      }
    })
  }
}

export const settingsController = new SettingsController()

interface EncryptedKeyRow {
  encrypted_key: string
  iv: string
  auth_tag: string
}

interface OpenRouterModelListResponse {
  data?: { id: string; name?: string }[]
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
