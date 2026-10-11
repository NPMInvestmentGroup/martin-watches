const express = require('express');
const { Pool } = require('pg');
const { Resend } = require('resend');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' }));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'x-admin-password', 'x-admin-token']
}));

const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const REPO_OWNER     = 'NPMInvestmentGroup';
const REPO_NAME      = 'martin-watches';
const GALLERY_PATH   = 'images/Gallery';

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS watch_prices (
      family_id VARCHAR(50) PRIMARY KEY,
      price INTEGER NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prices (
      id VARCHAR(100) PRIMARY KEY,
      price INTEGER NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS discount_codes (
      code VARCHAR(100) PRIMARY KEY,
      discount_type VARCHAR(10) NOT NULL,
      discount_value NUMERIC NOT NULL,
      active BOOLEAN DEFAULT true
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id SERIAL PRIMARY KEY,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      email VARCHAR(200),
      phone VARCHAR(50),
      watch_family VARCHAR(100),
      build_summary TEXT,
      notes TEXT,
      submitted_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('Database ready');
}

// ── ADMIN LOGIN ───────────────────────────────────────────────────────────────
// The admin page no longer contains the password. It sends what was typed to /admin/login once and gets a
// signed session key (12 hours). Changing ADMIN_PASSWORD in the server settings logs every session out.
const SESSION_SECRET = process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('mwc-session:' + (ADMIN_PASSWORD || '') + ':' + (GITHUB_TOKEN || '')).digest('hex');
const SESSION_HOURS = 12;
const failures = new Map();                 // ip -> [timestamps of wrong passwords]
let globalFailures = [];
function tooManyFailures(ip) {
  const now = Date.now();
  const mine = (failures.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  failures.set(ip, mine);
  globalFailures = globalFailures.filter(t => now - t < 60 * 60 * 1000);
  return mine.length >= 8 || globalFailures.length >= 60;
}
function noteFailure(ip) { (failures.get(ip) || failures.set(ip, []).get(ip)).push(Date.now()); globalFailures.push(Date.now()); }
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function samePassword(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function makeToken() {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  return exp + '.' + crypto.createHmac('sha256', SESSION_SECRET).update(String(exp)).digest('hex');
}
function validToken(tok) {
  const [exp, sig] = String(tok || '').split('.');
  if (!exp || !sig || !/^[0-9a-f]{64}$/.test(sig) || Number(exp) < Date.now()) return false;
  const want = crypto.createHmac('sha256', SESSION_SECRET).update(exp).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(want, 'hex'));
}

app.post('/admin/login', (req, res) => {
  const ip = clientIp(req);
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'Admin password is not set on the server' });
  if (tooManyFailures(ip)) return res.status(429).json({ error: 'Too many wrong attempts. Try again in 15 minutes.' });
  if (!samePassword(req.body && req.body.password, ADMIN_PASSWORD)) { noteFailure(ip); return res.status(401).json({ error: 'Incorrect password' }); }
  res.json({ token: makeToken(), hours: SESSION_HOURS });
});

function checkAdmin(req, res) {
  if (validToken(req.headers['x-admin-token'])) return true;
  // older admin pages send the typed password itself; still accepted, but wrong guesses count toward the lockout
  const pw = req.headers['x-admin-password'];
  if (pw !== undefined) {
    const ip = clientIp(req);
    if (tooManyFailures(ip)) { res.status(429).json({ error: 'Too many wrong attempts' }); return false; }
    if (ADMIN_PASSWORD && samePassword(pw, ADMIN_PASSWORD)) return true;
    noteFailure(ip);
  }
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

app.get('/', (req, res) => {
  res.json({ status: 'Martin Watches API running' });
});

// ── WATCH PRICES ──────────────────────────────────────────────────────────────

const DEFAULT_WATCH_PRICES = {
  sub:    600,
  dj:     600,
  chrono: 600,
  gmt:    600,
  womens: 400,
};

app.get('/watch-prices', async (req, res) => {
  try {
    const result = await pool.query('SELECT family_id, price FROM watch_prices');
    const prices = Object.assign({}, DEFAULT_WATCH_PRICES);
    result.rows.forEach(r => prices[r.family_id] = r.price);
    res.json(prices);
  } catch(err) {
    res.status(500).json(DEFAULT_WATCH_PRICES);
  }
});

app.post('/watch-prices', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { prices } = req.body;
  if (!prices) return res.status(400).json({ error: 'Invalid' });
  try {
    for (const [id, price] of Object.entries(prices)) {
      await pool.query(
        `INSERT INTO watch_prices (family_id, price) VALUES ($1, $2)
         ON CONFLICT (family_id) DO UPDATE SET price = $2`,
        [id, parseInt(price)]
      );
    }
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ error: 'Could not save prices' });
  }
});

