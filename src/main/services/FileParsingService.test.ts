import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mocks = vi.hoisted(() => ({
  pages: [{ num: 1, text: 'Readable text '.repeat(12) }, { num: 2, text: '' }, { num: 3, text: '' }],
  screenshots: vi.fn(async ({ partial }: { partial: number[] }) => ({ pages: [{ data: Buffer.from(String(partial[0])) }] })),
  recognize: vi.fn(async (_action: string, data: Buffer) => ({ data: { text: `Recognized page ${data.toString()}` } })),
  addWorker: vi.fn(),
  terminate: vi.fn(),
  destroy: vi.fn(),
  createWorker: vi.fn(async () => ({}))
}))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => 'C:/ceevee' } }))
vi.mock('pdf-parse', () => ({ PDFParse: class {
  getText = async () => ({ pages: mocks.pages, text: '-- 1 of 3 --', total: mocks.pages.length })
  getScreenshot = mocks.screenshots
  destroy = mocks.destroy
} }))
vi.mock('tesseract.js', () => ({ createWorker: mocks.createWorker, createScheduler: () => ({ addWorker: mocks.addWorker, terminate: mocks.terminate, addJob: mocks.recognize }) }))
vi.mock('mammoth', () => ({ default: { extractRawText: vi.fn() } }))

import { FileParsingService } from './FileParsingService'

describe('local PDF OCR', () => {
  it('uses the embedded text layer without running OCR when it is readable', async () => {
    const originalPages = mocks.pages
    mocks.pages = [{ num: 1, text: 'Readable CV text '.repeat(12) }]
    mocks.screenshots.mockClear()
    const dir = mkdtempSync(join(tmpdir(), 'ceevee-pdf-'))
    const file = join(dir, 'readable.pdf')
    writeFileSync(file, 'test')
    try {
      expect(await FileParsingService.parseFile(file)).toBe(mocks.pages[0].text.trim())
      expect(mocks.screenshots).not.toHaveBeenCalled()
    } finally {
      mocks.pages = originalPages
      unlinkSync(file)
      rmdirSync(dir)
    }
  })

  it('recognizes full rendered pages while preserving readable text in page order', async () => {
    const progress = vi.fn()
    const dir = mkdtempSync(join(tmpdir(), 'ceevee-pdf-'))
    const file = join(dir, 'test.pdf')
    writeFileSync(file, 'test')
    let result: string
    try { result = await FileParsingService.parseFile(file, progress) } finally { unlinkSync(file); rmdirSync(dir) }
    expect(result).toBe(`${mocks.pages[0].text.trim()}\n\nRecognized page 2\n\nRecognized page 3`)
    expect(mocks.screenshots).toHaveBeenCalledTimes(2)
    expect(mocks.screenshots).toHaveBeenNthCalledWith(1, expect.objectContaining({ partial: [2], scale: 2 }))
    expect(mocks.screenshots).toHaveBeenNthCalledWith(2, expect.objectContaining({ partial: [3], scale: 2 }))
    expect(mocks.createWorker).toHaveBeenCalledTimes(4)
    expect(mocks.createWorker).toHaveBeenCalledWith('eng+vie', 1, expect.objectContaining({ langPath: 'C:/ceevee', gzip: false, cacheMethod: 'none' }))
    expect(progress.mock.calls).toEqual([['OCR:0'], ['OCR:50'], ['OCR:100']])
    expect(mocks.destroy).toHaveBeenCalled()
  })
})
