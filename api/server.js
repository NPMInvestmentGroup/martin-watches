const express = require('express');
const { Pool } = require('pg');
const { Resend } = require('resend');
const cors = require('cors');

const app = express();
app.use(express.json());
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-api-key']
}));

async function initDB() {
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

app.get('/', (req, res) => {
  res.json({ status: 'Martin Watches API running' });
});

app.post('/inquiry', async (req, res) => {
  const { firstName, lastName, email, phone, watchFamily, buildSummary, notes } = req.body;

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
      subject: `New Watch Inquiry — ${firstName} ${lastName}`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e8d8c0; padding: 40px;">
          <h1 style="font-size: 28px; font-weight: 300; letter-spacing: 0.2em; color: #C9A84C; margin-bottom: 8px;">MARTIN</h1>
          <p style="font-size: 11px; letter-spacing: 0.3em; color: #666; text-transform: uppercase; margin-bottom: 32px;">New Inquiry Received</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #222; color: #888; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; width: 35%;">Name</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #222; color: #e8d8c0;">${firstName} ${lastName}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #222; color: #888; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;">Email</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #222; color: #C9A84C;">${email}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #222; color: #888; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;">Phone</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #222; color: #e8d8c0;">${phone || '—'}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #222; color: #888; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;">Watch Family</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #222; color: #e8d8c0;">${watchFamily || '—'}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #222; color: #888; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;">Build</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #222; color: #e8d8c0; font-size: 13px;">${buildSummary || '—'}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; color: #888; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;">Notes</td>
              <td style="padding: 10px 0; color: #e8d8c0;">${notes || '—'}</td>
            </tr>
          </table>
          <p style="margin-top: 40px; font-size: 10px; letter-spacing: 0.2em; color: #333; text-transform: uppercase;">Martin Watch Co. &nbsp;·&nbsp; Houston, Texas</p>
        </div>
      `
    });

    res.json({ success: true, message: 'Inquiry received' });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
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
