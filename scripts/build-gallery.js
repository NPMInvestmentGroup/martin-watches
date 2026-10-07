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

// ─────────────────────────────────────────────────────────────────────────────
// WATCH BUILDER PARTS: scans images/builds/<family>/<category>/*.png and writes builds.json
// plus small preview + thumbnail images, so adding a part = dropping a PNG in a folder.
// All layers share one 1500x1500 canvas and one centre, so any combination stacks perfectly.
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  const BUILDS = path.join(ROOT, 'images', 'builds');
  const GEN = path.join(BUILDS, '_generated');
  if (!fs.existsSync(BUILDS)) return;
  fs.rmSync(GEN, { recursive: true, force: true });
  // thumbnail crop (on the 1500px canvas) per category, so each option thumbnail shows the part itself
  const CROPS = {
    dials:     { left: 450, top: 450, width: 600, height: 600 },
    bezels:    { left: 370, top: 370, width: 760, height: 760 },
    cases:     { left: 330, top: 330, width: 880, height: 880 },
    bracelets: { left: 520, top: 20,  width: 460, height: 460 },
    hands:     { left: 450, top: 450, width: 600, height: 600 },
  };
  const out = { families: {} };
  let count = 0;
  for (const fam of fs.readdirSync(BUILDS, { withFileTypes: true })) {
    if (!fam.isDirectory() || fam.name.startsWith('_')) continue;
    const famDir = path.join(BUILDS, fam.name);
    let labels = {};
    try { labels = JSON.parse(fs.readFileSync(path.join(famDir, 'labels.json'), 'utf8')); } catch (e) {}
    out.families[fam.name] = {};
    for (const cat of fs.readdirSync(famDir, { withFileTypes: true })) {
      if (!cat.isDirectory()) continue;
      const files = fs.readdirSync(path.join(famDir, cat.name)).filter(f => /\.png$/i.test(f));
      const order = Object.keys(labels[cat.name] || {});
      files.sort((a, b) => {
        const ia = order.indexOf(a.replace(/\.png$/i, '')), ib = order.indexOf(b.replace(/\.png$/i, ''));
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
      });
      const items = [];
      for (const f of files) {
        const id = f.replace(/\.png$/i, '');
        const rel = `${fam.name}/${cat.name}/${id}`;
        const src = path.join(famDir, cat.name, f);
        try {
          const genDir = path.join(GEN, fam.name, cat.name);
          fs.mkdirSync(genDir, { recursive: true });
          await sharp(src).resize({ width: 1000 }).webp({ quality: 90, alphaQuality: 100, effort: 4 })
            .toFile(path.join(genDir, id + '.preview.webp'));
          const crop = CROPS[cat.name];
          let img = sharp(src);
          if (crop) img = img.extract(crop);
          await img.resize({ width: 220 }).webp({ quality: 85, alphaQuality: 100 })
            .toFile(path.join(genDir, id + '.thumb.webp'));
          const label = (labels[cat.name] || {})[id] ||
            id.replace(/^[a-z]+-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          items.push({
            id, label,
            thumb:   `images/builds/_generated/${rel}.thumb.webp`,
            preview: `images/builds/_generated/${rel}.preview.webp`,
            full:    `images/builds/${rel}.png`,
          });
          count++;
        } catch (e) { console.warn('Build part skipped:', rel, e.message); }
      }
      out.families[fam.name][cat.name] = items;
    }
  }
  fs.writeFileSync(path.join(ROOT, 'builds.json'), JSON.stringify(out));
  console.log(`Builder parts: ${count} parts in ${Object.keys(out.families).length} family(ies)`);
})();