// ── GALLERY ENDPOINTS ─────────────────────────────────────────────────────────

app.get('/gallery', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${GALLERY_PATH}`, {
      headers: { 'Authorization': 'token ' + GITHUB_TOKEN }
    });
    const files = await response.json();
    const images = Array.isArray(files)
      ? files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name))
      : [];
    res.json(images);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load gallery' });
  }
});

app.post('/gallery/upload', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { filename, content } = req.body;
  if (!filename || !content) return res.status(400).json({ error: 'Missing filename or content' });
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${GALLERY_PATH}/${filename}`, {
      method: 'PUT',
      headers: {
        'Authorization': 'token ' + GITHUB_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Add gallery photo: ' + filename,
        content: content,
      })
    });
    const data = await response.json();
    if (response.ok) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: data.message || 'Upload failed' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.delete('/gallery/delete', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { path, sha, name } = req.body;
  if (!path || !sha) return res.status(400).json({ error: 'Missing path or sha' });
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
      method: 'DELETE',
      headers: {
        'Authorization': 'token ' + GITHUB_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Delete gallery photo: ' + (name || path),
        sha: sha,
      })
    });
    if (response.ok) {
      res.json({ success: true });
    } else {
      const data = await response.json();
      res.status(500).json({ error: data.message || 'Delete failed' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── FOLDER SYNC (admin: upload many files in ONE commit) ─────────────────────
const GH = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
const GH_HEADERS = () => ({
  'Authorization': 'token ' + GITHUB_TOKEN,
  'Content-Type': 'application/json',
  'Accept': 'application/vnd.github+json',
});
const SYNC_EXT = /\.(png|jpe?g|webp|gif)$/i;

function validSyncPath(p) {
  return typeof p === 'string' &&
    p.length < 300 &&
    p.startsWith('images/') &&
    !p.startsWith('images/Gallery-thumbs/') &&
    !p.includes('..') && !p.includes('//') && !p.includes('\\') &&
    SYNC_EXT.test(p);
}

// List everything already under images/ so the admin page can work out what's new
app.get('/sync/tree', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const r = await fetch(`${GH}/git/trees/main?recursive=1`, { headers: GH_HEADERS() });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data.message || 'Could not read repo' });
    const files = (data.tree || [])
      .filter(t => t.type === 'blob' && t.path.startsWith('images/'))
      .map(t => ({ path: t.path, size: t.size, sha: t.sha }));
    res.json({ files, truncated: !!data.truncated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not read repo' });
  }
});

// Upload one file's contents as a blob (not visible on the site until committed)
app.post('/sync/blob', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Missing content' });
  try {
    const { r, data } = await ghRetry(`${GH}/git/blobs`, {
      method: 'POST',
      headers: GH_HEADERS(),
      body: JSON.stringify({ content, encoding: 'base64' }),
    });
    if (!r.ok) return res.status(500).json({ error: data.message || 'Blob upload failed' });
    res.json({ sha: data.sha });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Blob upload failed' });
  }
});

// GitHub can answer 5xx when it is busy or a request is heavy - retry a couple of times
async function ghRetry(url, opts, tries = 3) {
  let r, data;
  for (let i = 0; i < tries; i++) {
    r = await fetch(url, opts);
    data = await r.json().catch(() => ({}));
    if (r.status < 500) break;
    await new Promise(ok => setTimeout(ok, 1500 * (i + 1)));
  }
  return { r, data };
}

// Step 1: where is main right now?
app.post('/sync/begin', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { r, data: ref } = await ghRetry(`${GH}/git/ref/heads/main`, { headers: GH_HEADERS() });
    if (!r.ok) throw new Error(ref.message || 'Could not read main');
    const head = ref.object.sha;
    const { r: r2, data: commit } = await ghRetry(`${GH}/git/commits/${head}`, { headers: GH_HEADERS() });
    if (!r2.ok) throw new Error(commit.message || 'Could not read main commit');
    res.json({ head, tree: commit.tree.sha });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not start' });
  }
});

