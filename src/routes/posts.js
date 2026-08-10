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

function loadPost(id) {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!post) return null;
  post.media = db.prepare('SELECT id, url FROM post_media WHERE post_id = ? ORDER BY id').all(id);
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

  const info = db.prepare('INSERT INTO posts (title, body, post_date, youtube_url) VALUES (?, ?, ?, ?)')
    .run(title || null, body || null, post_date, youtube_url || null);
  const postId = info.lastInsertRowid;

  let petIds = req.body.pet_ids || [];
  if (!Array.isArray(petIds)) petIds = [petIds];
  const linkPet = db.prepare('INSERT OR IGNORE INTO post_pets (post_id, pet_id) VALUES (?, ?)');
  for (const pid of petIds) {
    if (db.prepare('SELECT id FROM pets WHERE id = ?').get(pid)) linkPet.run(postId, pid);
  }

  const insertMedia = db.prepare('INSERT INTO post_media (post_id, url, storage_key) VALUES (?, ?, ?)');
  for (const file of req.files || []) {
    if (!file.mimetype.startsWith('image/')) continue;
    const saved = await saveFile(file.buffer, file.originalname, file.mimetype);
    insertMedia.run(postId, saved.url, saved.key);
  }

  res.json(loadPost(postId));
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
