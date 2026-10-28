import * as fs from 'fs'
import { GoogleGenAI } from '@google/genai'
import { IAIProvider } from './IAIProvider'

export class GeminiProvider implements IAIProvider {
  async generateCompletion(prompt: string, apiKey: string, model: string, filePath?: string, baseUrl?: string): Promise<string> {
    const normalizedKey = apiKey.trim()
    if (!normalizedKey) throw new Error('Gemini API key is missing.')

    const client = new GoogleGenAI({ apiKey: normalizedKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) })

    const contents: any[] = [prompt]
    if (filePath && fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath)
      let mimeType = 'application/pdf'
      const ext = filePath.split('.').pop()?.toLowerCase()
      if (ext === 'png') {
        mimeType = 'image/png'
      } else if (ext === 'jpg' || ext === 'jpeg') {
        mimeType = 'image/jpeg'
      } else if (ext === 'webp') {
        mimeType = 'image/webp'
      }
      contents.push({
        inlineData: {
          data: fileBuffer.toString('base64'),
          mimeType
        }
      })
    }

    try {
      const response = await client.models.generateContent({
        model: model || 'gemini-1.5-flash',
        contents,
        config: {
          temperature: 0.1
        }
      })

      return response.text || ''
    } catch (error: any) {
      const message = error?.error?.message || error?.message || String(error)
      const status = error?.status ? ` (${error.status})` : ''
      throw new Error(`Gemini API error${status}: ${message}`)
    }
  }
}
