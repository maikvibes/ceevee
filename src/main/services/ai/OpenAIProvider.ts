import OpenAI from 'openai'
import { IAIProvider } from './IAIProvider'

export class OpenAIProvider implements IAIProvider {
  async generateCompletion(prompt: string, apiKey: string, model: string): Promise<string> {
    const normalizedKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    if (!normalizedKey) throw new Error('OpenAI API key is missing.')

    const client = new OpenAI({ apiKey: normalizedKey })

    try {
      const response = await client.chat.completions.create({
        model: model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
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