// Step 2 (repeated): add a small batch of files on top of base_tree. Small batches keep GitHub from timing out.
app.post('/sync/build-tree', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { base_tree, files } = req.body;
  if (!/^[0-9a-f]{40}$/.test(base_tree || '')) return res.status(400).json({ error: 'Bad base tree' });
  if (!Array.isArray(files) || !files.length || files.length > 60) return res.status(400).json({ error: 'Batch must be 1-60 files' });
  for (const f of files) {
    if (!validSyncPath(f.path) || !/^[0-9a-f]{40}$/.test(f.sha || '')) {
      return res.status(400).json({ error: 'Rejected path: ' + f.path });
    }
  }
  try {
    const { r, data } = await ghRetry(`${GH}/git/trees`, {
      method: 'POST',
      headers: GH_HEADERS(),
      body: JSON.stringify({
        base_tree,
        tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', sha: f.sha })),
      }),
    });
    if (!r.ok) throw new Error(data.message || 'Could not build tree');
    res.json({ tree: data.sha });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not build tree' });
  }
});

// Step 3: one commit for everything = one Railway deploy
app.post('/sync/commit', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { head, tree, message } = req.body;
  if (!/^[0-9a-f]{40}$/.test(head || '') || !/^[0-9a-f]{40}$/.test(tree || '')) return res.status(400).json({ error: 'Bad commit request' });
  try {
    const { r, data: commit } = await ghRetry(`${GH}/git/commits`, {
      method: 'POST',
      headers: GH_HEADERS(),
      body: JSON.stringify({ message: String(message || 'Sync images from admin').slice(0, 200), tree, parents: [head] }),
    });
    if (!r.ok) throw new Error(commit.message || 'Could not create commit');
    const upd = await fetch(`${GH}/git/refs/heads/main`, {
      method: 'PATCH',
      headers: GH_HEADERS(),
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    if (upd.ok) return res.json({ success: true, commit: commit.sha });
    if (upd.status === 422) return res.status(409).json({ error: 'The website changed while uploading', retry: true });
    const d = await upd.json().catch(() => ({}));
    throw new Error(d.message || 'Could not update main');
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Commit failed' });
  }
});

// ── WATCH BUILDER: add parts and edit names / insert lists from the admin page ────
// The admin page fits the photo in the browser and sends the finished 1500px image. The server checks the login,
// updates images/builds/registry.json + families.json and commits everything as ONE commit (= one site deploy).
const B_ROOT = 'images/builds';
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9 &'().,\/+-]{0,39}$/;
const PART_ID_RE = /^(bezel|dial)-[a-z0-9]+(-[a-z0-9]+){0,8}$/;
const INSERT_FAMILIES = ['diver', 'gmt', 'satdiver'];
const slugify = s => String(s).toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function readJsonAt(path, ref) {
  const { r, data } = await ghRetry(`${GH}/contents/${path}?ref=${ref}`, { headers: GH_HEADERS() });
  if (!r.ok) throw new Error(`Could not read ${path}: ${data.message || r.status}`);
  return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
}
async function headNow() {
  const { r, data: ref } = await ghRetry(`${GH}/git/ref/heads/main`, { headers: GH_HEADERS() });
  if (!r.ok) throw new Error(ref.message || 'Could not read main');
  const { r: r2, data: c } = await ghRetry(`${GH}/git/commits/${ref.object.sha}`, { headers: GH_HEADERS() });
  if (!r2.ok) throw new Error(c.message || 'Could not read main commit');
  return { head: ref.object.sha, tree: c.tree.sha };
}
// files: [{ path, text }] or [{ path, base64 }]
async function commitAt(head, baseTree, files, message) {
  const tree = [];
  for (const f of files) {
    if (f.text !== undefined) { tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.text }); continue; }
    const { r, data } = await ghRetry(`${GH}/git/blobs`, { method: 'POST', headers: GH_HEADERS(), body: JSON.stringify({ content: f.base64, encoding: 'base64' }) });
    if (!r.ok) throw new Error(data.message || 'Image upload failed');
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: data.sha });
  }
  const { r: rt, data: t } = await ghRetry(`${GH}/git/trees`, { method: 'POST', headers: GH_HEADERS(), body: JSON.stringify({ base_tree: baseTree, tree }) });
  if (!rt.ok) throw new Error(t.message || 'Could not build tree');
  const { r: rc, data: c } = await ghRetry(`${GH}/git/commits`, { method: 'POST', headers: GH_HEADERS(), body: JSON.stringify({ message: message.slice(0, 200), tree: t.sha, parents: [head] }) });
  if (!rc.ok) throw new Error(c.message || 'Could not create commit');
  const upd = await fetch(`${GH}/git/refs/heads/main`, { method: 'PATCH', headers: GH_HEADERS(), body: JSON.stringify({ sha: c.sha, force: false }) });
  if (upd.status === 422) return null;                            // main moved underneath us: caller retries
  if (!upd.ok) { const d = await upd.json().catch(() => ({})); throw new Error(d.message || 'Could not update main'); }
  return c.sha;
}
// read registry + families at the current head, let `change` edit them, commit; retry if the site changed meanwhile
async function builderChange(change, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { head, tree } = await headNow();
    const reg = await readJsonAt(`${B_ROOT}/registry.json`, head), fam = await readJsonAt(`${B_ROOT}/families.json`, head);
    const extra = (await change(reg, fam)) || [];
    const files = [...extra,
      { path: `${B_ROOT}/registry.json`, text: JSON.stringify(reg) },
      { path: `${B_ROOT}/families.json`, text: JSON.stringify(fam, null, 1) }];
    const sha = await commitAt(head, tree, files, message);
    if (sha) return sha;
  }
  throw new Error('The website kept changing while saving - please try again');
}
class Bad extends Error {}

