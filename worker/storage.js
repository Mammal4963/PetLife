// R2-backed file storage. Files are served back through the Worker at /media/<key>
// so they stay behind the same password gate as the rest of the site.

export async function saveFile(env, file) {
  const ext = ((file.name || '').match(/\.\w+$/) || ['.bin'])[0].toLowerCase();
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const key = `${yyyy}/${mm}/${crypto.randomUUID()}${ext}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  return { url: `/media/${key}`, key };
}

export async function deleteFiles(env, keys) {
  const real = keys.filter(Boolean);
  if (real.length) {
    try {
      await env.MEDIA.delete(real);
    } catch {
      // Best-effort: a missing object should never block deleting the record.
    }
  }
}
