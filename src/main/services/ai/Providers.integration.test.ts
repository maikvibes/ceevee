import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { OpenAIProvider } from './OpenAIProvider'
import { GeminiProvider } from './GeminiProvider'

let server: Server
let baseUrl: string
const requests: Array<{ url?: string; authorization?: string; apiKey?: string }> = []

beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization, apiKey: request.headers['x-goog-api-key'] as string | undefined })
    response.setHeader('content-type', 'application/json')
    if (request.url?.includes(':generateContent')) {
      response.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'gemini response' }] } }] }))
    } else {
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'openai response' } }] }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) })

describe('keyless custom endpoints', () => {
  it('sends OpenAI requests without an Authorization header', async () => {
    expect(await new OpenAIProvider().generateCompletion('prompt', '', 'model', undefined, `${baseUrl}/v1`)).toBe('openai response')
    expect(requests.at(-1)).toMatchObject({ url: '/v1/chat/completions', authorization: undefined })
  })

  it('sends Gemini requests to the custom URL without a configured key', async () => {
    expect(await new GeminiProvider().generateCompletion('prompt', '', 'model', undefined, baseUrl)).toBe('gemini response')
    expect(requests.at(-1)?.url).toBe('/v1beta/models/model:generateContent')
    expect(requests.at(-1)?.apiKey || '').toBe('')
  })
})
