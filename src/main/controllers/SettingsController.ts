import { ipcMain } from 'electron'
import db from '../db'
import { KeyStoreService } from '../services/KeyStoreService'

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
          const res = await fetch('https://openrouter.ai/api/v1/models')
          if (!res.ok) throw new Error('Failed to fetch OpenRouter models')
          const data = await res.json()
          
          const insert = db.prepare('INSERT OR IGNORE INTO ai_models (provider, model_id, name) VALUES (?, ?, ?)')
          db.transaction(() => {
            for (const m of data.data) {
              insert.run(provider, m.id, m.name)
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
  }
}

export const settingsController = new SettingsController()
