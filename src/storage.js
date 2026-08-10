const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DATA_DIR } = require('./db');

const R2_BUCKET = process.env.R2_BUCKET;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

const useR2 = Boolean(R2_BUCKET && R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_PUBLIC_URL);

let s3 = null;
if (useR2) {
  const { S3Client } = require('@aws-sdk/client-s3');
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
}

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

function makeKey(originalName) {
  const ext = (path.extname(originalName || '') || '.bin').toLowerCase();
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${crypto.randomUUID()}${ext}`;
}

// Saves a buffer and returns { url, key }. Uses R2 when configured, local disk otherwise.
async function saveFile(buffer, originalName, contentType) {
  const key = makeKey(originalName);
  if (useR2) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    }));
    return { url: `${R2_PUBLIC_URL}/${key}`, key };
  }
  const filePath = path.join(UPLOADS_DIR, key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return { url: `/media/${key}`, key };
}

async function deleteFile(key) {
  if (!key) return;
  try {
    if (useR2) {
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    } else {
      fs.unlinkSync(path.join(UPLOADS_DIR, key));
    }
  } catch (err) {
    // Best-effort: a missing file should never block deleting the record.
  }
}

module.exports = { saveFile, deleteFile, useR2, UPLOADS_DIR };
