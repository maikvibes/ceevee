import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import { createWorker, createScheduler, type Scheduler } from 'tesseract.js'

export class FileParsingService {
  private static schedulerPromise: Promise<Scheduler> | null = null
  private static workerN = 4

  private static async initScheduler(): Promise<Scheduler> {
    if (!this.schedulerPromise) {
      this.schedulerPromise = (async () => {
        const scheduler = createScheduler()
        const languagePath = app.isPackaged ? path.join(process.resourcesPath, 'ocr') : app.getAppPath()
        try {
          for (let i = 0; i < this.workerN; i++) {
            const worker = await createWorker('eng+vie', 1, {
              langPath: languagePath,
              gzip: false,
              cacheMethod: 'none'
            })
            scheduler.addWorker(worker)
          }
          return scheduler
        } catch (error) {
          await scheduler.terminate()
          throw error
        }
      })().catch((error) => {
        this.schedulerPromise = null
        throw error
      })
    }
    return this.schedulerPromise
  }

  static async parseFile(filePath: string, onProgress?: (status: string) => void): Promise<string> {
    const ext = path.extname(filePath).toLowerCase()
    try {
      if (ext === '.pdf') return await this.parsePdf(filePath, onProgress)
      if (ext === '.docx') return await this.parseDocx(filePath)
      throw new Error(`Unsupported file type: ${ext}`)
    } catch (error: unknown) {
      throw new Error(`Failed to parse file ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private static async parsePdf(filePath: string, onProgress?: (status: string) => void): Promise<string> {
    const parser = new PDFParse({ data: fs.readFileSync(filePath) })
    try {
      const result = await parser.getText()
      const pages = result.pages.map((page) => ({ number: page.num, text: page.text.trim() }))
      const pagesNeedingOcr = pages.filter((page) => page.text.length < 100)
      if (!pagesNeedingOcr.length) return pages.map((page) => page.text).join('\n\n')

      console.log(`[FileParsingService] Rendering ${pagesNeedingOcr.length} of ${pages.length} PDF pages for local OCR.`)
      const scheduler = await this.initScheduler()
      onProgress?.('OCR:0')
      for (const [index, page] of pagesNeedingOcr.entries()) {
        const rendered = await parser.getScreenshot({ partial: [page.number], scale: 2, imageDataUrl: false, imageBuffer: true })
        const screenshot = rendered.pages[0]
        if (!screenshot?.data?.length) throw new Error(`Could not render PDF page ${page.number} for OCR.`)
        const { data: { text } } = await scheduler.addJob('recognize', Buffer.from(screenshot.data))
        if (text.trim()) page.text = text.trim()
        onProgress?.(`OCR:${Math.round(((index + 1) / pagesNeedingOcr.length) * 100)}`)
      }
      return pages.map((page) => page.text).join('\n\n')
    } finally {
      await parser.destroy()
    }
  }

  private static async parseDocx(filePath: string): Promise<string> {
    const result = await mammoth.extractRawText({ path: filePath })
    return result.value
  }
}
