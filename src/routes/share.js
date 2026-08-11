const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { useR2, UPLOADS_DIR } = require('../storage');

// Share links: a long random token in the URL grants read-only access with no
// password. Two scopes — 'medical' (one pet's records, for the vet) and
// 'timeline' (the whole photo timeline, for family and friends). This router
// is mounted BEFORE the site-wide auth gate — the public routes use the token
// as their credential, and the management routes opt in to requireAuth.

const router = express.Router();

const NOT_EXPIRED = "(expires_at IS NULL OR expires_at > datetime('now'))";

// Accepts full YouTube URLs, youtu.be links, or Shorts links; returns the video id or null.
function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}

function insertShare({ petId = null, scope, days }) {
  const token = crypto.randomBytes(16).toString('hex');
  const info = [7, 30, 90].includes(days)
    ? db.prepare("INSERT INTO share_links (pet_id, scope, token, expires_at) VALUES (?, ?, ?, datetime('now', ?))")
      .run(petId, scope, token, `+${days} days`)
    : db.prepare('INSERT INTO share_links (pet_id, scope, token) VALUES (?, ?, ?)').run(petId, scope, token);
  return db.prepare('SELECT * FROM share_links WHERE id = ?').get(info.lastInsertRowid);
}

router.get('/api/pets/:petId/shares', requireAuth, (req, res) => {
  res.json(db.prepare(`SELECT * FROM share_links WHERE pet_id = ? AND scope = 'medical' AND ${NOT_EXPIRED} ORDER BY id DESC`)
    .all(req.params.petId));
});

router.post('/api/pets/:petId/shares', requireAuth, express.json(), (req, res) => {
  const petId = req.params.petId;
  if (!db.prepare('SELECT id FROM pets WHERE id = ?').get(petId)) {
    return res.status(404).json({ error: 'pet not found' });
  }
  res.json(insertShare({ petId, scope: 'medical', days: Number(req.body && req.body.days) }));
});

router.get('/api/timeline-shares', requireAuth, (req, res) => {
  res.json(db.prepare(`SELECT * FROM share_links WHERE scope = 'timeline' AND ${NOT_EXPIRED} ORDER BY id DESC`).all());
});

router.post('/api/timeline-shares', requireAuth, express.json(), (req, res) => {
  res.json(insertShare({ scope: 'timeline', days: Number(req.body && req.body.days) }));
});

router.delete('/api/shares/:id', requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM share_links WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

function findShare(token, scope) {
  if (!/^[0-9a-f]{32}$/.test(token || '')) return null;
  return db.prepare(`SELECT * FROM share_links WHERE token = ? AND scope = ? AND ${NOT_EXPIRED}`).get(token, scope);
}

// ---- medical scope ---------------------------------------------------------

router.get('/api/share/:token', (req, res) => {
  const share = findShare(req.params.token, 'medical');
  if (!share) return res.status(404).json({ error: 'This link is invalid or has expired' });
  const id = share.pet_id;
  // Medical records only — no photos, posts, or notes meant for the family.
  const pet = db.prepare(
    'SELECT id, name, species, breed, sex, birthdate, adopted_date, passed_date FROM pets WHERE id = ?').get(id);
  if (!pet) return res.status(404).json({ error: 'This link is invalid or has expired' });
  pet.visits = db.prepare('SELECT * FROM vet_visits WHERE pet_id = ? ORDER BY visit_date DESC').all(id);
  pet.vaccinations = db.prepare('SELECT * FROM vaccinations WHERE pet_id = ? ORDER BY COALESCE(due_date, date_given) DESC').all(id);
  pet.medications = db.prepare('SELECT * FROM medications WHERE pet_id = ? ORDER BY start_date DESC').all(id);
  pet.weights = db.prepare('SELECT * FROM weights WHERE pet_id = ? ORDER BY weigh_date DESC').all(id);
  pet.documents = db.prepare('SELECT id, title, doc_date FROM documents WHERE pet_id = ? ORDER BY COALESCE(doc_date, id) DESC').all(id);
  res.json(pet);
});

router.get('/api/share/:token/documents/:docId', (req, res) => {
  const share = findShare(req.params.token, 'medical');
  if (!share) return res.status(404).json({ error: 'This link is invalid or has expired' });
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND pet_id = ?')
    .get(req.params.docId, share.pet_id);
  if (!doc || !doc.storage_key) return res.status(404).json({ error: 'not found' });
  if (useR2) return res.redirect(doc.url);
  res.sendFile(path.join(UPLOADS_DIR, doc.storage_key));
});

// ---- timeline scope --------------------------------------------------------

router.get('/api/timeline-share/:token', (req, res) => {
  const share = findShare(req.params.token, 'timeline');
  if (!share) return res.status(404).json({ error: 'This link is invalid or has expired' });
  // Local-disk media goes through the tokened route below; R2 media urls are
  // already public (R2_PUBLIC_URL), so they pass through unchanged.
  const mediaUrl = (key, url) => (url && /^https?:/.test(url))
    ? url
    : `/api/timeline-share/${share.token}/media/${key}`;

  const pets = db.prepare(
    'SELECT id, name, species, breed, birthdate, adopted_date, passed_date, photo_key, photo_url FROM pets ORDER BY passed_date IS NOT NULL, name')
    .all().map((p) => ({
      id: p.id,
      name: p.name,
      species: p.species,
      breed: p.breed,
      birthdate: p.birthdate,
      adopted_date: p.adopted_date,
      passed_date: p.passed_date,
      photo_url: p.photo_key ? mediaUrl(p.photo_key, p.photo_url) : null,
    }));

  const posts = db.prepare('SELECT id, title, body, post_date, youtube_url FROM posts ORDER BY post_date DESC, id DESC')
    .all().map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      post_date: p.post_date,
      youtube_id: youtubeId(p.youtube_url),
      media: db.prepare('SELECT storage_key, url FROM post_media WHERE post_id = ? ORDER BY id').all(p.id)
        .map((m) => ({ url: mediaUrl(m.storage_key, m.url) })),
      pets: db.prepare(
        'SELECT p.id, p.name FROM pets p JOIN post_pets pp ON pp.pet_id = p.id WHERE pp.post_id = ? ORDER BY p.name').all(p.id),
    }));

  res.json({ pets, posts });
});

router.get('/api/timeline-share/:token/media/*', (req, res) => {
  const share = findShare(req.params.token, 'timeline');
  if (!share) return res.status(404).json({ error: 'not found' });
  const key = decodeURIComponent(req.params[0] || '');
  if (!key || key.includes('..')) return res.status(404).json({ error: 'not found' });
  // A timeline token only unlocks media the timeline actually shows —
  // post photos and pet portraits, never medical documents.
  const referenced = db.prepare(
    'SELECT 1 AS ok FROM post_media WHERE storage_key = ? UNION SELECT 1 FROM pets WHERE photo_key = ?').get(key, key);
  if (!referenced) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(UPLOADS_DIR, key));
});

module.exports = router;
