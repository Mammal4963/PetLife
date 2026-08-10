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

// Best-effort "date taken" for a photo: EXIF DateTimeOriginal for JPEGs
// (read from the original file — compression strips metadata), falling back
// to the file's modified time. Returns "YYYY-MM-DD" or null.
async function readPhotoDate(file) {
  if (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) {
    try {
      const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
      const d = exifDate(view);
      if (d) return d;
    } catch { /* malformed EXIF — fall through to mtime */ }
  }
  if (file.lastModified) {
    const d = new Date(file.lastModified);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
}

function exifDate(view) {
  if (view.getUint16(0) !== 0xffd8) return null;
  for (let off = 2; off + 4 <= view.byteLength;) {
    const marker = view.getUint16(off);
    if ((marker & 0xff00) !== 0xff00) return null;
    const size = view.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= view.byteLength && view.getUint32(off + 4) === 0x45786966) {
      return tiffDate(view, off + 10);
    }
    if (marker === 0xffda) return null; // start of image data — no EXIF ahead
    off += 2 + size;
  }
  return null;
}

function tiffDate(view, tiff) {
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (o) => view.getUint16(o, little);
  const u32 = (o) => view.getUint32(o, little);
  const ascii = (entry) => {
    const count = u32(entry + 4);
    const start = count <= 4 ? entry + 8 : tiff + u32(entry + 8);
    let s = '';
    for (let i = 0; i < count && start + i < view.byteLength; i++) {
      const c = view.getUint8(start + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const toIso = (s) => {
    const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(s || '');
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  };
  let exifIfd = 0;
  let ifd0Date = null;
  const ifd0 = tiff + u32(tiff + 4);
  const n = u16(ifd0);
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    const tag = u16(e);
    if (tag === 0x8769) exifIfd = tiff + u32(e + 8);
    if (tag === 0x0132) ifd0Date = ascii(e); // plain DateTime, the fallback
  }
  if (exifIfd) {
    const n2 = u16(exifIfd);
    for (let i = 0; i < n2; i++) {
      const e = exifIfd + 2 + i * 12;
      if (u16(e) === 0x9003) return toIso(ascii(e)) || toIso(ifd0Date);
    }
  }
  return toIso(ifd0Date);
}
