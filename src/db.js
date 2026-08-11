const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'petlife.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS pets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  species TEXT NOT NULL DEFAULT 'cat',
  breed TEXT,
  sex TEXT,
  birthdate TEXT,
  adopted_date TEXT,
  passed_date TEXT,
  photo_url TEXT,
  photo_key TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  body TEXT,
  post_date TEXT NOT NULL,
  youtube_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_pets (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, pet_id)
);

CREATE TABLE IF NOT EXISTS post_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  storage_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vet_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  visit_date TEXT NOT NULL,
  reason TEXT,
  vet_name TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS vaccinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date_given TEXT,
  due_date TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dose TEXT,
  frequency TEXT,
  start_date TEXT,
  end_date TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  weigh_date TEXT NOT NULL,
  weight REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'lb'
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  doc_date TEXT,
  url TEXT NOT NULL,
  storage_key TEXT,
  original_name TEXT
);

CREATE TABLE IF NOT EXISTS important_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER REFERENCES pets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  recurring INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS share_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id INTEGER REFERENCES pets(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'medical',
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);
`);

// Upgrade share_links tables created before the scope column existed
// (mirrors migrations/0003_share_scope.sql for the Workers backend).
const shareCols = db.prepare('PRAGMA table_info(share_links)').all().map((c) => c.name);
if (!shareCols.includes('scope')) {
  db.exec(`
    ALTER TABLE share_links RENAME TO share_links_old;
    CREATE TABLE share_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pet_id INTEGER REFERENCES pets(id) ON DELETE CASCADE,
      scope TEXT NOT NULL DEFAULT 'medical',
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
    INSERT INTO share_links (id, pet_id, scope, token, created_at, expires_at)
      SELECT id, pet_id, 'medical', token, created_at, expires_at FROM share_links_old;
    DROP TABLE share_links_old;
  `);
}

module.exports = { db, DATA_DIR };
