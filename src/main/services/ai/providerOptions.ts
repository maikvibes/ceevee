import type { ClientOptions } from 'openai'

export function openAIClientOptions(apiKey: string, baseUrl?: string): ClientOptions {
  if (!apiKey && baseUrl) {
    return { apiKey: 'unused', baseURL: baseUrl, defaultHeaders: { Authorization: null } }
  }
  return { apiKey, baseURL: baseUrl || undefined }
}
