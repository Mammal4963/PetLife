// Client-side photo compression: resize to a sane web size and re-encode,
// so a 6 MB phone photo becomes a few hundred KB before it ever leaves the browser.
async function compressImage(file, maxDim = 2000, quality = 0.85) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    return file; // Format the browser can't decode (rare HEIC cases) — upload as-is.
  }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', quality));
  let ext = '.webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    ext = '.jpg';
  }
  if (!blob || blob.size >= file.size) return file; // Compression didn't help — keep the original.
  const name = file.name.replace(/\.\w+$/, '') + ext;
  return new File([blob], name, { type: blob.type });
}
