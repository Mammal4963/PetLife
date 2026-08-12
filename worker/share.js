import { Hono } from 'hono';
import { youtubeId } from './posts.js';

// Share links: a long random token in the URL grants read-only access with no
// password. Two scopes — 'medical' (one pet's records, for the vet) and
// 'timeline' (the whole photo timeline, for family and friends). The token is
// the credential, so these routes are split into a public app (mounted before
// the auth gate) and an admin app for creating/revoking links (mounted behind it).

const NOT_EXPIRED = "(expires_at IS NULL OR expires_at > datetime('now'))";

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function insertShare(env, { petId = null, scope, days }) {
  const token = newToken();
  const { meta } = [7, 30, 90].includes(days)
    ? await env.DB.prepare("INSERT INTO share_links (pet_id, scope, token, expires_at) VALUES (?, ?, ?, datetime('now', ?))")
      .bind(petId, scope, token, `+${days} days`).run()
    : await env.DB.prepare('INSERT INTO share_links (pet_id, scope, token) VALUES (?, ?, ?)')
      .bind(petId, scope, token).run();
  return env.DB.prepare('SELECT * FROM share_links WHERE id = ?').bind(meta.last_row_id).first();
}

export const shareAdmin = new Hono();

shareAdmin.get('/api/pets/:petId/shares', async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM share_links WHERE pet_id = ? AND scope = 'medical' AND ${NOT_EXPIRED} ORDER BY id DESC`)
    .bind(c.req.param('petId')).all();
  return c.json(results);
});

shareAdmin.post('/api/pets/:petId/shares', async (c) => {
  const petId = c.req.param('petId');
  if (!(await c.env.DB.prepare('SELECT id FROM pets WHERE id = ?').bind(petId).first())) {
    return c.json({ error: 'pet not found' }, 404);
  }
  const body = await c.req.json().catch(() => ({}));
  return c.json(await insertShare(c.env, { petId, scope: 'medical', days: Number(body.days) }));
});

shareAdmin.get('/api/timeline-shares', async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM share_links WHERE scope = 'timeline' AND ${NOT_EXPIRED} ORDER BY id DESC`).all();
  return c.json(results);
});

shareAdmin.post('/api/timeline-shares', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await insertShare(c.env, { scope: 'timeline', days: Number(body.days) }));
});

