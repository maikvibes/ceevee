import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  models: ['old-model'] as string[],
  modelList: ['new-model'] as string[],
  fail: false,
  locked: false,
  exists: true,
  saved: [] as string[],
}))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) } }))
vi.mock('openai', () => ({ default: class {
  models = { list: async function* () {
    if (mocks.fail) throw new Error('server unavailable')
    for (const id of mocks.modelList) yield { id }
  } }
} }))
vi.mock('@google/genai', () => ({ GoogleGenAI: class {} }))
vi.mock('../db', () => ({ default: {
  prepare: (sql: string) => ({
    get: () => mocks.exists ? ({ encrypted_key: 'key', iv: 'iv', auth_tag: 'tag', model: 'old-model', base_url: 'http://localhost/v1' }) : undefined,
    run: (...args: string[]) => {
      if (sql.includes('INSERT INTO api_key_store')) mocks.saved = args
      if (sql.startsWith('DELETE FROM ai_models')) mocks.models = []
      if (sql.includes('INSERT INTO ai_models')) mocks.models.push(args[1])
    },
  }),
  transaction: (fn: () => void) => fn,
} }))
vi.mock('../services/KeyStoreService', () => ({ KeyStoreService: { isLocked: () => mocks.locked, decrypt: () => '', encrypt: (key: string) => ({ encryptedKey: `encrypted:${key}`, iv: 'new-iv', authTag: 'new-tag' }) } }))
vi.mock('../services/CVVersionService', () => ({ CVVersionService: {} }))
vi.mock('../services/DocumentQueueService', () => ({ documentQueue: {} }))
vi.mock('../services/VectorSearchService', () => ({ VectorSearchService: {} }))

import { settingsController } from './SettingsController'

describe('model discovery cache', () => {
  beforeEach(() => {
    mocks.models = ['old-model']
    mocks.fail = false
    mocks.locked = false
    mocks.exists = true
    mocks.saved = []
    mocks.handlers.clear()
    settingsController.registerHandlers()
  })

  it('replaces stale models after successful discovery', async () => {
    expect(await mocks.handlers.get('fetch-models')!(null, 'openai')).toEqual({ success: true })
    expect(mocks.models).toEqual(['new-model'])
  })

  it('preserves the previous list when discovery fails', async () => {
    mocks.fail = true
    expect(await mocks.handlers.get('fetch-models')!(null, 'openai')).toMatchObject({ success: false })
    expect(mocks.models).toEqual(['old-model'])
  })
})

describe('provider autosave', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.models = ['old-model']
    mocks.locked = false
    mocks.exists = true
    mocks.saved = []
    settingsController.registerHandlers()
  })

  it('updates model and URL without changing the encrypted key, even while locked', async () => {
    mocks.locked = true
    const result = await mocks.handlers.get('save-provider-config')!(null, { provider: 'openai', model: 'new-model', baseUrl: 'http://localhost:9000/v1' })
    expect(result).toEqual({ success: true })
    expect(mocks.saved).toEqual(['openai', 'key', 'iv', 'tag', 'new-model', 'http://localhost:9000/v1'])
    expect(mocks.models).toEqual([])
  })

  it('encrypts a new key without losing saved model or URL', async () => {
    const result = await mocks.handlers.get('save-provider-config')!(null, { provider: 'openai', key: 'new-key' })
    expect(result).toEqual({ success: true })
    expect(mocks.saved).toEqual(['openai', 'encrypted:new-key', 'new-iv', 'new-tag', 'old-model', 'http://localhost/v1'])
  })

  it('keeps the previous settings when the URL is invalid', async () => {
    const result = await mocks.handlers.get('save-provider-config')!(null, { provider: 'openai', baseUrl: 'not-a-url' })
    expect(result).toMatchObject({ success: false })
    expect(mocks.saved).toEqual([])
    expect(mocks.models).toEqual(['old-model'])
  })

  it('never replaces a key while the keystore is locked', async () => {
    mocks.locked = true
    const result = await mocks.handlers.get('save-provider-config')!(null, { provider: 'openai', key: 'new-key' })
    expect(result).toMatchObject({ success: false })
    expect(mocks.saved).toEqual([])
  })

  it('requires unlock before creating a provider without a stored key', async () => {
    mocks.locked = true
    mocks.exists = false
    const result = await mocks.handlers.get('save-provider-config')!(null, { provider: 'openai', baseUrl: 'http://localhost/v1' })
    expect(result).toMatchObject({ success: false })
    expect(mocks.saved).toEqual([])
  })
})
