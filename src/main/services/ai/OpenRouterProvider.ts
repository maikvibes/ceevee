import { IAIProvider } from './IAIProvider'
import * as fs from 'fs'
import * as path from 'path'

export class OpenRouterProvider implements IAIProvider {
  async generateCompletion(prompt: string, apiKey: string, model: string, filePath?: string): Promise<string> {
    if (!apiKey) throw new Error('OpenRouter API key is missing.')

    let content: any = prompt
    if (filePath) {
      if (!fs.existsSync(filePath)) throw new Error('Document file could not be found.')
      const ext = path.extname(filePath).toLowerCase()
      const data = fs.readFileSync(filePath).toString('base64')
      if (ext === '.pdf') {
        content = [{ type: 'text', text: prompt }, { type: 'file', file: { filename: path.basename(filePath), fileData: `data:application/pdf;base64,${data}` } }]
      } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
        content = [{ type: 'text', text: prompt }, { type: 'image_url', imageUrl: { url: `data:${mime};base64,${data}` } }]
      } else {
        throw new Error('OpenRouter document analysis supports PDF and image files only.')
      }
    }

    try {
      const { OpenRouter } = await import('@openrouter/sdk')
      const openRouter = new OpenRouter({
        apiKey: apiKey.trim().replace(/^Bearer\s+/i, ''),
        httpReferer: 'http://localhost',
        appTitle: 'CeeVee',
        appCategories: 'productivity'
      })

      const response = await openRouter.chat.send({
        chatRequest: {
          model: model || 'openai/gpt-4o-mini',
          messages: [
            { role: 'user', content }
          ],
          temperature: 0.1
        }
      })

      return response.choices?.[0]?.message?.content || ''
    } catch (error: unknown) {
      throw new Error(`OpenRouter API error: ${extractOpenRouterErrorMessage(error)}`)
    }
  }
}

function extractOpenRouterErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>
    const nestedError = record.error
    if (typeof nestedError === 'object' && nestedError !== null) {
      const nested = nestedError as Record<string, unknown>
      const metadata = nested.metadata
      if (typeof metadata === 'object' && metadata !== null) {
        const raw = (metadata as Record<string, unknown>).raw
        if (typeof raw === 'string') return raw
      }
      if (typeof nested.message === 'string') return nested.message
    }
    if (typeof record.message === 'string') return record.message
  }
  return String(error)
}
