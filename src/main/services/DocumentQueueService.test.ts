import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mocks = vi.hoisted(() => ({
  providerSettings: { encrypted_key: 'provider-key', iv: 'iv', auth_tag: 'tag', model: 'configured-model', base_url: 'http://localhost:8080' } as { encrypted_key: string; iv: string; auth_tag: string; model?: string; base_url?: string } | undefined,
  extract: vi.fn(),
  parse: vi.fn(async () => ''),
  selectedProvider: 'gemini',
  llmOcrEnabled: null as boolean | null,
  llmOcrAlways: false,
  queriedProvider: '',
}))
vi.mock('../db', () => ({
  hasTasksUpdatedAt: false,
  default: {
    prepare: (sql: string) => ({
      get: (provider?: string) => {
        if (sql.includes("'llm_ocr_enabled'")) return mocks.llmOcrEnabled === null ? undefined : { setting_value: String(mocks.llmOcrEnabled) }
        if (sql.includes("'llm_ocr_always'")) return mocks.llmOcrAlways ? { setting_value: 'true' } : undefined
        if (sql.includes("'active_ai_provider'")) return { setting_value: mocks.selectedProvider }
        if (sql.includes('SELECT encrypted_key, iv, auth_tag, model, base_url')) { mocks.queriedProvider = provider || ''; return mocks.providerSettings }
        throw new Error(`Unexpected query: ${sql}`)
      },
      run: () => ({ lastInsertRowid: 1 })
    })
  }
}))
vi.mock('./CVVersionService', () => ({ CVVersionService: { stageFile: (file: string) => ({ managedPath: file, sourcePath: file }), discardFile: vi.fn(), findIdentical: () => null, refreshIndex: vi.fn().mockResolvedValue(true), ingest: () => ({ candidateId: 1, review: false, duplicate: false }) } }))
vi.mock('./FileParsingService', () => ({ FileParsingService: { parseFile: mocks.parse } }))
vi.mock('./AIProcessingService', () => ({ AIProcessingService: { extractCandidateData: mocks.extract } }))
vi.mock('./KeyStoreService', () => ({ KeyStoreService: { decrypt: (key: string) => key } }))
vi.mock('./VectorSearchService', () => ({ VectorSearchService: { indexCandidate: vi.fn() } }))
vi.mock('./NotionSyncService', () => ({ NotionSyncService: { isAutoSyncEnabled: () => false } }))

import { DocumentQueueService } from './DocumentQueueService'

describe('document analysis modes', () => {
  let dir: string
  let pdf: string
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'ceevee-queue-')); pdf = join(dir, 'document.pdf'); writeFileSync(pdf, 'test') })
  afterAll(() => { unlinkSync(pdf); rmdirSync(dir) })
  beforeEach(() => {
    mocks.providerSettings = { encrypted_key: 'provider-key', iv: 'iv', auth_tag: 'tag', model: 'configured-model', base_url: 'http://localhost:8080' }
    mocks.selectedProvider = 'gemini'
    mocks.llmOcrEnabled = null
    mocks.llmOcrAlways = false
    mocks.parse.mockReset().mockResolvedValue('')
    mocks.queriedProvider = ''
    mocks.extract.mockReset().mockResolvedValue({ tags: [] })
  })

  it('uses the selected provider when LLM OCR is enabled', async () => {
    mocks.llmOcrEnabled = true
    const path = pdf
    await (new DocumentQueueService() as any).processDocument(path, 1, 'openai')
    expect(mocks.extract).toHaveBeenCalledWith('', 'openai', 'provider-key', 'configured-model', path, 'http://localhost:8080')
    expect(mocks.queriedProvider).toBe('openai')
  })

  it('uses the saved active provider for resumed tasks', async () => {
    mocks.llmOcrEnabled = true
    const path = pdf
    await (new DocumentQueueService() as any).processDocument(path, 1)
    expect(mocks.extract).toHaveBeenCalledWith('', 'gemini', 'provider-key', 'configured-model', path, 'http://localhost:8080')
  })

  it('does not send an unreadable document when LLM file processing is disabled', async () => {
    mocks.llmOcrEnabled = false
    await expect((new DocumentQueueService() as any).processDocument(pdf, 1, 'gemini'))
      .rejects.toThrow('Enable LLM file processing in AI Provider Settings')
    expect(mocks.extract).not.toHaveBeenCalled()
  })

  it('reports local OCR failures without sending the document when disabled', async () => {
    mocks.llmOcrEnabled = false
    mocks.parse.mockRejectedValueOnce(new Error('local OCR failed'))
    await expect((new DocumentQueueService() as any).processDocument(pdf, 1, 'gemini'))
      .rejects.toThrow('local OCR failed')
    expect(mocks.extract).not.toHaveBeenCalled()
  })

  it('enables LLM file processing by default after local extraction fails', async () => {
    await (new DocumentQueueService() as any).processDocument(pdf, 1, 'gemini')
    expect(mocks.parse).toHaveBeenCalled()
    expect(mocks.extract).toHaveBeenCalledWith('', 'gemini', 'provider-key', 'configured-model', pdf, 'http://localhost:8080')
  })

  it('always sends the PDF directly when both switches are on', async () => {
    mocks.llmOcrAlways = true
    await (new DocumentQueueService() as any).processDocument(pdf, 1, 'gemini')
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(mocks.extract).toHaveBeenCalledWith('', 'gemini', 'provider-key', 'configured-model', pdf, 'http://localhost:8080')
  })

  it('ignores the always-send preference when file processing is disabled', async () => {
    mocks.llmOcrEnabled = false
    mocks.llmOcrAlways = true
    mocks.parse.mockResolvedValueOnce('Readable CV content '.repeat(10))
    await (new DocumentQueueService() as any).processDocument(pdf, 1, 'gemini')
    expect(mocks.parse).toHaveBeenCalled()
    expect(mocks.extract).toHaveBeenCalledWith(expect.any(String), 'gemini', 'provider-key', 'configured-model', undefined, 'http://localhost:8080')
  })

  it('sends readable text without attaching the original file', async () => {
    mocks.parse.mockResolvedValueOnce('Readable CV content '.repeat(10))
    await (new DocumentQueueService() as any).processDocument(pdf, 1, 'gemini')
    expect(mocks.extract).toHaveBeenCalledWith(expect.any(String), 'gemini', 'provider-key', 'configured-model', undefined, 'http://localhost:8080')
  })

  it('explains how to configure a missing model', async () => {
    mocks.llmOcrEnabled = true
    mocks.providerSettings = undefined
    await expect((new DocumentQueueService() as any).processDocument(pdf, 1, 'gemini'))
      .rejects.toThrow('Configure gemini in AI Provider Settings')
    expect(mocks.extract).not.toHaveBeenCalled()
  })
})