app.get('/builder/data', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { head } = await headNow();
    res.json({ registry: await readJsonAt(`${B_ROOT}/registry.json`, head), families: await readJsonAt(`${B_ROOT}/families.json`, head) });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.post('/builder/add-part', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { kind, label, replaceId } = req.body || {};
    let fams = Array.isArray(req.body.families) ? req.body.families.filter(f => INSERT_FAMILIES.includes(f)) : [];
    if (!['bezel', 'dial'].includes(kind)) throw new Bad('Unknown part type');
    if (!LABEL_RE.test(String(label || '').trim())) throw new Bad('Name: 1-40 letters, numbers, spaces and & \' ( ) . , / + -');
    if (kind === 'bezel' && !fams.length) throw new Bad('Pick at least one watch family for this insert');
    const scale = req.body.scale;                    // 'diver' = 60-minute dive scale, 'gmt' = 24-hour scale (needs a GMT hand)
    if (kind === 'bezel') {
      if (!['diver', 'gmt'].includes(scale)) throw new Bad('Choose whether this is a 60-minute dive insert or a 24-hour GMT insert');
      if (scale === 'diver' && fams.includes('gmt')) throw new Bad('A 60-minute dive insert cannot go on the GMT (it always has a GMT hand)');
      if (scale === 'gmt' && fams.includes('diver')) throw new Bad('A 24-hour GMT insert cannot go on the Diver (it has no GMT hand)');
    }
    const buf = Buffer.from(String(req.body.image || ''), 'base64');
    const isWebp = buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
    const isPng = buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG';
    if (!isWebp && !isPng) throw new Bad('Image must be WebP or PNG');
    if (buf.length > 8 * 1024 * 1024) throw new Bad('Image too large');
    const cat = kind + 's';
    let pid;
    const sha = await builderChange((reg, fam) => {
      const parts = reg.parts;
      if (replaceId) {
        const ex = parts.find(p => p.id === replaceId);
        if (!ex || ex.cat !== cat) throw new Bad('The part to replace was not found');
        pid = replaceId;
      } else {
        pid = (kind === 'dial' ? 'dial-' : (scale === 'gmt' ? 'bezel-gmt-' : 'bezel-')) + slugify(label);
        if (!PART_ID_RE.test(pid)) throw new Bad('Could not make a file name from that name');
        if (parts.some(p => p.id === pid)) throw new Bad(`A part called "${pid}" already exists - pick another name, or choose it under "Replace"`);
      }
      const entry = kind === 'dial'
        ? { id: pid, cat, label: label.trim(), size_mm: 28.5 }
        : { id: pid, cat, label: label.trim(), families: fams.filter(f => f !== 'satdiver'), type: scale, frame: 'frame-diver' };
      const at = parts.findIndex(p => p.id === pid);
      if (at >= 0) parts[at] = entry;
      else {
        let last = -1; parts.forEach((p, i) => { if (p.cat === cat && (kind === 'dial' || (p.families || []).some(f => fams.includes(f)) || (p.type === entry.type))) last = i; });
        parts.splice(last >= 0 ? last + 1 : parts.length, 0, entry);
      }
      if (kind === 'bezel' && fam.satdiver) {
        const pick = ((fam.satdiver.pick = fam.satdiver.pick || {}).bezels = fam.satdiver.pick.bezels || []);
        const i = pick.indexOf(pid);
        if (fams.includes('satdiver') && i < 0) pick.push(pid);
        if (!fams.includes('satdiver') && i >= 0 && replaceId) pick.splice(i, 1);
      }
      return [{ path: `${B_ROOT}/parts/${cat}/${pid}.webp`, base64: buf.toString('base64') }];
    }, `Builder: ${replaceId ? 'replace' : 'add'} ${kind} "${String(label).trim()}" (from admin)`);
    res.json({ success: true, id: pid, commit: sha });
  } catch (err) {
    console.error(err);
    res.status(err instanceof Bad ? 400 : 500).json({ error: err.message || 'Could not add the part' });
  }
});

