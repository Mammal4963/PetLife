const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { saveFile, deleteFile } = require('../storage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 12 } });

// Accepts full YouTube URLs, youtu.be links, or Shorts links; returns the video id or null.
function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}

// Normalize a start/end pair: blank or same-day end collapses to null,
// reversed dates swap.
function dateRange(start, endRaw) {
  let s = start;
  let end = endRaw && String(endRaw).trim() ? String(endRaw) : null;
  if (end && s && end < s) [s, end] = [end, s];
  if (end === s) end = null;
  return { start: s, end };
}

function loadPost(id) {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!post) return null;
  post.media = db.prepare('SELECT id, url FROM post_media WHERE post_id = ? ORDER BY id').all(id)
    .map((m) => ({
      ...m,
      pets: db.prepare(
        'SELECT p.id, p.name FROM media_pets mp JOIN pets p ON p.id = mp.pet_id WHERE mp.media_id = ? ORDER BY p.name'
      ).all(m.id),
    }));
  post.pets = db.prepare(
    'SELECT p.id, p.name FROM pets p JOIN post_pets pp ON pp.pet_id = p.id WHERE pp.post_id = ? ORDER BY p.name'
  ).all(id);
  post.youtube_id = youtubeId(post.youtube_url);
  return post;
}

router.get('/api/posts', (req, res) => {
  const { pet_id } = req.query;
  let rows;
  if (pet_id) {
    rows = db.prepare(
      'SELECT DISTINCT posts.id FROM posts JOIN post_pets pp ON pp.post_id = posts.id WHERE pp.pet_id = ? ORDER BY posts.post_date DESC, posts.id DESC'
    ).all(pet_id);
  } else {
    rows = db.prepare('SELECT id FROM posts ORDER BY post_date DESC, id DESC').all();
  }
  res.json(rows.map((r) => loadPost(r.id)));
});

router.post('/api/posts', upload.array('photos'), async (req, res) => {
  const { title, body, post_date, youtube_url } = req.body;
  if (!post_date) return res.status(400).json({ error: 'Date is required' });
  if (youtube_url && !youtubeId(youtube_url)) {
    return res.status(400).json({ error: "That doesn't look like a YouTube link" });
  }
  const hasContent = (title && title.trim()) || (body && body.trim()) || youtube_url || (req.files && req.files.length);
  if (!hasContent) return res.status(400).json({ error: 'Add a photo, video link, or some text' });

  const range = dateRange(post_date, req.body.post_date_end);
  const info = db.prepare('INSERT INTO posts (title, body, post_date, post_date_end, youtube_url) VALUES (?, ?, ?, ?, ?)')
    .run(title || null, body || null, range.start, range.end, youtube_url || null);
  const postId = info.lastInsertRowid;

  let petIds = req.body.pet_ids || [];
  if (!Array.isArray(petIds)) petIds = [petIds];
  const linkPet = db.prepare('INSERT OR IGNORE INTO post_pets (post_id, pet_id) VALUES (?, ?)');
  for (const pid of petIds) {
    if (db.prepare('SELECT id FROM pets WHERE id = ?').get(pid)) linkPet.run(postId, pid);
  }

  // Optional per-photo pet tags: a JSON array of pet-id arrays, aligned with
  // the photos in upload order, e.g. [[1,2],[1]] for two photos.
  let photoTags = [];
  try {
    const parsed = JSON.parse(req.body.photo_pets || '[]');
    if (Array.isArray(parsed)) photoTags = parsed;
  } catch { /* ignore malformed tags — photos still save untagged */ }

  const insertMedia = db.prepare('INSERT INTO post_media (post_id, url, storage_key) VALUES (?, ?, ?)');
  const tagMedia = db.prepare('INSERT OR IGNORE INTO media_pets (media_id, pet_id) VALUES (?, ?)');
  let photoIndex = 0;
  for (const file of req.files || []) {
    if (!file.mimetype.startsWith('image/')) continue;
    const saved = await saveFile(file.buffer, file.originalname, file.mimetype);
    const mediaId = insertMedia.run(postId, saved.url, saved.key).lastInsertRowid;
    const tags = Array.isArray(photoTags[photoIndex]) ? photoTags[photoIndex] : [];
    for (const pid of tags) {
      if (db.prepare('SELECT id FROM pets WHERE id = ?').get(pid)) tagMedia.run(mediaId, pid);
    }
    photoIndex++;
  }

  res.json(loadPost(postId));
});

