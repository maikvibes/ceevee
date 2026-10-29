const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ceevee-local-index-'))
const app = { getPath: () => root }
function loadTs(filename, overrides) {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const loaded = new Module(filename, module); loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  const originalRequire = loaded.require.bind(loaded)
  loaded.require = (name) => Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : originalRequire(name)
  loaded._compile(code, filename); return loaded.exports
}
const dbModule = loadTs(path.resolve(__dirname, '../db.ts'), { electron: { app } })
const db = dbModule.default
let calls = 0, mutate = true
class FakeWorker extends EventEmitter {
  postMessage(message) {
    calls++
    if (mutate) { mutate = false; db.prepare('UPDATE cv_reindex_jobs SET revision = revision + 1 WHERE candidate_id = 1').run() }
    const vector = Array(384).fill(0); vector[0] = 1
    setImmediate(() => this.emit('message', { id: message.id, result: message.texts.map(() => vector) }))
  }
}
const { VectorSearchService: service } = loadTs(path.resolve(__dirname, 'VectorSearchService.ts'), { electron: { app }, '../db': dbModule, 'node:worker_threads': { Worker: FakeWorker } })
async function run() {
  db.prepare("INSERT INTO candidates (first_name, last_name, tags, raw_text) VALUES ('Test', 'Person', '[]', 'a useful CV document')").run()
  db.prepare("INSERT INTO cv_reindex_jobs VALUES (1, 'upsert', 1)").run()
  service.saveSettings({ vector_search_enabled: true })
  assert.equal(await service.indexCandidate(1, true, 1), false)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semantic_chunks').get().n, 0)
  assert.equal(await service.indexCandidate(1, true, 2), true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semantic_chunks').get().n, 1)
  const afterEmbedding = calls
  assert.equal(await service.indexCandidate(1, true, 2), true)
  assert.equal(calls, afterEmbedding, 'unchanged chunks should reuse embeddings')
  db.prepare("UPDATE candidates SET raw_text = '[Document analyzed via model]', summary = 'Experienced developer' WHERE id = 1").run()
  assert.equal(await service.indexCandidate(1, true, 2), true)
  const chunk = db.prepare('SELECT source, document FROM semantic_chunks').get()
  assert.equal(chunk.source, 'profile')
  assert.ok(chunk.document.includes('Experienced developer'))
  assert.ok(!chunk.document.includes('Document analyzed'))
  db.prepare('DELETE FROM candidates WHERE id = 1').run()
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM semantic_chunks').get().n, 0)
  console.log('Local index integration checks passed')
}
run().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }) })
