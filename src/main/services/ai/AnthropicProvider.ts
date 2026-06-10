import { IAIProvider } from './IAIProvider'

export class AnthropicProvider implements IAIProvider {
  async generateCompletion(prompt: string, apiKey: string, model: string): Promise<string> {
    if (!apiKey) throw new Error('Anthropic API key is missing.')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey.trim().replace(/^Bearer\s+/i, ''),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'claude-3-haiku-20240307',
        max_tokens: 1024,
        temperature: 0.1,
        messages: [
          { role: 'user', content: prompt }
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
