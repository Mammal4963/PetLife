import { Hono } from 'hono';

// Vet share links: a long random token in the URL grants read-only access to
// one pet's medical records. The token is the credential — no password needed —
// so these routes are split into a public app (mounted before the auth gate)
// and an admin app for creating/revoking links (mounted behind it).

const NOT_EXPIRED = "(expires_at IS NULL OR expires_at > datetime('now'))";

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const shareAdmin = new Hono();

shareAdmin.get('/api/pets/:petId/shares', async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM share_links WHERE pet_id = ? AND ${NOT_EXPIRED} ORDER BY id DESC`)
    .bind(c.req.param('petId')).all();
  return c.json(results);
});

shareAdmin.post('/api/pets/:petId/shares', async (c) => {
  const petId = c.req.param('petId');
  if (!(await c.env.DB.prepare('SELECT id FROM pets WHERE id = ?').bind(petId).first())) {
    return c.json({ error: 'pet not found' }, 404);
  }
  const body = await c.req.json().catch(() => ({}));
  const days = Number(body.days);
  const token = newToken();
  const { meta } = [7, 30, 90].includes(days)
    ? await c.env.DB.prepare("INSERT INTO share_links (pet_id, token, expires_at) VALUES (?, ?, datetime('now', ?))")
      .bind(petId, token, `+${days} days`).run()
    : await c.env.DB.prepare('INSERT INTO share_links (pet_id, token) VALUES (?, ?)')
      .bind(petId, token).run();
  return c.json(await c.env.DB.prepare('SELECT * FROM share_links WHERE id = ?').bind(meta.last_row_id).first());
});

shareAdmin.delete('/api/shares/:id', async (c) => {
  const { meta } = await c.env.DB.prepare('DELETE FROM share_links WHERE id = ?').bind(c.req.param('id')).run();
  if (!meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

export const sharePublic = new Hono();

async function findShare(env, token) {
  if (!/^[0-9a-f]{32}$/.test(token || '')) return null;
  return env.DB.prepare(`SELECT * FROM share_links WHERE token = ? AND ${NOT_EXPIRED}`).bind(token).first();
}

sharePublic.get('/api/share/:token', async (c) => {
  const share = await findShare(c.env, c.req.param('token'));
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
  const share = await findShare(c.env, c.req.param('token'));
  if (!share) return c.json({ error: 'This link is invalid or has expired' }, 404);
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ? AND pet_id = ?')
    .bind(c.req.param('docId'), share.pet_id).first();
  if (!doc || !doc.storage_key) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.MEDIA.get(doc.storage_key);
  if (!obj) return c.json({ error: 'not found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'private, no-store');
  return new Response(obj.body, { headers });
});
