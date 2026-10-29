import * as fs from 'fs'
import { GoogleGenAI } from '@google/genai'
import { IAIProvider } from './IAIProvider'

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'

export class GeminiProvider implements IAIProvider {
  async generateCompletion(prompt: string, apiKey: string, model: string, filePath?: string, baseUrl?: string): Promise<string> {
    const normalizedKey = apiKey.trim()
    if (!normalizedKey && !baseUrl) throw new Error('Gemini API key is missing.')

    const client = new GoogleGenAI({ apiKey: normalizedKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) })

    const contents: any[] = [prompt]
    if (filePath && fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase()
      if (!['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) throw new Error('Gemini document analysis supports PDF and image files only.')
      let mimeType = 'application/pdf'
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
    } else if (filePath) {
      throw new Error('Document file could not be found.')
    }

    const modelId = model?.trim() || DEFAULT_GEMINI_MODEL

    try {
      const response = await client.models.generateContent({
        model: modelId,
        contents,
        config: {
          temperature: 0.1
        }
      })

      return response.text || ''
    } catch (error: any) {
      const status = error?.status ? ` (${error.status})` : ''
      if (Number(error?.status) === 404) {
        throw new Error(`Gemini API error${status}: Model "${modelId}" or its endpoint was not found. Check the selected model and Gemini base URL in Settings, and choose a model available to your API key.`)
      }
      const message = error?.error?.message || error?.message || String(error)
      throw new Error(`Gemini API error${status}: ${message}`)
    }
  }
}
