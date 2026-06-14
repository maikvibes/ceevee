import db from '../db'
import {
  DEFAULT_EMBEDDING_MODELS,
  EncryptedKeyRow,
  EmbeddingProviderName,
  createEmbeddingProvider,
  decryptProviderKey
} from './EmbeddingProvider'
import { SearchableCandidate } from './CandidateSearchScoring'

export interface VectorSearchSettings {
  vector_search_enabled: boolean
  vector_db_provider: 'chromadb'
  chroma_host: string
  chroma_port: number
  chroma_ssl: boolean
  embedding_provider: EmbeddingProviderName
  embedding_model: string
  embedding_dimension: number
  embedding_index_status: 'disabled' | 'not_indexed' | 'indexing' | 'indexed' | 'stale' | 'error'
}

export interface VectorSearchStatus {
  settings: VectorSearchSettings
  chromaReachable: boolean
  indexedChunks: number
  candidateCount: number
  message: string
}

interface AppSettingRow {
  setting_key: keyof VectorSearchSettings
  setting_value: string
}

interface CountRow {
  count: number
}

interface VectorSearchMatch {
  id: string
  candidateId: number
  distance: number
  document: string
  metadata: ChromaCandidateMetadata
}

interface VectorQueryResult {
  available: boolean
  reason: string | null
  results: VectorSearchMatch[]
}

interface ChromaCandidateMetadata extends Record<string, string | number | boolean> {
  candidate_id: number
  candidate_name: string
  email: string
  phone: string
  headline: string
  job_type: string
  tags: string
  file_path: string
  chunk_index: number
  updated_at: string
}

interface EmbeddingModelInfo {
  model_id: string
  name: string
}

interface OpenRouterModelListResponse {
  data?: { id: string; name?: string }[]
}

const COLLECTION_NAME = 'ceevee_candidates'

const DEFAULT_SETTINGS: VectorSearchSettings = {
  vector_search_enabled: false,
  vector_db_provider: 'chromadb',
  chroma_host: 'localhost',
  chroma_port: 8000,
  chroma_ssl: false,
  embedding_provider: 'local',
  embedding_model: DEFAULT_EMBEDDING_MODELS.local,
  embedding_dimension: 384,
  embedding_index_status: 'disabled'
}

export class VectorSearchService {
  static getSettings(): VectorSearchSettings {
    const rows = db.prepare('SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE ? OR setting_key = ?').all('vector_%', 'embedding_index_status') as AppSettingRow[]
    const settings: VectorSearchSettings = { ...DEFAULT_SETTINGS }

    for (const row of rows) {
      assignSetting(settings, row.setting_key, row.setting_value)
    }

    if (!settings.embedding_model) {
      settings.embedding_model = DEFAULT_EMBEDDING_MODELS[settings.embedding_provider as EmbeddingProviderName]
    }
    settings.embedding_index_status = settings.vector_search_enabled
      ? settings.embedding_index_status === 'disabled' ? 'not_indexed' : settings.embedding_index_status
      : 'disabled'

    return settings
  }

  static saveSettings(next: Partial<VectorSearchSettings>) {
    const previous = this.getSettings()
    const merged = {
      ...previous,
      ...next,
      embedding_model: next.embedding_model || DEFAULT_EMBEDDING_MODELS[next.embedding_provider || previous.embedding_provider]
    }

    if (
      previous.embedding_provider !== merged.embedding_provider ||
      previous.embedding_model !== merged.embedding_model ||
      previous.embedding_dimension !== merged.embedding_dimension
    ) {
      merged.embedding_index_status = merged.vector_search_enabled ? 'stale' : 'disabled'
    } else if (!merged.vector_search_enabled) {
      merged.embedding_index_status = 'disabled'
    } else if (previous.embedding_index_status === 'disabled') {
      merged.embedding_index_status = 'not_indexed'
    }

    const stmt = db.prepare(`
      INSERT INTO app_settings (setting_key, setting_value)
      VALUES (?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
    `)

    db.transaction(() => {
      for (const [key, value] of Object.entries(merged)) {
        stmt.run(key, String(value))
      }
    })()

    return merged
  }

