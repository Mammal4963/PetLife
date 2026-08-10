import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const COOKIE = 'pl_session';

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The session cookie is an HMAC of the site password, keyed by a separate
// secret, so it can't be forged and changing the password invalidates it.
async function sessionToken(env) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(env.SESSION_SECRET || 'petlife-dev-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(env.SITE_PASSWORD || '')));
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isAuthed(c) {
  if (!c.env.SITE_PASSWORD) return true;
  const cookie = getCookie(c, COOKIE);
  if (!cookie) return false;
  return constantTimeEqual(cookie, await sessionToken(c.env));
}

export async function requireAuth(c, next) {
  if (await isAuthed(c)) return next();
  return c.json({ error: 'unauthorized' }, 401);
}

export const authRoutes = new Hono();

authRoutes.get('/api/me', async (c) => {
  c.header('cache-control', 'no-store');
  return c.json({ authRequired: Boolean(c.env.SITE_PASSWORD), authed: await isAuthed(c) });
});

authRoutes.post('/api/login', async (c) => {
  if (!c.env.SITE_PASSWORD) return c.json({ ok: true });
  const body = await c.req.json().catch(() => ({}));
  if (!constantTimeEqual(String(body.password || ''), c.env.SITE_PASSWORD)) {
    return c.json({ error: 'Wrong password' }, 401);
  }
  setCookie(c, COOKIE, await sessionToken(c.env), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
  });
  return c.json({ ok: true });
});

authRoutes.post('/api/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});
