import { KeyStoreService } from './KeyStoreService'

export type EmbeddingProviderName = 'local' | 'openai' | 'gemini' | 'openrouter'

export interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>
  embedQuery(text: string): Promise<number[]>
}

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderName
  model: string
  apiKey?: string
}

export interface EncryptedKeyRow {
  encrypted_key: string
  iv: string
  auth_tag: string
}

interface GeminiEmbeddingResponse {
  embeddings?: { values?: number[] }[]
  embedding?: { values?: number[] }
}

interface OpenRouterEmbeddingResponse {
  data: { embedding: number[] }[]
}

const DEFAULT_MODELS: Record<EmbeddingProviderName, string> = {
  local: 'onnx-community/all-MiniLM-L6-v2-ONNX',
  openai: 'text-embedding-3-small',
  gemini: 'gemini-embedding-001',
  openrouter: 'openai/text-embedding-3-small'
}

export const DEFAULT_EMBEDDING_MODELS = DEFAULT_MODELS

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private extractorPromise: Promise<TransformerExtractor> | null = null

  constructor(private readonly model: string) {}

  private async extractor(): Promise<TransformerExtractor> {
    if (!this.extractorPromise) {
      const { pipeline } = await import('@huggingface/transformers')
      this.extractorPromise = pipeline('feature-extraction', this.model) as Promise<TransformerExtractor>
    }
    return this.extractorPromise
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const extractor = await this.extractor()
    const output = await extractor(texts, { pooling: 'mean', normalize: true })
    return normalizeTransformerOutput(output)
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embedDocuments([text])
    return embedding
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('OpenAI API key is missing.')
    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey: this.apiKey })
    const response = await client.embeddings.create({ model: this.model, input: texts })
    return response.data.map((item) => item.embedding)
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embedDocuments([text])
    return embedding
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('Gemini API key is missing.')
    const { GoogleGenAI } = await import('@google/genai')
    const ai = new GoogleGenAI({ apiKey: this.apiKey })
    const embeddings: number[][] = []

    for (const text of texts) {
      const response = await ai.models.embedContent({
        model: this.model,
        contents: text
      }) as GeminiEmbeddingResponse
      const values = response.embeddings?.[0]?.values || response.embedding?.values
      if (!values) throw new Error('Gemini embedding response did not include values.')
      embeddings.push(values)
    }

    return embeddings
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embedDocuments([text])
    return embedding
  }
}

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('OpenRouter API key is missing.')
    const { OpenRouter } = await import('@openrouter/sdk')
    const client = new OpenRouter({
      apiKey: this.apiKey,
      httpReferer: 'http://localhost',
      appTitle: 'CeeVee',
      appCategories: 'productivity'
    })
    const response = await client.embeddings.generate({
      requestBody: {
        model: this.model,
        input: texts
      }
    }) as OpenRouterEmbeddingResponse
    return response.data.map((item) => item.embedding)
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embedDocuments([text])
    return embedding
  }
}

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  const model = config.model || DEFAULT_MODELS[config.provider]
  switch (config.provider) {
    case 'local':
      return new LocalEmbeddingProvider(model)
    case 'openai':
      return new OpenAIEmbeddingProvider(config.apiKey || '', model)
    case 'gemini':
      return new GeminiEmbeddingProvider(config.apiKey || '', model)
    case 'openrouter':
      return new OpenRouterEmbeddingProvider(config.apiKey || '', model)
  }
}

export function sanitizeApiKey(key: string): string {
  return key.trim().replace(/^Bearer\s+/i, '')
}

export function decryptProviderKey(row: EncryptedKeyRow): string {
  return sanitizeApiKey(KeyStoreService.decrypt(row.encrypted_key, row.iv, row.auth_tag))
}

type TransformerExtractor = (input: string[], options: { pooling: 'mean'; normalize: boolean }) => Promise<unknown>

function normalizeTransformerOutput(output: unknown): number[][] {
  if (hasToList(output)) {
    const list = output.tolist() as unknown
    if (!Array.isArray(list)) throw new Error('Unsupported local embedding output format.')
    return Array.isArray(list[0]) && Array.isArray(list[0][0]) ? list.map((item: number[][]) => item[0]) : list
  }

  if (Array.isArray(output)) return output
  if (isTransformerTensor(output)) {
    const [rows, columns] = output.dims
    const data = Array.from(output.data)
    const embeddings: number[][] = []
    for (let row = 0; row < rows; row++) {
      embeddings.push(data.slice(row * columns, (row + 1) * columns))
    }
    return embeddings
  }

  throw new Error('Unsupported local embedding output format.')
}

function hasToList(output: unknown): output is { tolist: () => unknown } {
  return typeof output === 'object' && output !== null && typeof (output as { tolist?: unknown }).tolist === 'function'
}

function isTransformerTensor(output: unknown): output is { data: Iterable<number>; dims: [number, number] } {
  if (typeof output !== 'object' || output === null) return false
  const record = output as Record<string, unknown>
  return Boolean(record.data && Array.isArray(record.dims) && record.dims.length >= 2)
}