// { labels: {id: "New name"}, family: "diver"|"gmt"|"satdiver", offered: [bezel ids in display order] }
app.post('/builder/config', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const labels = req.body.labels && typeof req.body.labels === 'object' ? req.body.labels : {};
    const family = req.body.family, offered = req.body.offered;
    for (const [id, l] of Object.entries(labels)) if (!LABEL_RE.test(String(l).trim())) throw new Bad(`Name for ${id}: 1-40 letters, numbers, spaces and & ' ( ) . , / + -`);
    if (family !== undefined) {
      if (!INSERT_FAMILIES.includes(family)) throw new Bad('Unknown family');
      if (!Array.isArray(offered) || !offered.length) throw new Bad('A family needs at least one insert');
    }
    const sha = await builderChange((reg, fam) => {
      const byId = Object.fromEntries(reg.parts.map(p => [p.id, p]));
      for (const [id, l] of Object.entries(labels)) { if (!byId[id]) throw new Bad('Unknown part ' + id); byId[id].label = String(l).trim(); }
      if (family !== undefined) {
        const fits = t => family === 'satdiver' ? ['diver', 'gmt'].includes(t) : t === family;   // Diver: dive inserts only, GMT: 24-hour only
        const ok = [...new Set(offered)].filter(id => byId[id] && byId[id].cat === 'bezels' && fits(byId[id].type));
        if (!ok.length) throw new Bad('None of those inserts fit this family');
        if (family === 'satdiver') { (fam.satdiver.pick = fam.satdiver.pick || {}).bezels = ok; }
        else {
          const inserts = reg.parts.filter(p => p.cat === 'bezels' && ['diver', 'gmt'].includes(p.type));
          for (const p of inserts) {
            const has = (p.families || []).includes(family), want = ok.includes(p.id);
            if (want && !has) p.families = [...(p.families || []), family];
            if (!want && has) p.families = p.families.filter(f => f !== family);
          }
          // put the offered inserts in the requested order (they keep the same slots in the list)
          const slots = []; reg.parts.forEach((p, i) => { if (ok.includes(p.id)) slots.push(i); });
          const ordered = ok.map(id => byId[id]); slots.forEach((slot, k) => { reg.parts[slot] = ordered[k]; });
        }
      }
    }, `Builder: ${family ? 'update ' + family + ' inserts' : ''}${family && Object.keys(labels).length ? ' + ' : ''}${Object.keys(labels).length ? Object.keys(labels).length + ' name change(s)' : ''} (from admin)`);
    res.json({ success: true, commit: sha });
  } catch (err) {
    console.error(err);
    res.status(err instanceof Bad ? 400 : 500).json({ error: err.message || 'Could not save' });
  }
});


// ── INQUIRY ENDPOINT ──────────────────────────────────────────────────────────

