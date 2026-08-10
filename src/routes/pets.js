const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { saveFile, deleteFile } = require('../storage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const petFields = ['name', 'species', 'breed', 'sex', 'birthdate', 'adopted_date', 'passed_date', 'notes'];

function cleanPet(body) {
  const out = {};
  for (const f of petFields) out[f] = body[f] ? String(body[f]).trim() : null;
  return out;
}

router.get('/api/pets', (req, res) => {
  const pets = db.prepare('SELECT * FROM pets ORDER BY passed_date IS NOT NULL, name').all();
  res.json(pets);
});

router.get('/api/pets/:id', (req, res) => {
  const pet = db.prepare('SELECT * FROM pets WHERE id = ?').get(req.params.id);
  if (!pet) return res.status(404).json({ error: 'not found' });
  pet.visits = db.prepare('SELECT * FROM vet_visits WHERE pet_id = ? ORDER BY visit_date DESC').all(pet.id);
  pet.vaccinations = db.prepare('SELECT * FROM vaccinations WHERE pet_id = ? ORDER BY COALESCE(due_date, date_given) DESC').all(pet.id);
  pet.medications = db.prepare('SELECT * FROM medications WHERE pet_id = ? ORDER BY start_date DESC').all(pet.id);
  pet.weights = db.prepare('SELECT * FROM weights WHERE pet_id = ? ORDER BY weigh_date DESC').all(pet.id);
  pet.documents = db.prepare('SELECT * FROM documents WHERE pet_id = ? ORDER BY COALESCE(doc_date, id) DESC').all(pet.id);
  res.json(pet);
});

router.post('/api/pets', upload.single('photo'), async (req, res) => {
  const pet = cleanPet(req.body);
  if (!pet.name) return res.status(400).json({ error: 'Name is required' });
  if (req.file) {
    const saved = await saveFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    pet.photo_url = saved.url;
    pet.photo_key = saved.key;
  } else {
    pet.photo_url = null;
    pet.photo_key = null;
  }
  const info = db.prepare(`INSERT INTO pets (name, species, breed, sex, birthdate, adopted_date, passed_date, notes, photo_url, photo_key)
    VALUES (@name, @species, @breed, @sex, @birthdate, @adopted_date, @passed_date, @notes, @photo_url, @photo_key)`).run({ ...pet, species: pet.species || 'cat' });
  res.json(db.prepare('SELECT * FROM pets WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/api/pets/:id', upload.single('photo'), async (req, res) => {
  const existing = db.prepare('SELECT * FROM pets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const pet = cleanPet(req.body);
  if (!pet.name) return res.status(400).json({ error: 'Name is required' });
  let photo_url = existing.photo_url;
  let photo_key = existing.photo_key;
  if (req.file) {
    await deleteFile(existing.photo_key);
    const saved = await saveFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    photo_url = saved.url;
    photo_key = saved.key;
  }
  db.prepare(`UPDATE pets SET name=@name, species=@species, breed=@breed, sex=@sex, birthdate=@birthdate,
    adopted_date=@adopted_date, passed_date=@passed_date, notes=@notes, photo_url=@photo_url, photo_key=@photo_key
    WHERE id=@id`).run({ ...pet, species: pet.species || 'cat', photo_url, photo_key, id: existing.id });
  res.json(db.prepare('SELECT * FROM pets WHERE id = ?').get(existing.id));
});

router.delete('/api/pets/:id', async (req, res) => {
  const existing = db.prepare('SELECT * FROM pets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const docs = db.prepare('SELECT storage_key FROM documents WHERE pet_id = ?').all(existing.id);
  db.prepare('DELETE FROM pets WHERE id = ?').run(existing.id);
  await deleteFile(existing.photo_key);
  for (const d of docs) await deleteFile(d.storage_key);
  res.json({ ok: true });
});

module.exports = router;
