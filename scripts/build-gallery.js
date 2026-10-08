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

// BUILDER_ONLY=1 skips the photo gallery (used by tools/add_part.py)
(process.env.BUILDER_ONLY ? async () => {} : async () => {
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
// WATCH BUILDER: every part lives ONCE in images/builds/parts/<category>/<id>.webp (all layers share one
// 1500px canvas and one centre, so any combination stacks perfectly). images/builds/registry.json lists the
// parts and which families use each; images/builds/families.json defines the families (name, size, price).
// On every deploy this writes builds.json (what the page reads) and small thumbnails.
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  const BUILDS = path.join(ROOT, 'images', 'builds');
  const regPath = path.join(BUILDS, 'registry.json'), famPath = path.join(BUILDS, 'families.json');
  if (!fs.existsSync(regPath) || !fs.existsSync(famPath)) return;
  const crypto = require('crypto');
  const vq = rel => { try { return '?v=' + crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 10); } catch (e) { return ''; } };   // changes only when the picture changes
  const GEN = path.join(BUILDS, '_generated');
  fs.rmSync(GEN, { recursive: true, force: true });
  const registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  const families = JSON.parse(fs.readFileSync(famPath, 'utf8'));
  // thumbnail crop (on the 1500px canvas) per category, so each option shows the part itself
  const CROPS = {
    dials:     { left: 450, top: 450, width: 600, height: 600 },
    bezels:    { left: 370, top: 370, width: 760, height: 760 },
    cases:     { left: 330, top: 330, width: 880, height: 880 },
    bracelets: { left: 520, top: 20,  width: 460, height: 460 },
    hands:     { left: 450, top: 450, width: 600, height: 600 },
    gmthands:  { left: 450, top: 450, width: 600, height: 600 },
  };
  const made = {};                                        // 'cat/id' -> thumb url (or null if the file is missing)
  let count = 0;
  for (const p of registry.parts) {
    const src = path.join(BUILDS, 'parts', p.cat, p.id + '.webp');
    if (!fs.existsSync(src)) { console.warn('Missing part file:', p.cat + '/' + p.id); made[p.cat + '/' + p.id] = null; continue; }
    try {
      const dir = path.join(GEN, p.cat); fs.mkdirSync(dir, { recursive: true });
      let img = sharp(src); if (CROPS[p.cat]) img = img.extract(CROPS[p.cat]);
      await img.resize({ width: 220 }).webp({ quality: 85, alphaQuality: 100 }).toFile(path.join(dir, p.id + '.thumb.webp'));
      { const rel = `images/builds/_generated/${p.cat}/${p.id}.thumb.webp`; made[p.cat + '/' + p.id] = rel + vq(rel); } count++;
    } catch (e) { console.warn('Part skipped:', p.id, e.message); made[p.cat + '/' + p.id] = null; }
  }
  const out = { families: {}, pending: {} };
  for (const [fid, fam] of Object.entries(families)) {
    const cats = {};
    for (const cat of fam.layers) {
      // dials are matched by SIZE (a case only takes dials of its dial size); everything else by the family list
      // a family can hand-pick a category's parts (in its own order) instead of matching by family list
      const picked = fam.pick && fam.pick[cat] ? fam.pick[cat].map(id => registry.parts.find(p => p.id === id && p.cat === cat)).filter(Boolean) : null;
      if (picked && picked.length !== fam.pick[cat].length) console.warn(`${fid}: some picked ${cat} not found:`, fam.pick[cat].filter(id => !registry.parts.some(p => p.id === id)));
      cats[cat] = (picked || registry.parts.filter(p => p.cat === cat && (cat === 'dials' && fam.dialSize ? p.size_mm === fam.dialSize : (p.families || []).includes(fid)))).filter(p => made[p.cat + '/' + p.id]).map(p => {
        const useVariant = fam.variant && (p.variants || []).includes(fam.variant);
        const srcRel = `images/builds/parts/${p.cat}/${p.id}${useVariant ? '@' + fam.variant : ''}.webp`;
        const item = { id: p.id, label: p.label, thumb: made[p.cat + '/' + p.id], src: srcRel + vq(srcRel), lowres: !!p.lowres };
        // bezel: a version with the steel frame recoloured to gold, shown with gold / two-tone cases
        if (p.cat === 'bezels' && (p.variants || []).includes('g')) { const r = `images/builds/parts/${p.cat}/${p.id}@g.webp`; item.srcGold = r + vq(r); }
        if (p.goldFrame) item.goldFrame = true;
        if (p.blackFrame) item.blackFrame = true;
        if (fam.labels && fam.labels[p.id]) item.label = fam.labels[p.id];        // per-family name (e.g. nicknames on the Saturation Diver)
        if (p.size_mm) item.size_mm = p.size_mm;
        // hands whose pictures depend on the dial (chronograph: sub-dial hands sit on that dial's own sub-dials)
        if (p.perDial) {
          item.srcByDial = {};
          for (const d of (cats.dials || [])) {
            const f = `images/builds/parts/${p.cat}/${p.id}@${d.id}.webp`;
            if (fs.existsSync(path.join(ROOT, f))) item.srcByDial[d.id] = f + vq(f);
          }
        }
        return item;
      });
    }
    const missing = fam.layers.filter(c => cats[c].length === 0);
    if (missing.length) { out.pending[fid] = { name: fam.name, missing }; continue; }       // not complete yet: stays hidden
    // shared bezel frame (toothed ring + inner rim) drawn under the insert; gold version for gold / two-tone cases
    let frame = null;
    if (fam.frame) {
      const fs1 = `images/builds/parts/frames/${fam.frame}.webp`, fs2 = `images/builds/parts/frames/${fam.frame}@g.webp`;
      const fs3 = `images/builds/parts/frames/${fam.frame}@b.webp`;
      if (fs.existsSync(path.join(ROOT, fs1))) frame = { src: fs1 + vq(fs1), srcGold: fs.existsSync(path.join(ROOT, fs2)) ? fs2 + vq(fs2) : null, srcBlack: fs.existsSync(path.join(ROOT, fs3)) ? fs3 + vq(fs3) : null };
    }
    // engraved ring between dial and bezel (Saturation Diver); its finish follows the case
    let ring = null;
    if (fam.ring) {
      const rel = v => `images/builds/parts/rings/${fam.ring}${v ? '@' + v : ''}.webp`;
      if (fs.existsSync(path.join(ROOT, rel('')))) {
        ring = { src: rel('') + vq(rel('')), byCase: {} };
        for (const [caseId, v] of Object.entries(fam.ringByCase || {})) if (fs.existsSync(path.join(ROOT, rel(v)))) ring.byCase[caseId] = rel(v) + vq(rel(v));
      }
    }
    out.families[fid] = { frame, ring, name: fam.name, size_mm: fam.size_mm, dialSize: fam.dialSize || null, dialScale: fam.dialScale || 1, handScale: fam.handScale || 1, strapOffset: fam.strapOffset || 0, price: fam.price, layers: fam.layers, parts: cats };
  }
  fs.writeFileSync(path.join(ROOT, 'builds.json'), JSON.stringify(out));
  console.log(`Builder: ${count} parts, live families: ${Object.keys(out.families).join(', ')}` +
              (Object.keys(out.pending).length ? ` | waiting for parts: ${Object.entries(out.pending).map(([k, v]) => k + ' (' + v.missing.join('+') + ')').join(', ')}` : ''));
})();
