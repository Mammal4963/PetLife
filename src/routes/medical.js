const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { saveFile, deleteFile } = require('../storage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function petExists(id) {
  return Boolean(db.prepare('SELECT id FROM pets WHERE id = ?').get(id));
}

// Simple CRUD tables that share the same shape: (table, columns, required column)
const simpleTables = {
  visits: { table: 'vet_visits', cols: ['visit_date', 'reason', 'vet_name', 'notes'], required: 'visit_date' },
  vaccinations: { table: 'vaccinations', cols: ['name', 'date_given', 'due_date', 'notes'], required: 'name' },
  medications: { table: 'medications', cols: ['name', 'dose', 'frequency', 'start_date', 'end_date', 'notes'], required: 'name' },
  weights: { table: 'weights', cols: ['weigh_date', 'weight', 'unit'], required: 'weigh_date' },
};

for (const [route, cfg] of Object.entries(simpleTables)) {
  router.post(`/api/pets/:petId/${route}`, express.json(), (req, res) => {
    if (!petExists(req.params.petId)) return res.status(404).json({ error: 'pet not found' });
    const row = {};
    for (const c of cfg.cols) row[c] = req.body[c] != null && req.body[c] !== '' ? req.body[c] : null;
    if (!row[cfg.required]) return res.status(400).json({ error: `${cfg.required.replace('_', ' ')} is required` });
    if (route === 'weights') {
      row.weight = Number(row.weight);
      if (!Number.isFinite(row.weight) || row.weight <= 0) return res.status(400).json({ error: 'weight must be a positive number' });
      row.unit = row.unit || 'lb';
    }
    const cols = cfg.cols.join(', ');
    const params = cfg.cols.map((c) => `@${c}`).join(', ');
    const info = db.prepare(`INSERT INTO ${cfg.table} (pet_id, ${cols}) VALUES (@pet_id, ${params})`)
      .run({ pet_id: req.params.petId, ...row });
    res.json(db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(info.lastInsertRowid));
  });

  router.delete(`/api/${route}/:id`, (req, res) => {
    const info = db.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).run(req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });
}

// Documents carry a file upload, so they get their own handlers.
router.post('/api/pets/:petId/documents', upload.single('file'), async (req, res) => {
  if (!petExists(req.params.petId)) return res.status(404).json({ error: 'pet not found' });
  if (!req.file) return res.status(400).json({ error: 'A file is required' });
  const title = (req.body.title || '').trim() || req.file.originalname;
  const saved = await saveFile(req.file.buffer, req.file.originalname, req.file.mimetype);
  const info = db.prepare('INSERT INTO documents (pet_id, title, doc_date, url, storage_key, original_name) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.petId, title, req.body.doc_date || null, saved.url, saved.key, req.file.originalname);
  res.json(db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/api/documents/:id', async (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  await deleteFile(doc.storage_key);
  res.json({ ok: true });
});

// Important dates (birthdays and gotcha days come from the pet profile automatically).
router.get('/api/important-dates', (req, res) => {
  res.json(db.prepare(`
    SELECT d.*, p.name AS pet_name FROM important_dates d
    LEFT JOIN pets p ON p.id = d.pet_id ORDER BY d.event_date
  `).all());
});

router.post('/api/important-dates', express.json(), (req, res) => {
  const { title, event_date, pet_id, recurring, notes } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: 'Title and date are required' });
  if (pet_id && !petExists(pet_id)) return res.status(404).json({ error: 'pet not found' });
  const info = db.prepare('INSERT INTO important_dates (pet_id, title, event_date, recurring, notes) VALUES (?, ?, ?, ?, ?)')
    .run(pet_id || null, title, event_date, recurring ? 1 : 0, notes || null);
  res.json(db.prepare('SELECT * FROM important_dates WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/api/important-dates/:id', (req, res) => {
  const info = db.prepare('DELETE FROM important_dates WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
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

router.get('/api/reminders', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = 90;
  const items = [];

  const vax = db.prepare(`
    SELECT v.*, p.name AS pet_name, p.passed_date FROM vaccinations v
    JOIN pets p ON p.id = v.pet_id WHERE v.due_date IS NOT NULL AND p.passed_date IS NULL
  `).all();
  for (const v of vax) {
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

  const pets = db.prepare('SELECT * FROM pets WHERE passed_date IS NULL').all();
  for (const p of pets) {
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

  const dates = db.prepare(`
    SELECT d.*, p.name AS pet_name FROM important_dates d LEFT JOIN pets p ON p.id = d.pet_id
  `).all();
  for (const d of dates) {
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
  res.json(items);
});

module.exports = router;
