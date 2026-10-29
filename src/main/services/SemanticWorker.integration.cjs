const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Worker } = require('node:worker_threads')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ceevee-semantic-test-'))
const dbPath = path.join(root, 'database.sqlite')
const workerPath = path.join(root, 'worker.cjs')
fs.writeFileSync(workerPath, ts.transpileModule(fs.readFileSync(path.join(__dirname, 'semantic-worker.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)
const db = new Database(dbPath)
db.exec(`CREATE TABLE candidates (id INTEGER PRIMARY KEY, current_cv_version_id INTEGER, status TEXT, job_type TEXT);
  CREATE TABLE cv_reindex_jobs (candidate_id INTEGER PRIMARY KEY);
  CREATE TABLE semantic_chunks (candidate_id INTEGER, version_id INTEGER, document TEXT, source TEXT, model TEXT, dimensions INTEGER, embedding BLOB);`)
const insertCandidate = db.prepare('INSERT INTO candidates VALUES (?, ?, ?, ?)')
const insertChunk = db.prepare('INSERT INTO semantic_chunks VALUES (?, ?, ?, ?, ?, ?, ?)')
db.transaction(() => {
  for (let i = 1; i <= 3000; i++) {
    insertCandidate.run(i, 1, i === 4 ? 'Hired' : 'Pending Review', 'IT')
    const values = new Float32Array(384)
    values[i === 1 ? 0 : 1] = 1
    insertChunk.run(i, i === 2 ? 2 : 1, `CV ${i}`, 'cv', 'test-model', 384, Buffer.from(values.buffer))
  }
  db.prepare('INSERT INTO cv_reindex_jobs VALUES (3)').run()
})()
db.close()
const worker = new Worker(workerPath, { workerData: { dbPath, model: 'test-model', cacheDir: root } })
const query = Array(384).fill(0); query[0] = 1
const started = performance.now()
let pass = 0
worker.on('message', async ({ result, error }) => {
  try {
    assert.ifError(error)
    if (pass++ === 0) {
      assert.equal(result.length, 2998)
      assert.equal(result[0].candidateId, 1)
      assert.equal(result[0].distance, 0)
      assert.ok(!result.some((item) => item.candidateId === 2 || item.candidateId === 3))
      console.log(`Semantic worker checks passed; 3000 chunks in ${Math.round(performance.now() - started)} ms including worker startup`)
      worker.postMessage({ id: 2, type: 'rank', query, limit: 1, filters: [{ id: 'status', value: 'Hired' }] })
    } else {
      assert.equal(result.length, 1)
      assert.equal(result[0].candidateId, 4)
      await worker.terminate()
      fs.rmSync(root, { recursive: true, force: true })
    }
  } catch (err) { console.error(err); process.exitCode = 1; await worker.terminate() }
})
worker.on('error', (err) => { console.error(err); process.exitCode = 1 })
worker.postMessage({ id: 1, type: 'rank', query })
