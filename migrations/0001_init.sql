-- PetLife schema (mirrors src/db.js for the self-hosted Node version)

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
