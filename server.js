const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

require('./src/db');
const { authRouter, requireAuth } = require('./src/auth');
const { UPLOADS_DIR, useR2 } = require('./src/storage');

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());

app.use(authRouter);
// Vet share links: the secret token in the URL is the credential, so this
// router sits before the auth gate (its admin routes require auth themselves).
app.use(require('./src/routes/share'));
app.use('/api', requireAuth);
app.use('/media', requireAuth, express.static(UPLOADS_DIR, { maxAge: '30d', immutable: true }));

app.use(require('./src/routes/pets'));
app.use(require('./src/routes/posts'));
app.use(require('./src/routes/medical'));

app.use(express.static(path.join(__dirname, 'public')));

// Friendly JSON errors (including multer file-size rejections).
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is too large' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🐾 PetLife running at http://localhost:${PORT}`);
  console.log(`   Media storage: ${useR2 ? 'Cloudflare R2' : 'local disk (data/uploads)'}`);
  if (!process.env.SITE_PASSWORD) {
    console.log('   No SITE_PASSWORD set — the site is open to anyone who can reach it.');
  }
});