router.put('/api/posts/:id', upload.array('photos'), async (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'not found' });
  }
  const { title, body, post_date, youtube_url } = req.body;
  if (!post_date) return res.status(400).json({ error: 'Date is required' });
  if (youtube_url && !youtubeId(youtube_url)) {
    return res.status(400).json({ error: "That doesn't look like a YouTube link" });
  }
  const range = dateRange(post_date, req.body.post_date_end);
  db.prepare('UPDATE posts SET title = ?, body = ?, post_date = ?, post_date_end = ?, youtube_url = ? WHERE id = ?')
    .run(title || null, body || null, range.start, range.end, youtube_url || null, id);

  // Post-level pets: replace with the submitted set.
  db.prepare('DELETE FROM post_pets WHERE post_id = ?').run(id);
  let petIds = req.body.pet_ids || [];
  if (!Array.isArray(petIds)) petIds = [petIds];
  const linkPet = db.prepare('INSERT OR IGNORE INTO post_pets (post_id, pet_id) VALUES (?, ?)');
  for (const pid of petIds) {
    if (db.prepare('SELECT id FROM pets WHERE id = ?').get(pid)) linkPet.run(id, pid);
  }

  // Removed photos: delete rows (media_pets cascades) and the stored files.
  let removeIds = [];
  try {
    const parsed = JSON.parse(req.body.remove_media || '[]');
    if (Array.isArray(parsed)) removeIds = parsed.map(Number).filter(Number.isFinite);
  } catch { /* ignore */ }
  for (const mid of removeIds) {
    const m = db.prepare('SELECT id, storage_key FROM post_media WHERE id = ? AND post_id = ?').get(mid, id);
    if (!m) continue;
    db.prepare('DELETE FROM post_media WHERE id = ?').run(m.id);
    await deleteFile(m.storage_key);
  }

  // Re-tag remaining photos: {media_id: [pet_ids]} replaces each photo's tags.
  let mediaTags = {};
  try {
    const parsed = JSON.parse(req.body.media_pets || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) mediaTags = parsed;
  } catch { /* ignore */ }
  const tagMedia = db.prepare('INSERT OR IGNORE INTO media_pets (media_id, pet_id) VALUES (?, ?)');
  for (const [mid, pids] of Object.entries(mediaTags)) {
    const m = db.prepare('SELECT id FROM post_media WHERE id = ? AND post_id = ?').get(Number(mid), id);
    if (!m || !Array.isArray(pids)) continue;
    db.prepare('DELETE FROM media_pets WHERE media_id = ?').run(m.id);
    for (const pid of pids) {
      if (db.prepare('SELECT id FROM pets WHERE id = ?').get(pid)) tagMedia.run(m.id, pid);
    }
  }

  // New photos, tagged the same way as on create.
  let photoTags = [];
  try {
    const parsed = JSON.parse(req.body.photo_pets || '[]');
    if (Array.isArray(parsed)) photoTags = parsed;
  } catch { /* ignore */ }
  const insertMedia = db.prepare('INSERT INTO post_media (post_id, url, storage_key) VALUES (?, ?, ?)');
  let photoIndex = 0;
  for (const file of req.files || []) {
    if (!file.mimetype.startsWith('image/')) continue;
    const saved = await saveFile(file.buffer, file.originalname, file.mimetype);
    const mediaId = insertMedia.run(id, saved.url, saved.key).lastInsertRowid;
    const tags = Array.isArray(photoTags[photoIndex]) ? photoTags[photoIndex] : [];
    for (const pid of tags) {
      if (db.prepare('SELECT id FROM pets WHERE id = ?').get(pid)) tagMedia.run(mediaId, pid);
    }
    photoIndex++;
  }

  res.json(loadPost(id));
});

router.delete('/api/posts/:id', async (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'not found' });
  const media = db.prepare('SELECT storage_key FROM post_media WHERE post_id = ?').all(post.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  for (const m of media) await deleteFile(m.storage_key);
  res.json({ ok: true });
});

module.exports = router;