  static async getStatus(): Promise<VectorSearchStatus> {
    const settings = this.getSettings()
    const candidateCount = (db.prepare('SELECT COUNT(*) as count FROM candidates WHERE raw_text IS NOT NULL AND raw_text != ?').get('') as CountRow).count
    if (!settings.vector_search_enabled) {
      return { settings, chromaReachable: false, indexedChunks: 0, candidateCount, message: 'Semantic search is disabled.' }
    }

    try {
      const collection = await this.getCollection(settings)
      const count = await collection.count()
      return { settings, chromaReachable: true, indexedChunks: count, candidateCount, message: 'ChromaDB is reachable.' }
    } catch (error: unknown) {
      return { settings, chromaReachable: false, indexedChunks: 0, candidateCount, message: getErrorMessage(error) }
    }
  }

  static async testConnection(config: Partial<VectorSearchSettings>) {
    const settings = { ...this.getSettings(), ...config }
    const client = await this.getClient(settings)
    const version = await client.version()
    return { success: true, version }
  }

  static async indexCandidate(candidateId: number) {
    const settings = this.getSettings()
    if (!settings.vector_search_enabled) return

    try {
      const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as SearchableCandidate | undefined
      if (!candidate?.raw_text) return
      await this.deleteCandidate(candidateId)

      const chunks = chunkText(candidate.raw_text)
      if (chunks.length === 0) return

      const provider = await this.createProvider(settings)
      const embeddings = await provider.embedDocuments(chunks)
      const collection = await this.getCollection(settings)
      await collection.upsert({
        ids: chunks.map((_, index) => `${candidate.id}:${candidate.updated_at || candidate.created_at}:${index}`),
        documents: chunks,
        embeddings,
        metadatas: chunks.map((_, index) => buildMetadata(candidate, index))
      })

      this.setIndexStatus('indexed')
    } catch (error) {
      console.error('[VectorSearchService] Candidate vector indexing failed:', error)
      this.setIndexStatus('error')
    }
  }

  static async deleteCandidate(candidateId: number) {
    const settings = this.getSettings()
    if (!settings.vector_search_enabled) return
    const collection = await this.getCollection(settings)
    await collection.delete({ where: { candidate_id: candidateId } })
  }

  static async reindexAll() {
    const settings = this.getSettings()
    if (!settings.vector_search_enabled) throw new Error('Vector search is disabled.')

    this.setIndexStatus('indexing')
    const collection = await this.getCollection(settings)
    const candidates = db.prepare('SELECT * FROM candidates WHERE raw_text IS NOT NULL AND raw_text != ?').all('') as SearchableCandidate[]
    try {
      await collection.delete({ where: { candidate_id: { $gte: 0 } } })
    } catch (error) {
      console.warn('[VectorSearchService] Collection clear skipped:', error)
    }

    for (const candidate of candidates) {
      await this.indexCandidate(candidate.id)
    }
    this.setIndexStatus('indexed')
    return { indexedCandidates: candidates.length }
  }

  static async query(text: string, limit = 12) {
    const settings = this.getSettings()
    if (!settings.vector_search_enabled || settings.embedding_index_status !== 'indexed') {
      return { available: false, reason: 'Semantic search is disabled or not indexed.', results: [] }
    }

    const provider = await this.createProvider(settings)
    const embedding = await provider.embedQuery(text)
    const collection = await this.getCollection(settings)
    const results = await collection.query({
      queryEmbeddings: [embedding],
      nResults: limit,
      include: ['metadatas', 'distances', 'documents']
    })

    const matches = (results.ids?.[0] || []).map((id: string, index: number) => ({
      id,
      candidateId: Number((results.metadatas?.[0]?.[index] as Partial<ChromaCandidateMetadata> | undefined)?.candidate_id),
      distance: results.distances?.[0]?.[index] ?? 1,
      document: results.documents?.[0]?.[index] || '',
      metadata: (results.metadatas?.[0]?.[index] || {}) as unknown as ChromaCandidateMetadata
    }))

    return { available: true, reason: null, results: matches } satisfies VectorQueryResult
  }

