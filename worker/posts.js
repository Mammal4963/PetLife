import { Hono } from 'hono';
import { saveFile, deleteFiles } from './storage.js';

const app = new Hono();

// Accepts full YouTube URLs, youtu.be links, or Shorts links; returns the video id or null.
export function youtubeId(url) {
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

async function listPosts(env, petId, onlyPostId) {
  let idFilter = null;
  if (petId) {
    const { results } = await env.DB
      .prepare('SELECT DISTINCT post_id FROM post_pets WHERE pet_id = ?').bind(petId).all();
    idFilter = new Set(results.map((r) => r.post_id));
  }
  const [posts, media, links, mediaTags] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM posts ORDER BY post_date DESC, id DESC'),
    env.DB.prepare('SELECT id, post_id, url FROM post_media ORDER BY id'),
    env.DB.prepare('SELECT pp.post_id AS post_id, p.id AS id, p.name AS name FROM post_pets pp JOIN pets p ON p.id = pp.pet_id ORDER BY p.name'),
    env.DB.prepare('SELECT mp.media_id AS media_id, p.id AS id, p.name AS name FROM media_pets mp JOIN pets p ON p.id = mp.pet_id ORDER BY p.name'),
  ]);
  const byId = new Map();
  for (const p of posts.results) {
    p.media = [];
    p.pets = [];
    p.youtube_id = youtubeId(p.youtube_url);
    byId.set(p.id, p);
  }
  const mediaById = new Map();
  for (const m of media.results) {
    const entry = { id: m.id, url: m.url, pets: [] };
    mediaById.set(m.id, entry);
    byId.get(m.post_id)?.media.push(entry);
  }
  for (const t of mediaTags.results) mediaById.get(t.media_id)?.pets.push({ id: t.id, name: t.name });
  for (const l of links.results) byId.get(l.post_id)?.pets.push({ id: l.id, name: l.name });
  let out = posts.results;
  if (idFilter) out = out.filter((p) => idFilter.has(p.id));
  if (onlyPostId) out = out.filter((p) => p.id === onlyPostId);
  return out;
}

app.get('/api/posts', async (c) => {
  return c.json(await listPosts(c.env, c.req.query('pet_id') || null));
});

app.post('/api/posts', async (c) => {
  const form = await c.req.formData();
  const title = form.get('title') || null;
  const body = form.get('body') || null;
  const post_date = form.get('post_date');
  const youtube_url = form.get('youtube_url') || null;
  const photos = form.getAll('photos').filter((f) => typeof f === 'object' && f.size && f.type.startsWith('image/'));

  if (!post_date) return c.json({ error: 'Date is required' }, 400);
  if (youtube_url && !youtubeId(youtube_url)) {
    return c.json({ error: "That doesn't look like a YouTube link" }, 400);
  }
  const hasContent = (title && title.trim()) || (body && body.trim()) || youtube_url || photos.length;
  if (!hasContent) return c.json({ error: 'Add a photo, video link, or some text' }, 400);

  const range = dateRange(post_date, form.get('post_date_end'));
  const { meta } = await c.env.DB
    .prepare('INSERT INTO posts (title, body, post_date, post_date_end, youtube_url) VALUES (?, ?, ?, ?, ?)')
    .bind(title, body, range.start, range.end, youtube_url).run();
  const postId = meta.last_row_id;

  const validPets = new Set(
    (await c.env.DB.prepare('SELECT id FROM pets').all()).results.map((p) => String(p.id)),
  );
  const linkStmts = form.getAll('pet_ids')
    .filter((pid) => validPets.has(String(pid)))
    .map((pid) => c.env.DB.prepare('INSERT OR IGNORE INTO post_pets (post_id, pet_id) VALUES (?, ?)').bind(postId, pid));
  if (linkStmts.length) await c.env.DB.batch(linkStmts);

  // Optional per-photo pet tags: a JSON array of pet-id arrays, aligned with
  // the photos in upload order, e.g. [[1,2],[1]] for two photos.
  let photoTags = [];
  try {
    const parsed = JSON.parse(form.get('photo_pets') || '[]');
    if (Array.isArray(parsed)) photoTags = parsed;
  } catch { /* ignore malformed tags — photos still save untagged */ }

  for (let i = 0; i < photos.length; i++) {
    const saved = await saveFile(c.env, photos[i]);
    const { meta: mediaMeta } = await c.env.DB
      .prepare('INSERT INTO post_media (post_id, url, storage_key) VALUES (?, ?, ?)')
      .bind(postId, saved.url, saved.key).run();
    const tags = (Array.isArray(photoTags[i]) ? photoTags[i] : []).filter((pid) => validPets.has(String(pid)));
    for (const pid of tags) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO media_pets (media_id, pet_id) VALUES (?, ?)')
        .bind(mediaMeta.last_row_id, pid).run();
    }
  }

  const [post] = await listPosts(c.env, null, postId);
  return c.json(post);
});

