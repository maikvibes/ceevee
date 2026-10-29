import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

// Save database in appData for production, or local folder for dev
const dbPath = join(app.getPath('userData'), 'database.sqlite')
console.log(dbPath);
const db: Database.Database = new Database(dbPath)

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    birth_year INTEGER,
    website TEXT,
    headline TEXT,
    location TEXT,
    category TEXT,
    availability TEXT,
    job_type TEXT,
    salary_expectation TEXT,
    status TEXT DEFAULT 'Pending Review',
    tags TEXT NOT NULL, -- Stored as stringified JSON array
    summary TEXT,
    raw_text TEXT,
    file_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notion_sync_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL,
    notion_page_url TEXT,
    error_message TEXT,
    FOREIGN KEY (candidate_id) REFERENCES candidates (id)
  );

  CREATE TABLE IF NOT EXISTS document_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    status TEXT DEFAULT 'Queued',
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS custom_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_key_store (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL UNIQUE,
    encrypted_key TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    model TEXT,
    base_url TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ai_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE(provider, model_id)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_search_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_description TEXT NOT NULL,
    filters TEXT,
    result_count INTEGER DEFAULT 0,
    semantic_available INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`)

// CV history is additive: existing candidate IDs and recruiting data stay intact.
try {
  db.exec("ALTER TABLE candidates ADD COLUMN current_cv_version_id INTEGER;")
} catch (e: any) {
  if (!e.message.includes('duplicate column name')) throw e
}
try {
  db.transaction(() => {
    db.exec("ALTER TABLE candidates ADD COLUMN manual_fields TEXT NOT NULL DEFAULT '[]';")
    // Older records do not carry provenance, so protect their existing profile fields.
    const legacyFields = ['first_name', 'last_name', 'email', 'phone', 'location', 'job_type', 'headline', 'summary', 'tags']
    db.prepare('UPDATE candidates SET manual_fields = ?').run(JSON.stringify(legacyFields))
  })()
} catch (e: any) {
  if (!e.message.includes('duplicate column name')) throw e
}
try {
  db.exec("ALTER TABLE document_tasks ADD COLUMN candidate_id INTEGER;")
} catch (e: any) {
  if (!e.message.includes('duplicate column name')) throw e
}
for (const column of ['staged_path TEXT', 'staged_hash TEXT', 'staged_size INTEGER', 'provider TEXT']) {
  try { db.exec(`ALTER TABLE document_tasks ADD COLUMN ${column};`) }
  catch (e: any) { if (!e.message.includes('duplicate column name')) throw e }
}
db.exec(`
  CREATE TABLE IF NOT EXISTS candidate_cv_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id),
    original_filename TEXT NOT NULL,
    source_path TEXT,
    managed_path TEXT,
    file_size INTEGER,
    content_hash TEXT,
    raw_text TEXT,
    parsed_snapshot TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(candidate_id, content_hash)
  );
  CREATE INDEX IF NOT EXISTS cv_versions_candidate ON candidate_cv_versions(candidate_id, id DESC);
  CREATE INDEX IF NOT EXISTS cv_versions_source ON candidate_cv_versions(source_path);
  CREATE TABLE IF NOT EXISTS cv_merge_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_candidate_id INTEGER NOT NULL,
    source_candidate_id INTEGER NOT NULL,
    source_candidate_json TEXT NOT NULL,
    source_notion_json TEXT,
    merged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cv_match_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL UNIQUE,
    source_path TEXT NOT NULL,
    managed_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    parsed_snapshot TEXT NOT NULL,
    candidate_ids TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cv_reindex_jobs (
    candidate_id INTEGER PRIMARY KEY,
    operation TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS notion_candidate_pages (
    candidate_id INTEGER PRIMARY KEY REFERENCES candidates(id),
    page_id TEXT NOT NULL,
    page_url TEXT NOT NULL,
    synced_version_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS cv_staged_files (
    managed_path TEXT PRIMARY KEY,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cv_file_cleanup (
    managed_path TEXT PRIMARY KEY,
    last_error TEXT
  );
  CREATE TABLE IF NOT EXISTS semantic_chunks (
    candidate_id INTEGER NOT NULL,
    version_id INTEGER,
    chunk_index INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    document TEXT NOT NULL,
    source TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    PRIMARY KEY (candidate_id, chunk_index)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS candidate_search_fts USING fts5(first_name, last_name, headline, job_type, tags, summary, raw_text, content='candidates', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
  CREATE TRIGGER IF NOT EXISTS candidate_search_fts_insert AFTER INSERT ON candidates BEGIN
    INSERT INTO candidate_search_fts(rowid, first_name, last_name, headline, job_type, tags, summary, raw_text) VALUES (new.id, new.first_name, new.last_name, new.headline, new.job_type, new.tags, new.summary, new.raw_text);
  END;
  CREATE TRIGGER IF NOT EXISTS candidate_search_fts_delete AFTER DELETE ON candidates BEGIN
    INSERT INTO candidate_search_fts(candidate_search_fts, rowid, first_name, last_name, headline, job_type, tags, summary, raw_text) VALUES ('delete', old.id, old.first_name, old.last_name, old.headline, old.job_type, old.tags, old.summary, old.raw_text);
    DELETE FROM semantic_chunks WHERE candidate_id = old.id;
  END;
  CREATE TRIGGER IF NOT EXISTS candidate_search_fts_update AFTER UPDATE ON candidates BEGIN
    INSERT INTO candidate_search_fts(candidate_search_fts, rowid, first_name, last_name, headline, job_type, tags, summary, raw_text) VALUES ('delete', old.id, old.first_name, old.last_name, old.headline, old.job_type, old.tags, old.summary, old.raw_text);
    INSERT INTO candidate_search_fts(rowid, first_name, last_name, headline, job_type, tags, summary, raw_text) VALUES (new.id, new.first_name, new.last_name, new.headline, new.job_type, new.tags, new.summary, new.raw_text);
  END;
`)

// Existing Chroma indexes cannot be reused as local embeddings. Require an explicit
// opt-in before downloading a model, and keep old external data untouched.
db.transaction(() => {
  const migrated = db.prepare("SELECT 1 FROM app_settings WHERE setting_key = 'sqlite_semantic_migrated'").get()
  if (!migrated) {
    db.prepare("INSERT INTO candidate_search_fts(candidate_search_fts) VALUES ('rebuild')").run()
    db.prepare("INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES ('vector_search_enabled', 'false')").run()
    db.prepare("INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES ('embedding_index_status', 'not_indexed')").run()
    db.prepare("INSERT INTO cv_reindex_jobs (candidate_id, operation, revision) SELECT id, 'upsert', 1 FROM candidates WHERE 1 ON CONFLICT(candidate_id) DO UPDATE SET operation = 'upsert', revision = revision + 1").run()
    db.prepare("INSERT INTO app_settings (setting_key, setting_value) VALUES ('sqlite_semantic_migrated', 'true')").run()
  }
})()

try {
  db.exec('ALTER TABLE candidate_cv_versions ADD COLUMN original_content_hash TEXT;')
} catch (e: any) {
  if (!e.message.includes('duplicate column name')) throw e
}

// Seed default job types if they don't exist
const defaultJobTypes = [
  'IT', 'Design', 'Marketing / Advertising', 'HR', 'Administrator', 
  'Education', 'Management', 'Sales & BD & Account', 'Product', 
  'Other', 'Legal', 'Consultants', 'Advisors', 'Electrical & Mechanical Engineer'
]
const insertJobType = db.prepare('INSERT OR IGNORE INTO custom_tags (name, category) VALUES (?, ?)')
db.transaction(() => {
  for (const jt of defaultJobTypes) {
    insertJobType.run(jt, 'JobType')
  }
})()

// Migration for existing databases
try {
  db.exec('ALTER TABLE api_key_store ADD COLUMN base_url TEXT;')
} catch (e: any) {
  if (!e.message.includes('duplicate column name')) throw e
}

try {
  db.exec('ALTER TABLE api_key_store ADD COLUMN model TEXT;')
} catch (e: any) {
  // Ignore if column already exists
}

try {
  db.exec('ALTER TABLE candidates ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;')
} catch (e: any) {
  if (!e.message.includes('duplicate column name')) {
    console.error('[db] Error adding updated_at to candidates:', e.message)
  }
}

try {
  db.exec('ALTER TABLE document_tasks ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;')
} catch (e: any) {
  if (!e.message.includes('duplicate column name')) {
    console.error('[db] Error adding updated_at to document_tasks:', e.message)
  }
}

export let hasCandidatesUpdatedAt = false
export let hasTasksUpdatedAt = false

try {
  db.prepare('SELECT updated_at FROM candidates LIMIT 1').get()
  hasCandidatesUpdatedAt = true
} catch (e) {}

try {
  db.prepare('SELECT updated_at FROM document_tasks LIMIT 1').get()
  hasTasksUpdatedAt = true
} catch (e) {}

export default db