  static async getEmbeddingModels(provider: EmbeddingProviderName): Promise<EmbeddingModelInfo[]> {
    if (provider === 'local') {
      return [
        { model_id: DEFAULT_EMBEDDING_MODELS.local, name: 'MiniLM L6 v2 (local)' }
      ]
    }

    if (provider === 'openai') {
      return [
        { model_id: 'text-embedding-3-small', name: 'OpenAI text-embedding-3-small' },
        { model_id: 'text-embedding-3-large', name: 'OpenAI text-embedding-3-large' }
      ]
    }

    if (provider === 'gemini') {
      return [
        { model_id: 'gemini-embedding-001', name: 'Gemini embedding 001' },
        { model_id: 'text-embedding-004', name: 'Gemini text embedding 004' }
      ]
    }

    const row = db.prepare('SELECT encrypted_key, iv, auth_tag FROM api_key_store WHERE provider = ?').get('openrouter') as EncryptedKeyRow | undefined
    if (!row) {
      return [
        { model_id: DEFAULT_EMBEDDING_MODELS.openrouter, name: 'OpenAI text-embedding-3-small via OpenRouter' }
      ]
    }
    const { OpenRouter } = await import('@openrouter/sdk')
    const client = new OpenRouter({
      apiKey: decryptProviderKey(row),
      httpReferer: 'http://localhost',
      appTitle: 'CeeVee',
      appCategories: 'productivity'
    })
    const response = await client.embeddings.listModels() as OpenRouterModelListResponse
    return (response.data || []).map((model) => ({
      model_id: model.id,
      name: model.name || model.id
    }))
  }

  private static setIndexStatus(status: VectorSearchSettings['embedding_index_status']) {
    db.prepare(`
      INSERT INTO app_settings (setting_key, setting_value)
      VALUES ('embedding_index_status', ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
    `).run(status)
  }

  private static async createProvider(settings: VectorSearchSettings) {
    let apiKey = ''
    if (settings.embedding_provider !== 'local') {
      const providerKey = settings.embedding_provider === 'openrouter' ? 'openrouter' : settings.embedding_provider
      const row = db.prepare('SELECT encrypted_key, iv, auth_tag FROM api_key_store WHERE provider = ?').get(providerKey) as EncryptedKeyRow | undefined
      if (!row) throw new Error(`${settings.embedding_provider} API key is not configured.`)
      apiKey = decryptProviderKey(row)
    }

    return createEmbeddingProvider({
      provider: settings.embedding_provider,
      model: settings.embedding_model,
      apiKey
    })
  }

  private static async getClient(settings: VectorSearchSettings) {
    const { ChromaClient } = await import('chromadb')
    return new ChromaClient({
      host: settings.chroma_host,
      port: Number(settings.chroma_port),
      ssl: settings.chroma_ssl
    })
  }

  private static async getCollection(settings: VectorSearchSettings) {
    const client = await this.getClient(settings)
    return client.getOrCreateCollection({ name: COLLECTION_NAME, metadata: { embedding_model: settings.embedding_model } })
  }
}

export function chunkText(rawText: string): string[] {
  return rawText
    .split(/\n{2,}/)
    .map((chunk) => chunk.replace(/\s+/g, ' ').trim())
    .filter((chunk) => chunk.length >= 80)
    .flatMap((chunk) => chunk.length <= 1200 ? [chunk] : splitLongChunk(chunk))
    .slice(0, 24)
}

function splitLongChunk(chunk: string): string[] {
  const parts: string[] = []
  for (let index = 0; index < chunk.length; index += 1000) {
    parts.push(chunk.slice(index, index + 1200).trim())
  }
  return parts
}

function buildMetadata(candidate: SearchableCandidate, chunkIndex: number): ChromaCandidateMetadata {
  return {
    candidate_id: candidate.id,
    candidate_name: String(`${candidate.first_name || ''} ${candidate.last_name || ''}`.trim()),
    email: String(candidate.email || ''),
    phone: String(candidate.phone || ''),
    headline: String(candidate.headline || ''),
    job_type: String(candidate.job_type || ''),
    tags: candidate.tags || '[]',
    file_path: String(candidate.file_path || ''),
    chunk_index: chunkIndex,
    updated_at: candidate.updated_at || candidate.created_at || ''
  }
}

function assignSetting(settings: VectorSearchSettings, key: keyof VectorSearchSettings, value: string) {
  if (key === 'vector_search_enabled' || key === 'chroma_ssl') {
    settings[key] = value === 'true'
  } else if (key === 'chroma_port' || key === 'embedding_dimension') {
    settings[key] = Number(value)
  } else if (key === 'embedding_provider') {
    settings[key] = value as EmbeddingProviderName
  } else if (key === 'embedding_index_status') {
    settings[key] = value as VectorSearchSettings['embedding_index_status']
  } else if (key === 'vector_db_provider') {
    settings[key] = 'chromadb'
  } else {
    settings[key] = value
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
