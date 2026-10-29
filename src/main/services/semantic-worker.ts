import { parentPort, workerData } from 'node:worker_threads'
import Database from 'better-sqlite3'

if (!parentPort) throw new Error('Semantic worker must run in a worker thread')
const port = parentPort
let extractor: Promise<(texts: string[], options: object) => Promise<{ tolist(): number[][] }>> | undefined
let queue = Promise.resolve()

port.on('message', (message: { id: number; type: string; texts?: string[]; query?: number[]; limit?: number; filters?: { id: string; value: string | number | boolean | null }[] }) => {
  queue = queue.then(async () => {
    try {
      if (message.type === 'embed') {
        if (!extractor) {
          extractor = (async () => {
            const { env, pipeline } = await import('@huggingface/transformers')
            env.cacheDir = workerData.cacheDir
            return await pipeline('feature-extraction', workerData.model, { dtype: workerData.dtype || 'q4' }) as unknown as (texts: string[], options: object) => Promise<{ tolist(): number[][] }>
          })().catch((error) => { extractor = undefined; throw error })
        }
        const model = await extractor
        const output = await model(message.texts || [], { pooling: 'mean', normalize: true })
        port.postMessage({ id: message.id, result: output.tolist() })
      } else if (message.type === 'rank') {
        const query = message.query || []
        const db = new Database(workerData.dbPath, { readonly: true, fileMustExist: true })
        const best = new Map<number, { candidateId: number; document: string; source: string; distance: number }>()
        try {
          const filters = (message.filters || []).filter((filter) => (filter.id === 'status' || filter.id === 'job_type') && filter.value && filter.value !== 'all')
          const conditions = filters.map((filter) => ` AND c.${filter.id} = ?`).join('')
          const rows = db.prepare(`SELECT s.candidate_id AS candidateId, s.document, s.source, s.embedding FROM semantic_chunks s JOIN candidates c ON c.id = s.candidate_id WHERE s.model = ? AND s.dimensions = ? AND s.version_id IS c.current_cv_version_id AND NOT EXISTS (SELECT 1 FROM cv_reindex_jobs j WHERE j.candidate_id = s.candidate_id)${conditions}`).iterate(workerData.model, query.length, ...filters.map((filter) => filter.value)) as Iterable<{ candidateId: number; document: string; source: string; embedding: Buffer }>
          const queryNorm = query.reduce((sum, value) => sum + value * value, 0)
          for (const row of rows) {
            const bytes = row.embedding
            const vector = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
            let dot = 0, norm = 0
            for (let i = 0; i < vector.length; i++) { dot += vector[i] * query[i]; norm += vector[i] ** 2 }
            const distance = 1 - dot / (Math.sqrt(norm * queryNorm) || 1)
            if (!best.has(row.candidateId) || distance < best.get(row.candidateId)!.distance) best.set(row.candidateId, { candidateId: row.candidateId, document: row.document, source: row.source, distance })
          }
        } finally { db.close() }
        const ranked = [...best.values()].sort((a, b) => a.distance - b.distance).slice(0, message.limit || best.size)
        port.postMessage({ id: message.id, result: ranked })
      }
    } catch (error) {
      port.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) })
    }
  })
})
