import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

// Save database in appData for production, or local folder for dev
const dbPath = join(app.getPath('userData'), 'database.sqlite')
console.log(dbPath);
const db = new Database(dbPath)

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
`)

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
  db.exec('ALTER TABLE api_key_store ADD COLUMN model TEXT;')
} catch (e: any) {
  // Ignore if column already exists
}

try {
  db.exec('ALTER TABLE candidates ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;')
} catch (e: any) {
  // Ignore if column already exists
}

export default db
