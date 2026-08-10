const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { DATA_DIR } = require('./db');

const PASSWORD = process.env.SITE_PASSWORD || '';
const COOKIE = 'pl_session';

// A per-install secret so session cookies survive restarts but can't be forged.
const secretPath = path.join(DATA_DIR, '.secret');
let secret;
if (fs.existsSync(secretPath)) {
  secret = fs.readFileSync(secretPath, 'utf8');
} else {
  secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
}

function sessionToken() {
  return crypto.createHmac('sha256', secret).update(PASSWORD).digest('hex');
}

function isAuthed(req) {
  if (!PASSWORD) return true;
  const cookie = req.cookies && req.cookies[COOKIE];
  if (!cookie) return false;
  const expected = sessionToken();
  return cookie.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(expected));
}

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'unauthorized' });
}

const authRouter = express.Router();

authRouter.get('/api/me', (req, res) => {
  res.json({ authRequired: Boolean(PASSWORD), authed: isAuthed(req) });
});

authRouter.post('/api/login', express.json(), (req, res) => {
  if (!PASSWORD) return res.json({ ok: true });
  const given = String((req.body && req.body.password) || '');
  const expected = Buffer.from(PASSWORD);
  const attempt = Buffer.from(given);
  const match = attempt.length === expected.length && crypto.timingSafeEqual(attempt, expected);
  if (!match) return res.status(401).json({ error: 'Wrong password' });
  res.cookie(COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

authRouter.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

module.exports = { authRouter, requireAuth };