shareAdmin.delete('/api/shares/:id', async (c) => {
  const { meta } = await c.env.DB.prepare('DELETE FROM share_links WHERE id = ?').bind(c.req.param('id')).run();
  if (!meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

export const sharePublic = new Hono();

async function findShare(env, token, scope) {
  if (!/^[0-9a-f]{32}$/.test(token || '')) return null;
  return env.DB.prepare(`SELECT * FROM share_links WHERE token = ? AND scope = ? AND ${NOT_EXPIRED}`)
    .bind(token, scope).first();
}

function streamR2(obj, cacheControl) {
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', cacheControl);
  return new Response(obj.body, { headers });
}

// ---- medical scope ---------------------------------------------------------

sharePublic.get('/api/share/:token', async (c) => {
  const share = await findShare(c.env, c.req.param('token'), 'medical');
  if (!share) return c.json({ error: 'This link is invalid or has expired' }, 404);
  const id = share.pet_id;
  // Medical records only — no photos, posts, or notes meant for the family.
  const pet = await c.env.DB
    .prepare('SELECT id, name, species, breed, sex, birthdate, adopted_date, passed_date FROM pets WHERE id = ?')
    .bind(id).first();
  if (!pet) return c.json({ error: 'This link is invalid or has expired' }, 404);
  const [visits, vaccinations, medications, weights, documents] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM vet_visits WHERE pet_id = ? ORDER BY visit_date DESC').bind(id),
    c.env.DB.prepare('SELECT * FROM vaccinations WHERE pet_id = ? ORDER BY COALESCE(due_date, date_given) DESC').bind(id),
    c.env.DB.prepare('SELECT * FROM medications WHERE pet_id = ? ORDER BY start_date DESC').bind(id),
    c.env.DB.prepare('SELECT * FROM weights WHERE pet_id = ? ORDER BY weigh_date DESC').bind(id),
    c.env.DB.prepare('SELECT id, title, doc_date FROM documents WHERE pet_id = ? ORDER BY COALESCE(doc_date, id) DESC').bind(id),
  ]);
  pet.visits = visits.results;
  pet.vaccinations = vaccinations.results;
  pet.medications = medications.results;
  pet.weights = weights.results;
  pet.documents = documents.results;
  return c.json(pet);
});

sharePublic.get('/api/share/:token/documents/:docId', async (c) => {
  const share = await findShare(c.env, c.req.param('token'), 'medical');
  if (!share) return c.json({ error: 'This link is invalid or has expired' }, 404);
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ? AND pet_id = ?')
    .bind(c.req.param('docId'), share.pet_id).first();
  if (!doc || !doc.storage_key) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.MEDIA.get(doc.storage_key);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return streamR2(obj, 'private, no-store');
});

// ---- timeline scope --------------------------------------------------------

sharePublic.get('/api/timeline-share/:token', async (c) => {
  const share = await findShare(c.env, c.req.param('token'), 'timeline');
  if (!share) return c.json({ error: 'This link is invalid or has expired' }, 404);
  const mediaUrl = (key) => `/api/timeline-share/${share.token}/media/${key}`;

  const [pets, posts, media, links, mediaTags] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, name, species, breed, birthdate, adopted_date, passed_date, photo_key FROM pets ORDER BY passed_date IS NOT NULL, name'),
    c.env.DB.prepare('SELECT id, title, body, post_date, youtube_url FROM posts ORDER BY post_date DESC, id DESC'),
    c.env.DB.prepare('SELECT id, post_id, storage_key, url FROM post_media ORDER BY id'),
    c.env.DB.prepare('SELECT pp.post_id AS post_id, p.id AS id, p.name AS name FROM post_pets pp JOIN pets p ON p.id = pp.pet_id ORDER BY p.name'),
    c.env.DB.prepare('SELECT mp.media_id AS media_id, p.id AS id, p.name AS name FROM media_pets mp JOIN pets p ON p.id = mp.pet_id ORDER BY p.name'),
  ]);

  const petsOut = pets.results.map((p) => ({
    id: p.id,
    name: p.name,
    species: p.species,
    breed: p.breed,
    birthdate: p.birthdate,
    adopted_date: p.adopted_date,
    passed_date: p.passed_date,
    photo_url: p.photo_key ? mediaUrl(p.photo_key) : null,
  }));

  const byId = new Map();
  const postsOut = posts.results.map((p) => {
    const out = {
      id: p.id,
      title: p.title,
      body: p.body,
      post_date: p.post_date,
      youtube_id: youtubeId(p.youtube_url),
      media: [],
      pets: [],
    };
    byId.set(p.id, out);
    return out;
  });
  const mediaById = new Map();
  for (const m of media.results) {
    const entry = { url: m.storage_key ? mediaUrl(m.storage_key) : m.url, pets: [] };
    mediaById.set(m.id, entry);
    byId.get(m.post_id)?.media.push(entry);
  }
  for (const t of mediaTags.results) mediaById.get(t.media_id)?.pets.push({ id: t.id, name: t.name });
  for (const l of links.results) byId.get(l.post_id)?.pets.push({ id: l.id, name: l.name });

  return c.json({ pets: petsOut, posts: postsOut });
});

sharePublic.get('/api/timeline-share/:token/media/*', async (c) => {
  const share = await findShare(c.env, c.req.param('token'), 'timeline');
  if (!share) return c.json({ error: 'not found' }, 404);
  const key = decodeURIComponent(c.req.path.split('/media/')[1] || '');
  if (!key || key.includes('..')) return c.json({ error: 'not found' }, 404);
  // A timeline token only unlocks media the timeline actually shows —
  // post photos and pet portraits, never medical documents.
  const referenced = await c.env.DB
    .prepare('SELECT 1 AS ok FROM post_media WHERE storage_key = ? UNION SELECT 1 FROM pets WHERE photo_key = ?')
    .bind(key, key).first();
  if (!referenced) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.json({ error: 'not found' }, 404);
  return streamR2(obj, 'private, max-age=86400');
});
