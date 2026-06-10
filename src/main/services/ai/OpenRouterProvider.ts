import { IAIProvider } from './IAIProvider'

export class OpenRouterProvider implements IAIProvider {
  async generateCompletion(prompt: string, apiKey: string, model: string): Promise<string> {
    if (!apiKey) throw new Error('OpenRouter API key is missing.')

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim().replace(/^Bearer\s+/i, '')}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost', // Required by OpenRouter
        'X-Title': 'Magical Heisenberg', // Required by OpenRouter
      },
      body: JSON.stringify({
        model: model || 'openai/gpt-4o-mini',
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      let friendlyMessage = errorText
      try {
        const parsed = JSON.parse(errorText)
        if (parsed.error?.metadata?.raw) {
          friendlyMessage = parsed.error.metadata.raw
        } else if (parsed.error?.message) {
          friendlyMessage = parsed.error.message
        } else if (parsed.message) {
          friendlyMessage = parsed.message
        }
      } catch (e) {
        // Not JSON, fallback to raw text
      }
      throw new Error(`OpenRouter API error (${response.status}): ${friendlyMessage}`)
    }

    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
  }
}
