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

async function listPosts(env, petId, onlyPostId) {
  let idFilter = null;
  if (petId) {
    const { results } = await env.DB
      .prepare('SELECT DISTINCT post_id FROM post_pets WHERE pet_id = ?').bind(petId).all();
    idFilter = new Set(results.map((r) => r.post_id));
  }
  const [posts, media, links] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM posts ORDER BY post_date DESC, id DESC'),
    env.DB.prepare('SELECT id, post_id, url FROM post_media ORDER BY id'),
    env.DB.prepare('SELECT pp.post_id AS post_id, p.id AS id, p.name AS name FROM post_pets pp JOIN pets p ON p.id = pp.pet_id ORDER BY p.name'),
  ]);
  const byId = new Map();
  for (const p of posts.results) {
    p.media = [];
    p.pets = [];
    p.youtube_id = youtubeId(p.youtube_url);
    byId.set(p.id, p);
  }
  for (const m of media.results) byId.get(m.post_id)?.media.push({ id: m.id, url: m.url });
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

  const { meta } = await c.env.DB
    .prepare('INSERT INTO posts (title, body, post_date, youtube_url) VALUES (?, ?, ?, ?)')
    .bind(title, body, post_date, youtube_url).run();
  const postId = meta.last_row_id;

  const validPets = new Set(
    (await c.env.DB.prepare('SELECT id FROM pets').all()).results.map((p) => String(p.id)),
  );
  const linkStmts = form.getAll('pet_ids')
    .filter((pid) => validPets.has(String(pid)))
    .map((pid) => c.env.DB.prepare('INSERT OR IGNORE INTO post_pets (post_id, pet_id) VALUES (?, ?)').bind(postId, pid));
  if (linkStmts.length) await c.env.DB.batch(linkStmts);

  for (const file of photos) {
    const saved = await saveFile(c.env, file);
    await c.env.DB.prepare('INSERT INTO post_media (post_id, url, storage_key) VALUES (?, ?, ?)')
      .bind(postId, saved.url, saved.key).run();
  }

  const [post] = await listPosts(c.env, null, postId);
  return c.json(post);
});

app.delete('/api/posts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const post = await c.env.DB.prepare('SELECT id FROM posts WHERE id = ?').bind(id).first();
  if (!post) return c.json({ error: 'not found' }, 404);
  const media = await c.env.DB.prepare('SELECT storage_key FROM post_media WHERE post_id = ?').bind(id).all();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM post_media WHERE post_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM post_pets WHERE post_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id),
  ]);
  await deleteFiles(c.env, media.results.map((m) => m.storage_key));
  return c.json({ ok: true });
});

export default app;
