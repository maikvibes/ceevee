import OpenAI from 'openai'
import { IAIProvider } from './IAIProvider'
import * as fs from 'fs'
import * as path from 'path'
import { openAIClientOptions } from './providerOptions'

export class OpenAIProvider implements IAIProvider {
  async generateCompletion(prompt: string, apiKey: string, model: string, filePath?: string, baseUrl?: string): Promise<string> {
    const normalizedKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    if (!normalizedKey && !baseUrl) throw new Error('OpenAI API key is missing.')

    const client = new OpenAI(openAIClientOptions(normalizedKey, baseUrl))

    let content: any = prompt
    if (filePath && fs.existsSync(filePath)) {
      const ext = filePath.split('.').pop()?.toLowerCase()
      if (ext === 'pdf') {
        const data = fs.readFileSync(filePath).toString('base64')
        content = [{ type: 'text', text: prompt }, { type: 'file', file: { filename: path.basename(filePath), file_data: `data:application/pdf;base64,${data}` } }]
      } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) {
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
      } else {
        throw new Error('OpenAI OCR supports PDF and image files only.')
      }
    } else if (filePath) {
      throw new Error('OCR file could not be found.')
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
