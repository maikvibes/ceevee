import { IAIProvider } from './IAIProvider'
import * as fs from 'fs'

export class AnthropicProvider implements IAIProvider {
  async generateCompletion(prompt: string, apiKey: string, model: string, filePath?: string, baseUrl?: string): Promise<string> {
    const normalizedKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    if (!normalizedKey && !baseUrl) throw new Error('Anthropic API key is missing.')

    const headers: Record<string, string> = {
      ...(normalizedKey ? { 'x-api-key': normalizedKey } : {}),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    }

    let content: any = prompt
    if (filePath && fs.existsSync(filePath)) {
      const ext = filePath.split('.').pop()?.toLowerCase()
      const fileBuffer = fs.readFileSync(filePath)
      if (ext === 'pdf') {
        headers['anthropic-beta'] = 'pdfs-2024-09-25'
        content = [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: fileBuffer.toString('base64')
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) {
        const media_type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
        content = [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type,
              data: fileBuffer.toString('base64')
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      } else {
        throw new Error('Anthropic document analysis supports PDF and image files only.')
      }
    } else if (filePath) {
      throw new Error('Document file could not be found.')
    }

    const response = await fetch(`${(baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '')}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'claude-3-haiku-20240307',
        max_tokens: 1024,
        temperature: 0.1,
        messages: [
          { role: 'user', content }
        ]
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      let friendlyMessage = errorText
      try {
        const parsed = JSON.parse(errorText)
        if (parsed.error?.message) {
          friendlyMessage = parsed.error.message
        } else if (parsed.message) {
          friendlyMessage = parsed.message
        }
      } catch (e) {
        // Not JSON, fallback to raw text
      }
      throw new Error(`Anthropic API error (${response.status}): ${friendlyMessage}`)
    }

    const data = await response.json()
    return data.content?.[0]?.text || ''
  }
}
