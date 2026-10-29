const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ceevee-migration-test-'))
const dataFile = path.join(root, 'existing.pdf')
const missingFile = path.join(root, 'missing.pdf')
fs.writeFileSync(dataFile, 'original CV')
const legacy = new Database(path.join(root, 'database.sqlite'))
legacy.exec(`CREATE TABLE candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  email TEXT, phone TEXT, birth_year INTEGER, website TEXT, headline TEXT, location TEXT,
  category TEXT, availability TEXT, job_type TEXT, salary_expectation TEXT,
  status TEXT DEFAULT 'Pending Review', tags TEXT NOT NULL, summary TEXT, raw_text TEXT, file_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`)
legacy.prepare("INSERT INTO candidates (first_name, last_name, tags, raw_text, file_path, headline) VALUES (?, ?, '[]', ?, ?, ?)").run('Existing', 'Person', 'existing text', dataFile, 'Manually set')
legacy.prepare("INSERT INTO candidates (first_name, last_name, tags, raw_text, file_path) VALUES (?, ?, '[]', ?, ?)").run('Missing', 'Person', 'saved text', missingFile)
legacy.prepare("INSERT INTO candidates (first_name, last_name, tags, raw_text, file_path) VALUES (?, ?, '[]', ?, NULL)").run('Text', 'Only', 'saved text only')
legacy.prepare("INSERT INTO candidates (first_name, last_name, email, tags, headline) VALUES ('NoCV', 'Person', 'nocv@example.com', '[]', 'Protected title')").run()
legacy.close()

function loadTs(filename, overrides) {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  const originalRequire = loaded.require.bind(loaded)
  loaded.require = (name) => Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : originalRequire(name)
  loaded._compile(code, filename)
  return loaded.exports
}
const app = { getPath: () => root }
let db
try {
  const dbModule = loadTs(path.resolve(__dirname, '../db.ts'), { electron: { app } })
  db = dbModule.default
  assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'vector_search_enabled'").get().setting_value, 'false')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cv_reindex_jobs').get().n, 4)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM candidate_search_fts WHERE candidate_search_fts MATCH 'Manually'").get().n, 1)
  db.prepare("UPDATE candidates SET headline = 'Searchable title' WHERE id = 1").run()
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM candidate_search_fts WHERE candidate_search_fts MATCH 'Searchable'").get().n, 1)
  db.prepare("UPDATE candidates SET headline = 'Manually set' WHERE id = 1").run()
  const { CVVersionService: service } = loadTs(path.resolve(__dirname, 'CVVersionService.ts'), {
    electron: { app }, '../db': dbModule,
    './VectorSearchService': { VectorSearchService: { getSettings: () => ({ vector_search_enabled: false }), indexCandidate: async () => true, deleteCandidate: async () => {} } }
  })
  service.migrateLegacy()
  assert.equal(service.list(1).length, 1)
  assert.equal(service.list(1)[0].available, true)
  assert.equal(service.list(2)[0].available, false)
  assert.equal(service.list(3)[0].available, false)
  assert.equal(service.list(3)[0].raw_text, 'saved text only')
  assert.equal(fs.readFileSync(dataFile, 'utf8'), 'original CV')
  assert.ok(JSON.parse(db.prepare('SELECT manual_fields FROM candidates WHERE id = 1').get().manual_fields).includes('headline'))
  service.migrateLegacy()
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM candidate_cv_versions').get().n, 3)
  assert.ok(JSON.parse(db.prepare('SELECT manual_fields FROM candidates WHERE id = 4').get().manual_fields).includes('headline'))
  const newSource = path.join(root, 'new.pdf')
  fs.writeFileSync(newSource, 'new CV')
  assert.equal(service.ingest(service.stageFile(newSource), 'new text', { first_name: 'NoCV', last_name: 'Person', email: 'nocv@example.com', headline: 'New title', tags: [] }, 10).candidateId, 4)
  assert.equal(db.prepare('SELECT headline FROM candidates WHERE id = 4').get().headline, 'Protected title')
  fs.writeFileSync(missingFile, 'restored original')
  const report = service.copyExistingFiles()
  assert.equal(report.copied, 1)
  assert.equal(service.list(2)[0].available, true)
  assert.equal(fs.readFileSync(missingFile, 'utf8'), 'restored original')
  service.deleteAllData()
  console.log('Legacy CV migration checks passed')
} finally {
  if (db) db.close()
  const managed = path.join(root, 'cv-files')
  if (fs.existsSync(managed)) { for (const entry of fs.readdirSync(managed)) fs.unlinkSync(path.join(managed, entry)); fs.rmdirSync(managed) }
  for (const entry of fs.readdirSync(root)) fs.unlinkSync(path.join(root, entry))
  fs.rmdirSync(root)
}