app.post('/inquiry', async (req, res) => {
  const { firstName, lastName, email, phone, watchFamily, buildSummary, notes, isOrder } = req.body;
  // picture of the customer's design (JPEG from the builder); attached to the email when present and sane
  let designAttachment = null;
  if (typeof req.body.designImage === 'string' && req.body.designImage.length < 4 * 1024 * 1024) {
    const img = Buffer.from(req.body.designImage, 'base64');
    if (img.length > 1000 && img[0] === 0xff && img[1] === 0xd8) designAttachment = { filename: `martin-design-${String(lastName || firstName || 'customer').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 30)}.jpg`, content: img };
  }

  if (!firstName || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  try {
    await pool.query(
      `INSERT INTO inquiries (first_name, last_name, email, phone, watch_family, build_summary, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [firstName, lastName, email, phone, watchFamily, buildSummary, notes]
    );

    await resend.emails.send({
      from: 'Martin Watches <onboarding@resend.dev>',
      to: process.env.NOTIFY_EMAIL,
      subject: isOrder ? `You have a new online order! — ${firstName} ${lastName}` : `You have a new online inquiry! — ${firstName} ${lastName}`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e8d8c0; padding: 40px;">
          <h1 style="font-size: 28px; font-weight: 300; letter-spacing: 0.2em; color: #C9A84C; margin-bottom: 8px;">MARTIN</h1>
          <p style="font-size: 11px; letter-spacing: 0.3em; color: #666; text-transform: uppercase; margin-bottom: 32px;">New ${isOrder ? 'Order' : 'Inquiry'} Received</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #222; color: #888; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; width: 35%;">Name</td><td style="padding: 10px 0; border-bottom: 1px solid #222; color: #e8d8c0;">${firstName} ${lastName}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #222; color: #888; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;">Email</td><td style="padding: 10px 0; border-bottom: 1px solid #222; color: #C9A84C;">${email}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #222; color: #888; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;">Phone</td><td style="padding: 10px 0; border-bottom: 1px solid #222; color: #e8d8c0;">${phone || '—'}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #222; color: #888; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;">Watch Family</td><td style="padding: 10px 0; border-bottom: 1px solid #222; color: #e8d8c0;">${watchFamily || '—'}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #222; color: #888; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;">Build</td><td style="padding: 10px 0; border-bottom: 1px solid #222; color: #e8d8c0; font-size: 13px;">${buildSummary || '—'}</td></tr>
            <tr><td style="padding: 10px 0; color: #888; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;">Notes</td><td style="padding: 10px 0; color: #e8d8c0;">${notes || '—'}</td></tr>
          </table>
          ${designAttachment ? '<p style="margin-top: 24px; font-size: 12px; color: #C9A84C;">A picture of the customer&#39;s design is attached.</p>' : ''}
          <p style="margin-top: 40px; font-size: 10px; letter-spacing: 0.2em; color: #333; text-transform: uppercase;">Martin Watch Co. &nbsp;·&nbsp; Crosby, TX</p>
        </div>
      `,
      ...(designAttachment ? { attachments: [designAttachment] } : {})
    });

    res.json({ success: true, message: 'Inquiry received' });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ── DISCOUNT CODES ────────────────────────────────────────────────────────────

app.get('/discount-codes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM discount_codes ORDER BY code');
    res.json(result.rows);
  } catch(err) {
    res.status(500).json({ error: 'Could not load discount codes' });
  }
});

app.post('/discount-codes', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { codes } = req.body;
  if (!Array.isArray(codes)) return res.status(400).json({ error: 'Invalid codes' });
  try {
    await pool.query('DELETE FROM discount_codes');
    for (const c of codes) {
      if (!c.code || !c.code.trim()) continue;
      await pool.query(
        `INSERT INTO discount_codes (code, discount_type, discount_value, active)
         VALUES ($1, $2, $3, $4)`,
        [c.code.trim().toUpperCase(), c.type, parseFloat(c.value), c.active !== false]
      );
    }
    res.json({ success: true });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save discount codes' });
  }
});

// ── PRICES (component-level, legacy) ─────────────────────────────────────────

app.get('/prices', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, price FROM prices');
    const prices = {};
    result.rows.forEach(r => prices[r.id] = r.price);
    res.json(prices);
  } catch(err) {
    res.status(500).json({ error: 'Could not load prices' });
  }
});

app.post('/prices', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { prices } = req.body;
  if (!prices || typeof prices !== 'object') {
    return res.status(400).json({ error: 'Invalid prices' });
  }
  try {
    for (const [id, price] of Object.entries(prices)) {
      await pool.query(
        `INSERT INTO prices (id, price) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET price = $2`,
        [id, parseInt(price)]
      );
    }
    res.json({ success: true });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save prices' });
  }
});

// ── HERO SLIDES ───────────────────────────────────────────────────────────────
let heroSlides = [];

app.get('/hero-slides', (req, res) => {
  res.json(heroSlides);
});

app.post('/hero-slides', (req, res) => {
  if (!checkAdmin(req, res)) return;
  heroSlides = req.body.slides || [];
  res.json({ success: true });
});

app.get('/inquiries', async (req, res) => {
  if (req.headers['x-api-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await pool.query('SELECT * FROM inquiries ORDER BY submitted_at DESC');
  res.json(result.rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDB();
  console.log(`Martin Watches API running on port ${PORT}`);
});
