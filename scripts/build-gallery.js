// Scans images/Gallery (including subfolders), makes small thumbnails,
// and writes gallery.json for the website. Runs automatically on deploy (see Dockerfile).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'images', 'Gallery');
const THUMBS = path.join(ROOT, 'images', 'Gallery-thumbs');
const OUT = path.join(ROOT, 'gallery.json');
const IMG = /\.(jpe?g|png|webp)$/i;

function walk(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(walk(full));
    else if (IMG.test(entry.name)) files.push(full);
  }
  return files;
}

(async () => {
  if (!fs.existsSync(SRC)) { console.log('No Gallery folder'); process.exit(0); }
  fs.rmSync(THUMBS, { recursive: true, force: true });
  const files = walk(SRC).sort();
  const photos = [];
  let failed = 0;
  for (const file of files) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const parts = rel.split('/');
    const album = parts.length > 1 ? parts[0] : '';
    const thumbRel = rel.replace(/\.[^.]+$/, '') + '.webp';
    const thumbPath = path.join(THUMBS, thumbRel);
    try {
      fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
      const info = await sharp(file).rotate().resize({ width: 640, withoutEnlargement: true })
        .webp({ quality: 72 }).toFile(thumbPath);
      photos.push({ src: rel, thumb: thumbRel, album, w: info.width, h: info.height });
    } catch (e) {
      failed++;
      console.warn('Skipped (unreadable):', rel, e.message);
    }
  }
  const albums = [...new Set(photos.map(p => p.album).filter(Boolean))].sort();
  fs.writeFileSync(OUT, JSON.stringify({ albums, photos }));
  console.log(`Gallery: ${photos.length} photos, ${albums.length} albums, ${failed} skipped`);
})();
