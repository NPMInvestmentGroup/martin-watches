// Builds the curated Gallery page. Runs automatically on deploy (see Dockerfile), after build-gallery.js.
//
// Reads scripts/gallery-curated.json (the approved list) and, for every build marked "published":
//   - makes web-sized photos with neutral names in images/gallery-photos/ (no customer names in any address)
//       <id>-<title>-<n>.webp        full size, longest side 1600 px
//       <id>-<title>-1-thumb.webp    720 x 900 grid tile of the cover photo
//   - writes the photo cards, alt text and captions straight into gallery/index.html (readable without JavaScript)
//   - writes an nginx redirect list so the old photo addresses of published photos (including identical copies
//     elsewhere in images/Gallery, and their old thumbnails) move permanently to the new addresses.
// Folders that are not in the list, and builds marked "pending", are not published.
//
// Usage: node scripts/build-curated-gallery.js [redirect-map-path]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'images', 'Gallery');
const OUT_DIR = path.join(ROOT, 'images', 'gallery-photos');
const OUT_URL = '/images/gallery-photos/';
const PAGE = path.join(ROOT, 'gallery', 'index.html');
const MAP_OUT = process.argv[2] || path.join(ROOT, 'gallery-redirects.map');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'gallery-curated.json'), 'utf8'));

const COLLECTIONS = { Diver: 'diver', GMT: 'gmt', Chronograph: 'chronograph', Dress: 'dress', "Women's": 'womens', Other: 'other' };
const LABELS = { Diver: 'Diver', GMT: 'GMT', Chronograph: 'Chronograph', Dress: 'Dress', "Women's": "Women's", Other: 'Other styles' };
const ALT_NOUN = { Diver: 'diver watch', GMT: 'GMT watch', Chronograph: 'chronograph watch', Dress: 'dress watch', "Women's": "women's watch", Other: 'watch' };
const TABS = [['all', 'All Watches'], ['diver', 'Divers'], ['gmt', 'GMTs'], ['chronograph', 'Chronographs'], ['dress', 'Dress Watches'], ['womens', "Women's Watches"]];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const slug = s => s.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hash = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
const nginxStr = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(full)); else if (/\.(jpe?g|png|webp)$/i.test(e.name)) out.push(full);
  }
  return out;
}

(async () => {
  // Guard rails: no names or banned wording in public text
  for (const b of data.builds) {
    if (!COLLECTIONS[b.collection]) throw new Error(`${b.id}: unknown collection "${b.collection}"`);
    if (/family edition/i.test(b.title + ' ' + b.caption)) throw new Error(`${b.id}: "Family Edition" may not appear in Gallery text`);
  }
  const published = data.builds.filter(b => b.status === 'published');

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Every file in images/Gallery by content, so identical copies in other folders redirect too
  const byHash = {};
  for (const f of walk(SRC)) (byHash[hash(f)] ||= []).push(path.relative(SRC, f).split(path.sep).join('/'));

  const cards = [], redirects = new Map();
  let fullBytes = 0, photoCount = 0;
  for (const [i, b] of published.entries()) {
    const base = `${b.id}-${slug(b.title)}`, fulls = [];
    for (const [k, rel] of b.photos.entries()) {
      const src = path.join(SRC, rel);
      if (!fs.existsSync(src)) throw new Error(`${b.id}: photo not found: ${rel}`);
      const name = `${base}-${k + 1}`;
      const info = await sharp(src).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 6 }).toFile(path.join(OUT_DIR, name + '.webp'));
      fullBytes += info.size; photoCount++;
      if (k === 0) await sharp(src).rotate().resize({ width: 720, height: 900, fit: 'cover', position: 'centre' })
        .webp({ quality: 80, effort: 6 }).toFile(path.join(OUT_DIR, name + '-thumb.webp'));
      const url = OUT_URL + name + '.webp';
      fulls.push(url);
      for (const old of byHash[hash(src)] || [rel]) {
        redirects.set('/images/Gallery/' + old, url);
        redirects.set('/images/Gallery-thumbs/' + old.replace(/\.[^.]+$/, '') + '.webp', url);
      }
    }
    const firstSentence = b.caption.split('. ')[0].replace(/\.$/, '');
    const alt = `Martin custom ${ALT_NOUN[b.collection]}: ${firstSentence.charAt(0).toLowerCase() + firstSentence.slice(1)}`;
    const thumb = fulls[0].replace(/\.webp$/, '-thumb.webp');
    cards.push(
`      <figure class="gc" data-type="${COLLECTIONS[b.collection]}" data-photos="${esc(JSON.stringify(fulls))}">
        <a class="gc-photo" href="${fulls[0]}"><img src="${thumb}" width="720" height="900" alt="${esc(alt)}" loading="${i < 6 ? 'eager' : 'lazy'}" decoding="async"></a>
        <figcaption>${b.collection === 'Other' ? `<span class="gc-type">${esc(LABELS[b.collection])}</span>` : `<a class="gc-type" href="/watches/${COLLECTIONS[b.collection]}/">${esc(LABELS[b.collection])}</a>`}<span class="gc-title">${esc(b.title)}</span><span class="gc-cap">${esc(b.caption)}</span></figcaption>
      </figure>`);
  }

  const tabs = TABS.map(([k, n]) => `      <button type="button" class="gallery-tab${k === 'all' ? ' active' : ''}" data-filter="${k}" aria-pressed="${k === 'all'}">${esc(n)}</button>`).join('\n');
  const block = `<!-- GALLERY:START (generated by scripts/build-curated-gallery.js from scripts/gallery-curated.json; edit the list, not this block) -->
    <div class="gallery-tabs" role="toolbar" aria-label="Filter by collection">
${tabs}
    </div>
    <div class="gc-grid" id="galleryGrid">
${cards.join('\n')}
    </div>
    <!-- GALLERY:END -->`;
  const page = fs.readFileSync(PAGE, 'utf8');
  if (!/<!-- GALLERY:START[\s\S]*?<!-- GALLERY:END -->/.test(page)) throw new Error('gallery/index.html is missing the GALLERY:START / GALLERY:END markers');
  fs.writeFileSync(PAGE, page.replace(/<!-- GALLERY:START[\s\S]*?<!-- GALLERY:END -->/, () => block));

  fs.writeFileSync(MAP_OUT, [...redirects].map(([from, to]) => `${nginxStr(from)} ${nginxStr(to)};`).join('\n') + '\n');
  console.log(`Curated gallery: ${published.length} builds, ${photoCount} photos (avg ${Math.round(fullBytes / photoCount / 1024)} KB), ` +
    `${data.builds.length - published.length} pending, ${redirects.size} old addresses redirected`);
})().catch(e => { console.error(e.message); process.exit(1); });
