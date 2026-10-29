const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ceevee-version-test-'))
const db = new Database(':memory:')
db.exec(`
  CREATE TABLE candidates (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, phone TEXT, location TEXT, job_type TEXT, headline TEXT, summary TEXT, tags TEXT NOT NULL DEFAULT '[]', raw_text TEXT, file_path TEXT, status TEXT DEFAULT 'Pending Review', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, current_cv_version_id INTEGER, manual_fields TEXT NOT NULL DEFAULT '[]');
  CREATE TABLE candidate_cv_versions (id INTEGER PRIMARY KEY, candidate_id INTEGER NOT NULL, original_filename TEXT NOT NULL, source_path TEXT, managed_path TEXT, file_size INTEGER, content_hash TEXT, raw_text TEXT, parsed_snapshot TEXT NOT NULL, original_content_hash TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(candidate_id, content_hash));
  CREATE TABLE cv_match_reviews (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL UNIQUE, source_path TEXT NOT NULL, managed_path TEXT NOT NULL, original_filename TEXT NOT NULL, file_size INTEGER NOT NULL, content_hash TEXT NOT NULL, raw_text TEXT NOT NULL, parsed_snapshot TEXT NOT NULL, candidate_ids TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE cv_file_cleanup (managed_path TEXT PRIMARY KEY, last_error TEXT);
  CREATE TABLE cv_staged_files (managed_path TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE cv_merge_history (id INTEGER PRIMARY KEY, target_candidate_id INTEGER, source_candidate_id INTEGER, source_candidate_json TEXT, source_notion_json TEXT, merged_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE cv_reindex_jobs (candidate_id INTEGER PRIMARY KEY, operation TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE notion_sync_history (id INTEGER PRIMARY KEY, candidate_id INTEGER, status TEXT, notion_page_url TEXT);
  CREATE TABLE notion_candidate_pages (candidate_id INTEGER, page_id TEXT, page_url TEXT, synced_version_id INTEGER);
  CREATE TABLE document_tasks (id INTEGER PRIMARY KEY, status TEXT, candidate_id INTEGER, error_message TEXT, staged_path TEXT, staged_hash TEXT, staged_size INTEGER);
  CREATE TABLE job_search_history (id INTEGER PRIMARY KEY);
  CREATE TABLE app_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
`)
const filename = path.resolve(__dirname, 'CVVersionService.ts')
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
const loaded = new Module(filename, module)
loaded.filename = filename
loaded.paths = Module._nodeModulePaths(path.dirname(filename))
const originalRequire = loaded.require.bind(loaded)
let indexAvailable = false
loaded.require = (name) => name === 'electron' ? { app: { getPath: () => root } } : name === '../db' ? { __esModule: true, default: db } : name === './VectorSearchService' ? { VectorSearchService: { getSettings: () => ({ vector_search_enabled: true }), indexCandidate: async () => indexAvailable, deleteCandidate: async () => {} } } : originalRequire(name)
loaded._compile(code, filename)
const { CVVersionService: service } = loaded.exports
const source = (name, contents) => { const file = path.join(root, name); fs.writeFileSync(file, contents); return file }
const profile = (overrides = {}) => ({ first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com', phone: '123456789', headline: 'Engineer', summary: 'First summary', tags: ['Go'], ...overrides })
async function run() {
try {
  const one = source('first.pdf', 'one')
  const first = service.ingest(service.stageFile(one), 'first text', profile(), 1)
  assert.equal(first.review, false)
  const candidateId = first.candidateId
  assert.equal(service.list(candidateId).length, 1)
  assert.equal(await service.refreshIndex(candidateId), false)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cv_reindex_jobs').get().n, 1)
  indexAvailable = true
  assert.equal(await service.refreshIndex(candidateId), true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cv_reindex_jobs').get().n, 0)
  assert.equal(fs.existsSync(one), true)
  db.prepare("UPDATE candidates SET headline = 'Manual title', status = 'Hired', manual_fields = ? WHERE id = ?").run(JSON.stringify(['headline']), candidateId)
  const two = source('second.pdf', 'two')
  const second = service.ingest(service.stageFile(two), 'second text', profile({ summary: 'Second summary', headline: 'New title' }), 2)
  assert.equal(second.candidateId, candidateId)
  let candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId)
  assert.equal(candidate.headline, 'Manual title')
  assert.equal(candidate.status, 'Hired')
  assert.equal(candidate.summary, 'Second summary')
  const versions = service.list(candidateId)
  assert.equal(versions.length, 2)
  assert.equal(versions[0].file_size, 3)
  assert.equal(service.storageUsage(), 6)
  const dupe = source('same.pdf', 'two')
  assert.equal(service.ingest(service.stageFile(dupe), 'same', profile(), 3).duplicate, true)
  assert.equal(service.list(candidateId).length, 2)
  service.setCurrent(candidateId, versions[1].id)
  candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId)
  assert.equal(candidate.summary, 'First summary')
  assert.equal(candidate.headline, 'Manual title')
  const removedPath = db.prepare('SELECT managed_path FROM candidate_cv_versions WHERE id = ?').get(versions[1].id).managed_path
  const unlink = fs.unlinkSync
  fs.unlinkSync = (file) => { if (file === removedPath) { const error = new Error('access denied'); error.code = 'EACCES'; throw error } return unlink(file) }
  let deletion
  try { deletion = service.deleteVersion(candidateId, versions[1].id) } finally { fs.unlinkSync = unlink }
  assert.equal(deletion.fileRemoved, false)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cv_file_cleanup').get().n, 1)
  service.retryCleanup()
  assert.equal(fs.existsSync(removedPath), false)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cv_file_cleanup').get().n, 0)
  assert.equal(service.list(candidateId)[0].is_current, true)
  service.deleteVersion(candidateId, versions[0].id)
  candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId)
  assert.equal(candidate.current_cv_version_id, null)
  assert.equal(candidate.file_path, null)
  assert.equal(candidate.raw_text, null)
  assert.equal(candidate.status, 'Hired')
  assert.equal(fs.existsSync(one), true)
  assert.equal(fs.existsSync(two), true)

  const sharedSource = source('shared.pdf', 'shared content')
  const sharedCandidate = service.ingest(service.stageFile(sharedSource), 'shared text', profile({ first_name: 'Different', last_name: 'Person', email: 'other@example.com', phone: '999999999' }), 20).candidateId
  const sharedVersion = service.list(sharedCandidate)[0]
  const sharedPath = db.prepare('SELECT managed_path FROM candidate_cv_versions WHERE id = ?').get(sharedVersion.id).managed_path
  const secondSharedId = Number(db.prepare("INSERT INTO candidate_cv_versions (candidate_id, original_filename, managed_path, file_size, content_hash, raw_text, parsed_snapshot) VALUES (?, 'copy.pdf', ?, 14, NULL, 'shared text', '{}')").run(sharedCandidate, sharedPath).lastInsertRowid)
  service.deleteVersion(sharedCandidate, sharedVersion.id)
  assert.equal(fs.existsSync(sharedPath), true)
  service.deleteVersion(sharedCandidate, secondSharedId)
  assert.equal(fs.existsSync(sharedPath), false)
  assert.equal(fs.existsSync(sharedSource), true)

  const staleSource = source('stale.pdf', 'stale copy')
  const stale = service.stageFile(staleSource)
  db.prepare("UPDATE cv_staged_files SET created_at = datetime('now', '-2 days') WHERE managed_path = ?").run(stale.managedPath)
  service.recoverStagedFiles()
  assert.equal(fs.existsSync(stale.managedPath), false)
  assert.equal(fs.existsSync(staleSource), true)

  const reviewSource = source('review.pdf', 'different')
  const review = service.ingest(service.stageFile(reviewSource), 'review text', profile({ email: 'different@example.com' }), 4)
  assert.equal(review.review, true)
  assert.equal(service.getReview(4).candidates[0].id, candidateId)
  db.prepare("INSERT INTO document_tasks (id, status) VALUES (4, 'Needs Review')").run()
  assert.equal(service.resolveReview(4, candidateId).candidateId, candidateId)
  assert.equal(service.list(candidateId).length, 1)
  assert.equal(db.prepare('SELECT status FROM document_tasks WHERE id = 4').get().status, 'Complete')

  const sourceFile = source('legacy-duplicate.pdf', 'different')
  const duplicateId = Number(db.prepare("INSERT INTO candidates (first_name, last_name, email, phone, tags, raw_text, file_path, status) VALUES ('Alice', 'Smith', 'alice@example.com', '123456789', '[]', 'legacy text', ?, 'Interview')").run(sourceFile).lastInsertRowid)
  service.migrateLegacy()
  assert.ok(service.findDuplicateCandidates().some((pair) => pair.first.id === candidateId && pair.second.id === duplicateId))
  const countBeforeMerge = service.list(candidateId).length + service.list(duplicateId).length
  db.prepare("INSERT INTO notion_sync_history (candidate_id, status, notion_page_url) VALUES (?, 'Success', ?)").run(candidateId, 'https://notion.so/Target-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  db.prepare('INSERT INTO notion_candidate_pages (candidate_id, page_id, page_url) VALUES (?, ?, ?)').run(duplicateId, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'https://notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  service.mergeCandidates(candidateId, duplicateId)
  assert.equal(db.prepare('SELECT page_id FROM notion_candidate_pages WHERE candidate_id = ?').get(candidateId).page_id, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(JSON.parse(db.prepare('SELECT source_notion_json FROM cv_merge_history WHERE source_candidate_id = ?').get(duplicateId).source_notion_json).page_id, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  assert.equal(service.list(candidateId).length, countBeforeMerge)
  assert.ok(db.prepare('SELECT original_content_hash FROM candidate_cv_versions WHERE candidate_id = ? AND original_content_hash IS NOT NULL').get(candidateId))
  assert.equal(db.prepare('SELECT id FROM candidates WHERE id = ?').get(duplicateId), undefined)
  assert.equal(JSON.parse(db.prepare('SELECT source_candidate_json FROM cv_merge_history WHERE source_candidate_id = ?').get(duplicateId).source_candidate_json).status, 'Interview')
  assert.equal(db.prepare('SELECT status FROM candidates WHERE id = ?').get(candidateId).status, 'Hired')
  assert.equal(fs.existsSync(sourceFile), true)
  service.resetProfileToCurrentCv(candidateId)
  assert.equal(db.prepare('SELECT headline FROM candidates WHERE id = ?').get(candidateId).headline, 'Engineer')
  assert.equal(db.prepare('SELECT status FROM candidates WHERE id = ?').get(candidateId).status, 'Hired')
  assert.deepEqual(JSON.parse(db.prepare('SELECT manual_fields FROM candidates WHERE id = ?').get(candidateId).manual_fields), [])

  const missing = db.prepare("INSERT INTO candidates (first_name, last_name, tags, raw_text, file_path) VALUES ('Legacy', 'Missing', '[]', 'old text', ?)").run(path.join(root, 'missing.pdf')).lastInsertRowid
  service.migrateLegacy()
  const legacy = service.list(Number(missing))
  assert.equal(legacy.length, 1)
  assert.equal(legacy[0].available, false)
  assert.equal(legacy[0].raw_text, 'old text')
  assert.equal(service.copyExistingFiles().unavailable, 1)
  service.deleteAllData()
  console.log('CV versioning integration checks passed')
} finally {
  db.close()
  const managed = path.join(root, 'cv-files')
  if (fs.existsSync(managed)) { for (const entry of fs.readdirSync(managed)) fs.unlinkSync(path.join(managed, entry)); fs.rmdirSync(managed) }
  for (const entry of fs.readdirSync(root)) fs.unlinkSync(path.join(root, entry))
  fs.rmdirSync(root)
}
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
