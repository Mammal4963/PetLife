import { Hono } from 'hono';
import { saveFile, deleteFiles } from './storage.js';

const app = new Hono();

const petFields = ['name', 'species', 'breed', 'sex', 'birthdate', 'adopted_date', 'passed_date', 'notes'];

function cleanPet(form) {
  const out = {};
  for (const f of petFields) {
    const v = form.get(f);
    out[f] = v && String(v).trim() ? String(v).trim() : null;
  }
  out.species = out.species || 'cat';
  return out;
}

app.get('/api/pets', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT * FROM pets ORDER BY passed_date IS NOT NULL, name').all();
  return c.json(results);
});

app.get('/api/pets/:id', async (c) => {
  const id = c.req.param('id');
  const pet = await c.env.DB.prepare('SELECT * FROM pets WHERE id = ?').bind(id).first();
  if (!pet) return c.json({ error: 'not found' }, 404);
  const [visits, vaccinations, medications, weights, documents] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM vet_visits WHERE pet_id = ? ORDER BY visit_date DESC').bind(id),
    c.env.DB.prepare('SELECT * FROM vaccinations WHERE pet_id = ? ORDER BY COALESCE(due_date, date_given) DESC').bind(id),
    c.env.DB.prepare('SELECT * FROM medications WHERE pet_id = ? ORDER BY start_date DESC').bind(id),
    c.env.DB.prepare('SELECT * FROM weights WHERE pet_id = ? ORDER BY weigh_date DESC').bind(id),
    c.env.DB.prepare('SELECT * FROM documents WHERE pet_id = ? ORDER BY COALESCE(doc_date, id) DESC').bind(id),
  ]);
  pet.visits = visits.results;
  pet.vaccinations = vaccinations.results;
  pet.medications = medications.results;
  pet.weights = weights.results;
  pet.documents = documents.results;
  return c.json(pet);
});

app.post('/api/pets', async (c) => {
  const form = await c.req.formData();
  const pet = cleanPet(form);
  if (!pet.name) return c.json({ error: 'Name is required' }, 400);
  let photo_url = null;
  let photo_key = null;
  const photo = form.get('photo');
  if (photo && typeof photo === 'object' && photo.size) {
    ({ url: photo_url, key: photo_key } = await saveFile(c.env, photo));
  }
  const { meta } = await c.env.DB.prepare(`
    INSERT INTO pets (name, species, breed, sex, birthdate, adopted_date, passed_date, notes, photo_url, photo_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(pet.name, pet.species, pet.breed, pet.sex, pet.birthdate, pet.adopted_date, pet.passed_date, pet.notes, photo_url, photo_key)
    .run();
  return c.json(await c.env.DB.prepare('SELECT * FROM pets WHERE id = ?').bind(meta.last_row_id).first());
});

app.put('/api/pets/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM pets WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'not found' }, 404);
  const form = await c.req.formData();
  const pet = cleanPet(form);
  if (!pet.name) return c.json({ error: 'Name is required' }, 400);
  let { photo_url, photo_key } = existing;
  const photo = form.get('photo');
  if (photo && typeof photo === 'object' && photo.size) {
    await deleteFiles(c.env, [existing.photo_key]);
    ({ url: photo_url, key: photo_key } = await saveFile(c.env, photo));
  }
  await c.env.DB.prepare(`
    UPDATE pets SET name=?, species=?, breed=?, sex=?, birthdate=?, adopted_date=?, passed_date=?, notes=?, photo_url=?, photo_key=?
    WHERE id=?`)
    .bind(pet.name, pet.species, pet.breed, pet.sex, pet.birthdate, pet.adopted_date, pet.passed_date, pet.notes, photo_url, photo_key, id)
    .run();
  return c.json(await c.env.DB.prepare('SELECT * FROM pets WHERE id = ?').bind(id).first());
});

app.delete('/api/pets/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM pets WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'not found' }, 404);
  const docs = await c.env.DB.prepare('SELECT storage_key FROM documents WHERE pet_id = ?').bind(id).all();
  // Explicit child deletes rather than relying on FK cascade behavior in D1.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM vet_visits WHERE pet_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM vaccinations WHERE pet_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM medications WHERE pet_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM weights WHERE pet_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM documents WHERE pet_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM important_dates WHERE pet_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM post_pets WHERE pet_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM share_links WHERE pet_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM pets WHERE id = ?').bind(id),
  ]);
  await deleteFiles(c.env, [existing.photo_key, ...docs.results.map((d) => d.storage_key)]);
  return c.json({ ok: true });
});

export default app;
