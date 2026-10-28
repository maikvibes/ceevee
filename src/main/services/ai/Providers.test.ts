import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnthropicProvider } from './AnthropicProvider'
import { OpenAIProvider } from './OpenAIProvider'
import { GeminiProvider } from './GeminiProvider'

const { openAIOptions, geminiOptions } = vi.hoisted(() => ({
  openAIOptions: vi.fn(),
  geminiOptions: vi.fn()
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: async () => ({ choices: [{ message: { content: 'openai' } }] }) } }
    constructor(options: unknown) { openAIOptions(options) }
  }
}))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: async () => ({ text: 'gemini' }) }
    constructor(options: unknown) { geminiOptions(options) }
  }
}))

afterEach(() => { vi.restoreAllMocks(); openAIOptions.mockClear(); geminiOptions.mockClear() })

describe('custom AI endpoints', () => {
  it('passes a custom OpenAI URL to the SDK and leaves the default unset', async () => {
    const provider = new OpenAIProvider()
    await provider.generateCompletion('prompt', 'key', 'model', undefined, 'http://localhost:1234/v1')
    expect(openAIOptions).toHaveBeenLastCalledWith({ apiKey: 'key', baseURL: 'http://localhost:1234/v1' })
    await provider.generateCompletion('prompt', 'key', 'model')
    expect(openAIOptions).toHaveBeenLastCalledWith({ apiKey: 'key', baseURL: undefined })
  })

  it('passes a custom Gemini URL to the SDK and preserves its default', async () => {
    const provider = new GeminiProvider()
    await provider.generateCompletion('prompt', 'key', 'model', undefined, 'http://localhost:1234')
    expect(geminiOptions).toHaveBeenLastCalledWith({ apiKey: 'key', httpOptions: { baseUrl: 'http://localhost:1234' } })
    await provider.generateCompletion('prompt', 'key', 'model')
    expect(geminiOptions).toHaveBeenLastCalledWith({ apiKey: 'key' })
  })

  it('sends Anthropic messages to the configured URL without a duplicate slash', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: [{ text: 'ok' }] }), { status: 200 }))
    const provider = new AnthropicProvider()
    expect(await provider.generateCompletion('prompt', 'key', 'model', undefined, 'http://localhost:1234/v1/')).toBe('ok')
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:1234/v1/messages')
    await provider.generateCompletion('prompt', 'key', 'model')
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.anthropic.com/v1/messages')
  })
})
