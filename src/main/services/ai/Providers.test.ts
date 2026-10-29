import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnthropicProvider } from './AnthropicProvider'
import { OpenAIProvider } from './OpenAIProvider'
import { GeminiProvider } from './GeminiProvider'
import { OpenRouterProvider } from './OpenRouterProvider'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { openAIOptions, openAIGenerate, geminiOptions, geminiGenerate, openRouterSend } = vi.hoisted(() => ({
  openAIOptions: vi.fn(),
  openAIGenerate: vi.fn(async () => ({ choices: [{ message: { content: 'openai' } }] })),
  geminiOptions: vi.fn(),
  geminiGenerate: vi.fn(async () => ({ text: 'gemini' })),
  openRouterSend: vi.fn(async () => ({ choices: [{ message: { content: 'openrouter' } }] }))
}))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: openAIGenerate } }
    constructor(options: unknown) { openAIOptions(options) }
  }
}))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: geminiGenerate }
    constructor(options: unknown) { geminiOptions(options) }
  }
}))

vi.mock('@openrouter/sdk', () => ({ OpenRouter: class { chat = { send: openRouterSend } } }))

afterEach(() => { vi.restoreAllMocks(); openAIOptions.mockClear(); openAIGenerate.mockClear(); openRouterSend.mockClear(); geminiOptions.mockClear(); geminiGenerate.mockReset(); geminiGenerate.mockResolvedValue({ text: 'gemini' }) })

describe('custom AI endpoints', () => {
  it('passes a custom OpenAI URL to the SDK and leaves the default unset', async () => {
    const provider = new OpenAIProvider()
    await provider.generateCompletion('prompt', 'key', 'model', undefined, 'http://localhost:1234/v1')
    expect(openAIOptions).toHaveBeenLastCalledWith({ apiKey: 'key', baseURL: 'http://localhost:1234/v1' })
    await provider.generateCompletion('prompt', 'key', 'model')
    expect(openAIOptions).toHaveBeenLastCalledWith({ apiKey: 'key', baseURL: undefined })
  })

  it('sends PDFs to OpenAI-compatible endpoints as file input', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ceevee-ocr-'))
    try {
      const path = join(dir, 'cv.pdf')
      writeFileSync(path, 'pdf content')
      await new OpenAIProvider().generateCompletion('prompt', '', 'model', path, 'http://localhost:1234/v1')
      expect(openAIOptions).toHaveBeenLastCalledWith({ apiKey: 'unused', baseURL: 'http://localhost:1234/v1', defaultHeaders: { Authorization: null } })
      expect(openAIGenerate).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ role: 'user', content: [
        { type: 'text', text: 'prompt' },
        { type: 'file', file: { filename: 'cv.pdf', file_data: `data:application/pdf;base64,${Buffer.from('pdf content').toString('base64')}` } }
      ] }] }))
    } finally {
      unlinkSync(join(dir, 'cv.pdf'))
      rmdirSync(dir)
    }
  })

  it('sends scanned PDFs to OpenRouter as file content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ceevee-router-'))
    try {
      const path = join(dir, 'cv.pdf')
      writeFileSync(path, 'pdf content')
      await new OpenRouterProvider().generateCompletion('prompt', 'key', 'model', path)
      expect(openRouterSend).toHaveBeenCalledWith(expect.objectContaining({ chatRequest: expect.objectContaining({
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'prompt' },
          { type: 'file', file: { filename: 'cv.pdf', fileData: `data:application/pdf;base64,${Buffer.from('pdf content').toString('base64')}` } }
        ] }]
      }) }))
    } finally {
      unlinkSync(join(dir, 'cv.pdf'))
      rmdirSync(dir)
    }
  })

  it('rejects unsupported OCR files rather than sending an empty document', async () => {
    await expect(new OpenAIProvider().generateCompletion('prompt', 'key', 'model', fileURLToPath(import.meta.url)))
      .rejects.toThrow('OpenAI OCR supports PDF and image files only')
  })

  it('supports a keyless Anthropic-compatible endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ content: [{ text: 'ok' }] }), { status: 200 }))
    await new AnthropicProvider().generateCompletion('prompt', '', 'model', undefined, 'http://localhost:1234/v1')
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['x-api-key']).toBeUndefined()
  })

  it('handles legacy Gemini settings with a null model', async () => {
    await new GeminiProvider().generateCompletion('prompt', 'key', null as unknown as string)
    expect(geminiGenerate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.5-flash-lite' }))
  })

  it('passes a custom Gemini URL to the SDK and preserves its default', async () => {
    const provider = new GeminiProvider()
    await provider.generateCompletion('prompt', 'key', 'model', undefined, 'http://localhost:1234')
    expect(geminiOptions).toHaveBeenLastCalledWith({ apiKey: 'key', httpOptions: { baseUrl: 'http://localhost:1234' } })
    await provider.generateCompletion('prompt', 'key', 'model')
    expect(geminiOptions).toHaveBeenLastCalledWith({ apiKey: 'key' })
  })

  it('uses an available Gemini default when the OCR model is blank', async () => {
    await new GeminiProvider().generateCompletion('prompt', 'key', '  ')
    expect(geminiGenerate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.5-flash-lite' }))
  })

  it('explains Gemini 404 errors without hiding the configured model', async () => {
    geminiGenerate.mockRejectedValueOnce({ status: 404, message: '{"error":{"message":"","code":404}}' })
    await expect(new GeminiProvider().generateCompletion('prompt', 'key', 'my-model', undefined, 'http://localhost'))
      .rejects.toThrow('Model "my-model" or its endpoint was not found')
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
