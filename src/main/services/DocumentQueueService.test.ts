import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

const mocks = vi.hoisted(() => ({
  providerSettings: { model: 'configured-model', base_url: 'http://localhost:8080' } as { model?: string; base_url?: string } | undefined,
  extract: vi.fn(),
  parse: vi.fn(async () => ''),
}))
vi.mock('../db', () => ({
  hasTasksUpdatedAt: false,
  default: {
    prepare: (sql: string) => ({
      get: () => {
        if (sql.includes("'ocr_provider'")) return { setting_value: 'gemini' }
        if (sql.includes("provider = 'ocr'")) return { encrypted_key: 'encrypted', iv: 'iv', auth_tag: 'tag' }
        if (sql.includes('SELECT model, base_url')) return mocks.providerSettings
        throw new Error(`Unexpected query: ${sql}`)
      },
      run: () => ({ lastInsertRowid: 1 })
    })
  }
}))
vi.mock('./FileParsingService', () => ({ FileParsingService: { parseFile: mocks.parse } }))
vi.mock('./AIProcessingService', () => ({ AIProcessingService: { extractCandidateData: mocks.extract } }))
vi.mock('./KeyStoreService', () => ({ KeyStoreService: { decrypt: () => 'ocr-key' } }))
vi.mock('./VectorSearchService', () => ({ VectorSearchService: { indexCandidate: vi.fn() } }))
vi.mock('./NotionSyncService', () => ({ NotionSyncService: { isAutoSyncEnabled: () => false } }))

import { DocumentQueueService } from './DocumentQueueService'

describe('OCR provider configuration', () => {
  beforeEach(() => {
    mocks.providerSettings = { model: 'configured-model', base_url: 'http://localhost:8080' }
    mocks.extract.mockReset().mockResolvedValue({ tags: [] })
  })

  it('uses the OCR provider’s saved model and endpoint', async () => {
    const path = fileURLToPath(import.meta.url)
    await (new DocumentQueueService() as any).processDocument(path, 1, 'openai')
    expect(mocks.extract).toHaveBeenCalledWith('', 'gemini', 'ocr-key', 'configured-model', path, 'http://localhost:8080')
  })

  it('explains how to configure a missing model', async () => {
    mocks.providerSettings = undefined
    await expect((new DocumentQueueService() as any).processDocument(fileURLToPath(import.meta.url), 1, 'gemini'))
      .rejects.toThrow('Select and save a model for gemini')
    expect(mocks.extract).not.toHaveBeenCalled()
  })
})
