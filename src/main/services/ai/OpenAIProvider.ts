import OpenAI from 'openai'
import { IAIProvider } from './IAIProvider'
import * as fs from 'fs'

export class OpenAIProvider implements IAIProvider {
  async generateCompletion(prompt: string, apiKey: string, model: string, filePath?: string, baseUrl?: string): Promise<string> {
    const normalizedKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    if (!normalizedKey) throw new Error('OpenAI API key is missing.')

    const client = new OpenAI({ apiKey: normalizedKey, baseURL: baseUrl || undefined })

    let content: any = prompt
    if (filePath && fs.existsSync(filePath)) {
      const ext = filePath.split('.').pop()?.toLowerCase()
      if (['png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) {
        const fileBuffer = fs.readFileSync(filePath)
        const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
        content = [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${fileBuffer.toString('base64')}`
            }
          }
        ]
      }
    }

    try {
      const response = await client.chat.completions.create({
        model: model || 'gpt-4o-mini',
        messages: [{ role: 'user', content }],
        temperature: 0.1
      })

      return response.choices[0]?.message?.content || ''
    } catch (error: any) {
      const message = error?.error?.message || error?.message || String(error)
      const status = error?.status ? ` (${error.status})` : ''
      throw new Error(`OpenAI API error${status}: ${message}`)
    }
  }
}
