import { ipcMain } from 'electron'
import OpenAI from 'openai'
import { GoogleGenAI } from '@google/genai'
import db from '../db'
import { KeyStoreService } from '../services/KeyStoreService'
import { documentQueue } from '../services/DocumentQueueService'
import { VectorSearchService, VectorSearchSettings } from '../services/VectorSearchService'
import { openAIClientOptions } from '../services/ai/providerOptions'
import { CVVersionService } from '../services/CVVersionService'

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

        void CVVersionService.retryIndexes()
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
        if (documentQueue.isProcessing()) throw new Error('Wait for active document processing to finish before deleting all data.')
        documentQueue.clearQueue()
        const removed = CVVersionService.deleteAllData()
        await CVVersionService.retryIndexes()
        if (!removed) return { success: true, warning: 'Some managed files could not be deleted; cleanup will be retried.' }
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

    ipcMain.handle('save-api-key', async (_, params: { provider: string, key: string, model: string, baseUrl?: string }) => {
      try {
        if (KeyStoreService.isLocked()) {
          return { success: false, error: 'Keystore is locked' }
        }

        const baseUrl = params.baseUrl?.trim() || ''
        if (baseUrl) {
          const url = new URL(baseUrl)
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new Error('Base URL must be an HTTP(S) URL without credentials, query, or fragment.')
          }
        }
        const previous = db.prepare('SELECT base_url FROM api_key_store WHERE provider = ?').get(params.provider) as { base_url?: string } | undefined
        const { encryptedKey, iv, authTag } = KeyStoreService.encrypt(params.key.trim().replace(/^Bearer\s+/i, ''))
        
        const stmt = db.prepare(`
          INSERT INTO api_key_store (provider, encrypted_key, iv, auth_tag, model, base_url, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(provider) DO UPDATE SET 
            encrypted_key = excluded.encrypted_key,
            iv = excluded.iv,
            auth_tag = excluded.auth_tag,
            model = excluded.model,
            base_url = excluded.base_url,
            updated_at = CURRENT_TIMESTAMP
        `)
        
        db.transaction(() => {
          stmt.run(params.provider, encryptedKey, iv, authTag, params.model, params.baseUrl === undefined ? previous?.base_url || '' : baseUrl)
          if (params.baseUrl !== undefined && (previous?.base_url || '') !== baseUrl) {
            db.prepare('DELETE FROM ai_models WHERE provider = ?').run(params.provider)
          }
        })()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('save-provider-config', async (_, params: { provider: string; key?: string; model?: string; baseUrl?: string }) => {
      try {
        if (!['openai', 'gemini', 'anthropic', 'openrouter'].includes(params.provider)) throw new Error('Unsupported provider.')
        const baseUrl = params.baseUrl?.trim()
        if (baseUrl) {
          const url = new URL(baseUrl)
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new Error('Base URL must be an HTTP(S) URL without credentials, query, or fragment.')
          }
        }
        const previous = db.prepare('SELECT encrypted_key, iv, auth_tag, model, base_url FROM api_key_store WHERE provider = ?').get(params.provider) as { encrypted_key: string; iv: string; auth_tag: string; model: string | null; base_url: string | null } | undefined
        if ((params.key !== undefined || !previous) && KeyStoreService.isLocked()) throw new Error('Unlock the keystore to save provider settings.')
        const encrypted = params.key !== undefined || !previous
          ? KeyStoreService.encrypt((params.key || '').trim().replace(/^Bearer\s+/i, ''))
          : { encryptedKey: previous.encrypted_key, iv: previous.iv, authTag: previous.auth_tag }
        db.transaction(() => {
          db.prepare(`INSERT INTO api_key_store (provider, encrypted_key, iv, auth_tag, model, base_url, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(provider) DO UPDATE SET encrypted_key = excluded.encrypted_key, iv = excluded.iv,
              auth_tag = excluded.auth_tag, model = excluded.model, base_url = excluded.base_url, updated_at = CURRENT_TIMESTAMP`)
            .run(params.provider, encrypted.encryptedKey, encrypted.iv, encrypted.authTag, params.model ?? previous?.model ?? '', baseUrl ?? previous?.base_url ?? '')
          if (baseUrl !== undefined && baseUrl !== (previous?.base_url || '')) db.prepare('DELETE FROM ai_models WHERE provider = ?').run(params.provider)
        })()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('get-saved-provider-settings', async (_, provider: string) => {
      try {
        const row = db.prepare('SELECT model, base_url FROM api_key_store WHERE provider = ?').get(provider) as any
        // We don't return the key, only non-sensitive config
        return { success: true, data: { model: row?.model || '', baseUrl: row?.base_url || '' } }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('get-api-key', async (_, provider: string) => {
      try {
        if (KeyStoreService.isLocked()) {
          return { success: false, error: 'Keystore is locked' }
        }
        const row = db.prepare('SELECT encrypted_key, iv, auth_tag, base_url FROM api_key_store WHERE provider = ?').get(provider) as any
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
          if (KeyStoreService.isLocked()) throw new Error('Keystore is locked')
          const row = db.prepare('SELECT encrypted_key, iv, auth_tag, base_url FROM api_key_store WHERE provider = ?').get(provider) as any
          if (!row) throw new Error('Save an Anthropic API key before fetching models.')
          const apiKey = KeyStoreService.decrypt(row.encrypted_key, row.iv, row.auth_tag)
          const url = new URL(`${(row.base_url || 'https://api.anthropic.com/v1').replace(/\/+$/, '')}/models`)
          const models: Array<{ id: string; display_name?: string }> = []
          let afterId: string | undefined
          do {
            if (afterId) url.searchParams.set('after_id', afterId)
            const response = await fetch(url, { headers: { ...(apiKey ? { 'x-api-key': apiKey } : {}), 'anthropic-version': '2023-06-01' } })
            if (!response.ok) throw new Error(`Anthropic model list failed (${response.status}).`)
            const page = await response.json() as { data: Array<{ id: string; display_name?: string }>; has_more?: boolean; last_id?: string }
            models.push(...page.data)
            if (page.has_more && (!page.last_id || page.last_id === afterId)) throw new Error('Invalid Anthropic model pagination response.')
            afterId = page.has_more ? page.last_id : undefined
          } while (afterId)
          const insert = db.prepare('INSERT INTO ai_models (provider, model_id, name) VALUES (?, ?, ?) ON CONFLICT(provider, model_id) DO UPDATE SET name = excluded.name')
          db.transaction(() => {
            db.prepare('DELETE FROM ai_models WHERE provider = ?').run(provider)
            for (const model of models) insert.run(provider, model.id, model.display_name || model.id)
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
            db.prepare('DELETE FROM ai_models WHERE provider = ?').run(provider)
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

          const row = db.prepare('SELECT encrypted_key, iv, auth_tag, base_url FROM api_key_store WHERE provider = ?').get(provider) as any
          if (!row) {
            return { success: false, error: 'OpenAI API key not configured. Please save it before fetching models.' }
          }

          const apiKey = KeyStoreService.decrypt(row.encrypted_key, row.iv, row.auth_tag)
          const client = new OpenAI(openAIClientOptions(apiKey, row.base_url || undefined))
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
            db.prepare('DELETE FROM ai_models WHERE provider = ?').run(provider)
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

          const row = db.prepare('SELECT encrypted_key, iv, auth_tag, base_url FROM api_key_store WHERE provider = ?').get(provider) as any
          if (!row) {
            return { success: false, error: 'Gemini API key not configured. Please save it before fetching models.' }
          }

          const apiKey = KeyStoreService.decrypt(row.encrypted_key, row.iv, row.auth_tag)
          const client = new GoogleGenAI({ apiKey, ...(row.base_url ? { httpOptions: { baseUrl: row.base_url } } : {}) })
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
            db.prepare('DELETE FROM ai_models WHERE provider = ?').run(provider)
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

    ipcMain.handle('save-vector-search-settings', async (_, settings: Partial<VectorSearchSettings>) => {
      try {
        const data = VectorSearchService.saveSettings(settings)
        if (data.vector_search_enabled) void CVVersionService.retryIndexes()
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
