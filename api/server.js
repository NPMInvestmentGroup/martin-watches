const express = require('express');
const { Pool } = require('pg');
const { Resend } = require('resend');
const cors = require('cors');

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
  allowedHeaders: ['Content-Type', 'x-api-key', 'x-admin-password']
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

function checkAdmin(req, res) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
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

// ── INQUIRY ENDPOINT ──────────────────────────────────────────────────────────

app.post('/inquiry', async (req, res) => {
  const { firstName, lastName, email, phone, watchFamily, buildSummary, notes, isOrder } = req.body;

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
          <p style="margin-top: 40px; font-size: 10px; letter-spacing: 0.2em; color: #333; text-transform: uppercase;">Martin Watch Co. &nbsp;·&nbsp; Huffman, TX</p>
        </div>
      `
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
