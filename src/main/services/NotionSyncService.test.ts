import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  candidate: { id: 1, first_name: 'A', last_name: 'B', tags: '[]', file_path: null as string | null, current_cv_version_id: 4 },
  mapping: undefined as { page_id: string; page_url: string; synced_version_id: number | null } | undefined,
  historyUrl: undefined as string | undefined,
  create: vi.fn(async () => ({ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', url: 'https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })),
  update: vi.fn(async () => ({ id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })),
  append: vi.fn(async () => ({})),
  createUpload: vi.fn(async () => ({ id: 'upload' })),
}))
vi.mock('@notionhq/client', () => ({ Client: class {
  pages = { create: mocks.create, update: mocks.update }
  blocks = { children: { append: mocks.append } }
  fileUploads = { create: mocks.createUpload, send: vi.fn() }
} }))
vi.mock('../db', () => ({ default: { prepare: (sql: string) => ({
  get: () => {
    if (sql.includes('FROM api_key_store')) return { encrypted_key: 'key', iv: 'iv', auth_tag: 'tag', model: 'database' }
    if (sql.includes('FROM candidates')) return mocks.candidate
    if (sql.includes('FROM notion_candidate_pages')) return mocks.mapping
    if (sql.includes('SELECT notion_page_url')) return mocks.historyUrl ? { notion_page_url: mocks.historyUrl } : undefined
    return undefined
  },
  run: (...args: any[]) => {
    if (sql.includes('INSERT INTO notion_candidate_pages')) mocks.mapping = { page_id: args[1], page_url: args[2], synced_version_id: args[3] }
  }
}) } }))
vi.mock('./KeyStoreService', () => ({ KeyStoreService: { decrypt: () => 'key' } }))

import { NotionSyncService } from './NotionSyncService'

describe('Notion candidate version sync', () => {
  beforeEach(() => {
    mocks.mapping = undefined
    mocks.historyUrl = undefined
    mocks.candidate.current_cv_version_id = 4
    mocks.candidate.file_path = null
    mocks.createUpload.mockReset().mockResolvedValue({ id: 'upload' })
    mocks.create.mockClear()
    mocks.update.mockClear()
    mocks.append.mockClear()
  })

  it('serializes concurrent syncs and creates only one page per candidate', async () => {
    await Promise.all([NotionSyncService.syncCandidate(1), NotionSyncService.syncCandidate(1)])
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.append).not.toHaveBeenCalled()
  })

  it('reports an attachment failure instead of claiming a complete sync', async () => {
    mocks.candidate.file_path = 'candidate.pdf'
    mocks.createUpload.mockRejectedValueOnce(new Error('upload unavailable'))
    const logging = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(NotionSyncService.syncCandidate(1)).rejects.toThrow('Failed to upload CV file to Notion')
      expect(mocks.create).not.toHaveBeenCalled()
    } finally { logging.mockRestore() }
  })

  it('reuses a previously synced page from history', async () => {
    mocks.historyUrl = 'https://notion.so/Candidate-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    await NotionSyncService.syncCandidate(1)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ page_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }))
  })
})
