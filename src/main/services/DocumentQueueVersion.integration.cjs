const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ceevee-queue-integration-'))
const app = { getPath: () => root }

function loadTs(filename, overrides) {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  const original = loaded.require.bind(loaded)
  loaded.require = (name) => Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : original(name)
  loaded._compile(code, filename)
  return loaded.exports
}
const dbModule = loadTs(path.resolve(__dirname, '../db.ts'), { electron: { app } })
const db = dbModule.default
const vector = { getSettings: () => ({ vector_search_enabled: false }), indexCandidate: async () => true, deleteCandidate: async () => {} }
const { CVVersionService: versions } = loadTs(path.resolve(__dirname, 'CVVersionService.ts'), { electron: { app }, '../db': dbModule, './VectorSearchService': { VectorSearchService: vector } })
let mode = 'gate'
let release
const parse = async () => mode === 'gate' ? new Promise((resolve) => { release = resolve }) : mode === 'fail' ? '' : 'Second readable CV text '.repeat(10)
const analyze = async (text) => ({ first_name: text.includes('Second') ? 'Bob' : 'Alice', last_name: 'Example', email: text.includes('Second') ? 'bob@example.com' : 'alice@example.com', phone: '', headline: 'Engineer', summary: 'Summary', tags: [] })
const { DocumentQueueService } = loadTs(path.resolve(__dirname, 'DocumentQueueService.ts'), {
  '../db': dbModule, './CVVersionService': { CVVersionService: versions },
  './FileParsingService': { FileParsingService: { parseFile: parse } },
  './AIProcessingService': { AIProcessingService: { extractCandidateData: analyze } },
  './KeyStoreService': { KeyStoreService: { decrypt: () => 'key' } },
  './NotionSyncService': { NotionSyncService: { isAutoSyncEnabled: () => false } },
  electron: { app }
})
const queue = new DocumentQueueService()
const waitFor = async (fn) => { for (let i = 0; i < 300; i++) { const result = fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 10)) } throw new Error('Timed out waiting for queued document') }
async function run() {
  try {
    db.prepare("INSERT INTO api_key_store (provider, encrypted_key, iv, auth_tag, model) VALUES ('openai', 'key', 'iv', 'tag', 'model')").run()
    db.prepare("INSERT INTO app_settings (setting_key, setting_value) VALUES ('llm_ocr_enabled', 'false')").run()
    const first = path.join(root, 'first.pdf')
    fs.writeFileSync(first, 'first document')
    await queue.enqueueNew(first, 'openai')
    const firstTask = db.prepare('SELECT * FROM document_tasks WHERE file_path = ?').get(first)
    assert.ok(firstTask.staged_path && fs.existsSync(firstTask.staged_path))
    assert.equal(firstTask.provider, 'openai')
    fs.unlinkSync(first)
    await waitFor(() => release)
    release('Readable CV content '.repeat(10))
    const completed = await waitFor(() => { const row = db.prepare('SELECT * FROM document_tasks WHERE id = ?').get(firstTask.id); return row.status === 'Complete' && row })
    assert.ok(completed.candidate_id)
    const firstVersion = versions.list(completed.candidate_id)[0]
    assert.equal(firstVersion.available, true)
    assert.equal(firstVersion.original_filename, 'first.pdf')

    mode = 'fail'
    const second = path.join(root, 'second.pdf')
    fs.writeFileSync(second, 'second document')
    await queue.enqueueNew(second, 'openai')
    const secondTask = db.prepare('SELECT * FROM document_tasks WHERE file_path = ?').get(second)
    fs.unlinkSync(second)
    const failed = await waitFor(() => { const row = db.prepare('SELECT * FROM document_tasks WHERE id = ?').get(secondTask.id); return row.status === 'Failed' && row })
    assert.ok(failed.staged_path && fs.existsSync(failed.staged_path))
    mode = 'success'
    await queue.retryTask(secondTask.id)
    const retried = await waitFor(() => { const row = db.prepare('SELECT * FROM document_tasks WHERE id = ?').get(secondTask.id); return row.status === 'Complete' && row })
    assert.equal(versions.list(retried.candidate_id)[0].original_filename, 'second.pdf')
    assert.equal(fs.existsSync(second), false)
    versions.deleteAllData()
    console.log('Durable queue integration checks passed')
  } finally {
    db.close()
    const managed = path.join(root, 'cv-files')
    if (fs.existsSync(managed)) { for (const entry of fs.readdirSync(managed)) fs.unlinkSync(path.join(managed, entry)); fs.rmdirSync(managed) }
    for (const entry of fs.readdirSync(root)) fs.unlinkSync(path.join(root, entry))
    fs.rmdirSync(root)
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
