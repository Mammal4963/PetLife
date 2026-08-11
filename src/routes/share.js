const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { useR2, UPLOADS_DIR } = require('../storage');

// Vet share links: a long random token in the URL grants read-only access to
// one pet's medical records. This router is mounted BEFORE the site-wide auth
// gate — the public routes use the token as their credential, and the
// management routes opt in to requireAuth individually.

const router = express.Router();

const NOT_EXPIRED = "(expires_at IS NULL OR expires_at > datetime('now'))";

router.get('/api/pets/:petId/shares', requireAuth, (req, res) => {
  res.json(db.prepare(`SELECT * FROM share_links WHERE pet_id = ? AND ${NOT_EXPIRED} ORDER BY id DESC`)
    .all(req.params.petId));
});

router.post('/api/pets/:petId/shares', requireAuth, express.json(), (req, res) => {
  const petId = req.params.petId;
  if (!db.prepare('SELECT id FROM pets WHERE id = ?').get(petId)) {
    return res.status(404).json({ error: 'pet not found' });
  }
  const days = Number(req.body && req.body.days);
  const token = crypto.randomBytes(16).toString('hex');
  const info = [7, 30, 90].includes(days)
    ? db.prepare("INSERT INTO share_links (pet_id, token, expires_at) VALUES (?, ?, datetime('now', ?))")
      .run(petId, token, `+${days} days`)
    : db.prepare('INSERT INTO share_links (pet_id, token) VALUES (?, ?)').run(petId, token);
  res.json(db.prepare('SELECT * FROM share_links WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/api/shares/:id', requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM share_links WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

function findShare(token) {
  if (!/^[0-9a-f]{32}$/.test(token || '')) return null;
  return db.prepare(`SELECT * FROM share_links WHERE token = ? AND ${NOT_EXPIRED}`).get(token);
}

router.get('/api/share/:token', (req, res) => {
  const share = findShare(req.params.token);
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
  const share = findShare(req.params.token);
  if (!share) return res.status(404).json({ error: 'This link is invalid or has expired' });
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND pet_id = ?')
    .get(req.params.docId, share.pet_id);
  if (!doc || !doc.storage_key) return res.status(404).json({ error: 'not found' });
  if (useR2) return res.redirect(doc.url);
  res.sendFile(path.join(UPLOADS_DIR, doc.storage_key));
});

module.exports = router;
