-- Share links grow a scope: 'medical' (one pet's records, the original kind)
-- or 'timeline' (read-only view of the whole timeline, no pet attached).
-- SQLite can't relax pet_id's NOT NULL in place, so rebuild the table.
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
