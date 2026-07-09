'use strict';

const { Pool } = require('pg');
const XLSX = require('xlsx');
const path = require('path');

let _pool = null;
function pool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase.com')
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return _pool;
}

const SETUP_SQL = `
  CREATE TABLE IF NOT EXISTS alliance_news_codes (
    id                SERIAL PRIMARY KEY,
    category          TEXT,
    region            TEXT,
    public_identifier TEXT,
    parent_code       TEXT,
    child_code_1      TEXT,
    child_code_2      TEXT,
    child_code_3      TEXT,
    description       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_alliance_news_codes_category ON alliance_news_codes(category);
  CREATE INDEX IF NOT EXISTS idx_alliance_news_codes_parent   ON alliance_news_codes(parent_code);
`;

let _setupDone = false;
async function ensureSetup() {
  if (_setupDone) return;
  await pool().query(SETUP_SQL);
  _setupDone = true;
}

function parseExcelData() {
  const excelPath = path.join(__dirname, '..', 'attached_assets', 'Alliance_News_code_structure_1783545932491.xlsx');
  const wb = XLSX.readFile(excelPath);
  const ws = wb.Sheets['Sheet1'];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const CATEGORY_HEADERS = new Set([
    'Product', 'Significance', 'Content Type', 'Ticker',
    'Companies', 'Markets', 'Economics', 'Index', 'Industry', 'Geography', 'Fixture',
  ]);

  const records = [];
  let currentCategory = null;

  for (const row of raw) {
    if (!row || !row.some(c => c != null && String(c).trim() !== '')) continue;

    const [col0, col1, col2, col3, col4, col5, col6] = row;
    const s0 = col0 != null ? String(col0).trim() : null;

    // Skip the spreadsheet column-header row (first non-empty row)
    if (s0 === 'Category' && col1 && String(col1).includes('Identifier')) continue;

    // Section header row
    if (s0 && CATEGORY_HEADERS.has(s0)) {
      currentCategory = s0;
      continue;
    }

    const region            = (s0 && !CATEGORY_HEADERS.has(s0)) ? s0 : null;
    const public_identifier = col1 != null ? String(col1).trim() : null;
    const parent_code       = col2 != null ? String(col2).trim() : null;
    const child_code_1      = col3 != null && col3 !== 1 ? String(col3).trim() : null;
    const child_code_2      = col4 != null && col4 !== 1 ? String(col4).trim() : null;
    const child_code_3      = col5 != null && col5 !== 1 ? String(col5).trim() : null;
    const description       = col6 != null && col6 !== 1 ? String(col6).trim() : null;

    if (public_identifier || parent_code || child_code_1 || child_code_2 || child_code_3) {
      records.push({
        category: currentCategory,
        region,
        public_identifier,
        parent_code,
        child_code_1,
        child_code_2,
        child_code_3,
        description,
      });
    }
  }

  return records;
}

async function importCodes(force = false) {
  await ensureSetup();

  if (!force) {
    const { rows } = await pool().query('SELECT COUNT(*) AS cnt FROM alliance_news_codes');
    if (Number(rows[0].cnt) > 0) {
      return { skipped: true, count: Number(rows[0].cnt) };
    }
  } else {
    await pool().query('TRUNCATE alliance_news_codes RESTART IDENTITY');
  }

  const records = parseExcelData();
  if (!records.length) return { imported: 0 };

  const chunk = 50;
  for (let i = 0; i < records.length; i += chunk) {
    const batch = records.slice(i, i + chunk);
    const placeholders = [];
    const vals = [];
    let pi = 1;
    for (const r of batch) {
      placeholders.push(`($${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++})`);
      vals.push(r.category, r.region, r.public_identifier, r.parent_code,
                r.child_code_1, r.child_code_2, r.child_code_3, r.description);
    }
    await pool().query(
      `INSERT INTO alliance_news_codes
         (category,region,public_identifier,parent_code,child_code_1,child_code_2,child_code_3,description)
       VALUES ${placeholders.join(',')}`,
      vals
    );
  }

  return { imported: records.length };
}

async function getCodes(filter = {}) {
  await ensureSetup();
  let q = 'SELECT * FROM alliance_news_codes WHERE 1=1';
  const vals = [];
  let pi = 1;
  if (filter.category) { q += ` AND category = $${pi++}`;          vals.push(filter.category); }
  if (filter.region)   { q += ` AND region = $${pi++}`;             vals.push(filter.region); }
  if (filter.search)   { q += ` AND (public_identifier ILIKE $${pi} OR description ILIKE $${pi} OR parent_code ILIKE $${pi} OR child_code_1 ILIKE $${pi} OR child_code_2 ILIKE $${pi} OR child_code_3 ILIKE $${pi})`; vals.push('%' + filter.search + '%'); pi++; }
  q += ' ORDER BY id';
  if (filter.limit) { q += ` LIMIT $${pi++}`; vals.push(filter.limit); }
  const { rows } = await pool().query(q, vals);
  return rows;
}

async function getCategories() {
  await ensureSetup();
  const { rows } = await pool().query(
    `SELECT DISTINCT category FROM alliance_news_codes WHERE category IS NOT NULL ORDER BY category`
  );
  return rows.map(r => r.category);
}

module.exports = { importCodes, getCodes, getCategories, ensureSetup };