app.put('/api/posts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!(await c.env.DB.prepare('SELECT id FROM posts WHERE id = ?').bind(id).first())) {
    return c.json({ error: 'not found' }, 404);
  }
  const form = await c.req.formData();
  const title = form.get('title') || null;
  const body = form.get('body') || null;
  const post_date = form.get('post_date');
  const youtube_url = form.get('youtube_url') || null;
  if (!post_date) return c.json({ error: 'Date is required' }, 400);
  if (youtube_url && !youtubeId(youtube_url)) {
    return c.json({ error: "That doesn't look like a YouTube link" }, 400);
  }
  const range = dateRange(post_date, form.get('post_date_end'));
  await c.env.DB
    .prepare('UPDATE posts SET title = ?, body = ?, post_date = ?, post_date_end = ?, youtube_url = ? WHERE id = ?')
    .bind(title, body, range.start, range.end, youtube_url, id).run();

  const validPets = new Set(
    (await c.env.DB.prepare('SELECT id FROM pets').all()).results.map((p) => String(p.id)),
  );

  // Post-level pets: replace with the submitted set.
  await c.env.DB.prepare('DELETE FROM post_pets WHERE post_id = ?').bind(id).run();
  const linkStmts = form.getAll('pet_ids')
    .filter((pid) => validPets.has(String(pid)))
    .map((pid) => c.env.DB.prepare('INSERT OR IGNORE INTO post_pets (post_id, pet_id) VALUES (?, ?)').bind(id, pid));
  if (linkStmts.length) await c.env.DB.batch(linkStmts);

  // Removed photos: delete rows and the stored files.
  let removeIds = [];
  try {
    const parsed = JSON.parse(form.get('remove_media') || '[]');
    if (Array.isArray(parsed)) removeIds = parsed.map(Number).filter(Number.isFinite);
  } catch { /* ignore */ }
  if (removeIds.length) {
    const marks = removeIds.map(() => '?').join(',');
    const doomed = await c.env.DB
      .prepare(`SELECT id, storage_key FROM post_media WHERE post_id = ? AND id IN (${marks})`)
      .bind(id, ...removeIds).all();
    if (doomed.results.length) {
      const ids = doomed.results.map((m) => m.id);
      const idMarks = ids.map(() => '?').join(',');
      await c.env.DB.batch([
        c.env.DB.prepare(`DELETE FROM media_pets WHERE media_id IN (${idMarks})`).bind(...ids),
        c.env.DB.prepare(`DELETE FROM post_media WHERE id IN (${idMarks})`).bind(...ids),
      ]);
      await deleteFiles(c.env, doomed.results.map((m) => m.storage_key));
    }
  }

  // Re-tag remaining photos: {media_id: [pet_ids]} replaces each photo's tags.
  let mediaTags = {};
  try {
    const parsed = JSON.parse(form.get('media_pets') || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) mediaTags = parsed;
  } catch { /* ignore */ }
  const owned = await c.env.DB.prepare('SELECT id FROM post_media WHERE post_id = ?').bind(id).all();
  const ownedIds = new Set(owned.results.map((m) => m.id));
  for (const [mid, pids] of Object.entries(mediaTags)) {
    const mediaId = Number(mid);
    if (!ownedIds.has(mediaId) || !Array.isArray(pids)) continue;
    await c.env.DB.prepare('DELETE FROM media_pets WHERE media_id = ?').bind(mediaId).run();
    for (const pid of pids.filter((p) => validPets.has(String(p)))) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO media_pets (media_id, pet_id) VALUES (?, ?)')
        .bind(mediaId, pid).run();
    }
  }

  // New photos, tagged the same way as on create.
  const photos = form.getAll('photos').filter((f) => typeof f === 'object' && f.size && f.type.startsWith('image/'));
  let photoTags = [];
  try {
    const parsed = JSON.parse(form.get('photo_pets') || '[]');
    if (Array.isArray(parsed)) photoTags = parsed;
  } catch { /* ignore */ }
  for (let i = 0; i < photos.length; i++) {
    const saved = await saveFile(c.env, photos[i]);
    const { meta: mediaMeta } = await c.env.DB
      .prepare('INSERT INTO post_media (post_id, url, storage_key) VALUES (?, ?, ?)')
      .bind(id, saved.url, saved.key).run();
    const tags = (Array.isArray(photoTags[i]) ? photoTags[i] : []).filter((pid) => validPets.has(String(pid)));
    for (const pid of tags) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO media_pets (media_id, pet_id) VALUES (?, ?)')
        .bind(mediaMeta.last_row_id, pid).run();
    }
  }

  const [post] = await listPosts(c.env, null, id);
  return c.json(post);
});

app.delete('/api/posts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const post = await c.env.DB.prepare('SELECT id FROM posts WHERE id = ?').bind(id).first();
  if (!post) return c.json({ error: 'not found' }, 404);
  const media = await c.env.DB.prepare('SELECT storage_key FROM post_media WHERE post_id = ?').bind(id).all();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM media_pets WHERE media_id IN (SELECT id FROM post_media WHERE post_id = ?)').bind(id),
    c.env.DB.prepare('DELETE FROM post_media WHERE post_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM post_pets WHERE post_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id),
  ]);
  await deleteFiles(c.env, media.results.map((m) => m.storage_key));
  return c.json({ ok: true });
});

export default app;
