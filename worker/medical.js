import { Hono } from 'hono';
import { saveFile, deleteFiles } from './storage.js';

const app = new Hono();

async function petExists(env, id) {
  return Boolean(await env.DB.prepare('SELECT id FROM pets WHERE id = ?').bind(id).first());
}

// Simple CRUD tables that share the same shape: (table, columns, required column)
const simpleTables = {
  visits: { table: 'vet_visits', cols: ['visit_date', 'reason', 'vet_name', 'notes'], required: 'visit_date' },
  vaccinations: { table: 'vaccinations', cols: ['name', 'date_given', 'due_date', 'notes'], required: 'name' },
  medications: { table: 'medications', cols: ['name', 'dose', 'frequency', 'start_date', 'end_date', 'notes'], required: 'name' },
  weights: { table: 'weights', cols: ['weigh_date', 'weight', 'unit'], required: 'weigh_date' },
};

for (const [route, cfg] of Object.entries(simpleTables)) {
  app.post(`/api/pets/:petId/${route}`, async (c) => {
    const petId = c.req.param('petId');
    if (!(await petExists(c.env, petId))) return c.json({ error: 'pet not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const row = {};
    for (const col of cfg.cols) row[col] = body[col] != null && body[col] !== '' ? body[col] : null;
    if (!row[cfg.required]) return c.json({ error: `${cfg.required.replace('_', ' ')} is required` }, 400);
    if (route === 'weights') {
      row.weight = Number(row.weight);
      if (!Number.isFinite(row.weight) || row.weight <= 0) return c.json({ error: 'weight must be a positive number' }, 400);
      row.unit = row.unit || 'lb';
    }
    const cols = cfg.cols.join(', ');
    const marks = cfg.cols.map(() => '?').join(', ');
    const { meta } = await c.env.DB
      .prepare(`INSERT INTO ${cfg.table} (pet_id, ${cols}) VALUES (?, ${marks})`)
      .bind(petId, ...cfg.cols.map((col) => row[col])).run();
    return c.json(await c.env.DB.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).bind(meta.last_row_id).first());
  });

  app.delete(`/api/${route}/:id`, async (c) => {
    const { meta } = await c.env.DB.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).bind(c.req.param('id')).run();
    if (!meta.changes) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });
}

// Documents carry a file upload, so they get their own handlers.
app.post('/api/pets/:petId/documents', async (c) => {
  const petId = c.req.param('petId');
  if (!(await petExists(c.env, petId))) return c.json({ error: 'pet not found' }, 404);
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof file !== 'object' || !file.size) return c.json({ error: 'A file is required' }, 400);
  const title = String(form.get('title') || '').trim() || file.name;
  const saved = await saveFile(c.env, file);
  const { meta } = await c.env.DB
    .prepare('INSERT INTO documents (pet_id, title, doc_date, url, storage_key, original_name) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(petId, title, form.get('doc_date') || null, saved.url, saved.key, file.name).run();
  return c.json(await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(meta.last_row_id).first());
});

app.delete('/api/documents/:id', async (c) => {
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(c.req.param('id')).first();
  if (!doc) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(doc.id).run();
  await deleteFiles(c.env, [doc.storage_key]);
  return c.json({ ok: true });
});

// Important dates (birthdays and gotcha days come from the pet profile automatically).
app.get('/api/important-dates', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT d.*, p.name AS pet_name FROM important_dates d
    LEFT JOIN pets p ON p.id = d.pet_id ORDER BY d.event_date`).all();
  return c.json(results);
});

app.post('/api/important-dates', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { title, event_date, pet_id, recurring, notes } = body;
  if (!title || !event_date) return c.json({ error: 'Title and date are required' }, 400);
  if (pet_id && !(await petExists(c.env, pet_id))) return c.json({ error: 'pet not found' }, 404);
  const { meta } = await c.env.DB
    .prepare('INSERT INTO important_dates (pet_id, title, event_date, recurring, notes) VALUES (?, ?, ?, ?, ?)')
    .bind(pet_id || null, title, event_date, recurring ? 1 : 0, notes || null).run();
  return c.json(await c.env.DB.prepare('SELECT * FROM important_dates WHERE id = ?').bind(meta.last_row_id).first());
});

app.delete('/api/important-dates/:id', async (c) => {
  const { meta } = await c.env.DB.prepare('DELETE FROM important_dates WHERE id = ?').bind(c.req.param('id')).run();
  if (!meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

// --- Reminders -------------------------------------------------------------

function nextOccurrence(dateStr, today) {
  const [, mm, dd] = dateStr.split('-');
  let candidate = `${today.slice(0, 4)}-${mm}-${dd}`;
  if (candidate < today) candidate = `${Number(today.slice(0, 4)) + 1}-${mm}-${dd}`;
  return candidate;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

app.get('/api/reminders', async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = 90;
  const items = [];

  const [vax, pets, dates] = await c.env.DB.batch([
    c.env.DB.prepare(`
      SELECT v.*, p.name AS pet_name FROM vaccinations v
      JOIN pets p ON p.id = v.pet_id WHERE v.due_date IS NOT NULL AND p.passed_date IS NULL`),
    c.env.DB.prepare('SELECT * FROM pets WHERE passed_date IS NULL'),
    c.env.DB.prepare('SELECT d.*, p.name AS pet_name FROM important_dates d LEFT JOIN pets p ON p.id = d.pet_id'),
  ]);

  for (const v of vax.results) {
    const days = daysBetween(today, v.due_date);
    if (days <= horizon) {
      items.push({
        type: 'vaccination',
        title: `${v.pet_name}: ${v.name} ${days < 0 ? 'overdue' : 'due'}`,
        date: v.due_date,
        days,
        pet_id: v.pet_id,
      });
    }
  }

  for (const p of pets.results) {
    if (p.birthdate) {
      const next = nextOccurrence(p.birthdate, today);
      const days = daysBetween(today, next);
      if (days <= horizon) {
        const age = Number(next.slice(0, 4)) - Number(p.birthdate.slice(0, 4));
        items.push({ type: 'birthday', title: `${p.name} turns ${age}! 🎂`, date: next, days, pet_id: p.id });
      }
    }
    if (p.adopted_date) {
      const next = nextOccurrence(p.adopted_date, today);
      const days = daysBetween(today, next);
      if (days <= horizon) {
        items.push({ type: 'gotcha', title: `${p.name}'s Gotcha Day 🏡`, date: next, days, pet_id: p.id });
      }
    }
  }

  for (const d of dates.results) {
    const when = d.recurring ? nextOccurrence(d.event_date, today) : d.event_date;
    const days = daysBetween(today, when);
    if (days >= 0 && days <= horizon) {
      items.push({
        type: 'event',
        title: d.pet_name ? `${d.pet_name}: ${d.title}` : d.title,
        date: when,
        days,
        pet_id: d.pet_id,
      });
    }
  }

  items.sort((a, b) => a.days - b.days);
  return c.json(items);
});

export default app;
