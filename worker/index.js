import { Hono } from 'hono';
import { authRoutes, requireAuth } from './auth.js';
import pets from './pets.js';
import posts from './posts.js';
import medical from './medical.js';
import { sharePublic, shareAdmin } from './share.js';

const app = new Hono();

// Login/logout/me are registered before the auth middleware so they stay reachable.
app.route('', authRoutes);
// Vet share links: the secret token in the URL is the credential.
app.route('', sharePublic);

app.use('/api/*', requireAuth);
app.use('/media/*', requireAuth);

// Media is served out of R2 through the Worker so it sits behind the password gate.
app.get('/media/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ''));
  if (!key || key.includes('..')) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.json({ error: 'not found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'private, max-age=2592000');
  return new Response(obj.body, { headers });
});

app.route('', pets);
app.route('', posts);
app.route('', medical);
app.route('', shareAdmin);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Something went wrong' }, 500);
});

export default app;
