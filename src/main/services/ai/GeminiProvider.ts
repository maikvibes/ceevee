import { GoogleGenAI } from '@google/genai'
import { IAIProvider } from './IAIProvider'

export class GeminiProvider implements IAIProvider {
  async generateCompletion(prompt: string, apiKey: string, model: string): Promise<string> {
    const normalizedKey = apiKey.trim()
    if (!normalizedKey) throw new Error('Gemini API key is missing.')

    const client = new GoogleGenAI({ apiKey: normalizedKey })

    try {
      const response = await client.models.generateContent({
        model: model || 'gemini-1.5-flash',
        contents: prompt,
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
