'use strict';

// Supabase REST API access (same pattern as _team.js) — replaces the raw
// Postgres pool. Avoids DATABASE_URL / SSL / network issues entirely and
// keeps everything on the same Supabase project as the rest of the app.

const XLSX = require('xlsx');
const path = require('path');

function getSupabaseCreds() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase credentials not configured');
  return { supabaseUrl, serviceRoleKey };
}

async function sbFetch(pathAndQuery, { method = 'GET', body, headers = {} } = {}) {
  const { supabaseUrl, serviceRoleKey } = getSupabaseCreds();
  const res = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase REST ${method} ${pathAndQuery} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
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
  if (!force) {
    const rows = await sbFetch('alliance_news_codes?select=id&limit=1');
    if (Array.isArray(rows) && rows.length > 0) {
      const countRows = await sbFetch('alliance_news_codes?select=id');
      return { skipped: true, count: countRows.length };
    }
  } else {
    // Delete all existing rows
    await sbFetch('alliance_news_codes?id=gte.0', { method: 'DELETE' });
  }

  const records = parseExcelData();
  if (!records.length) return { imported: 0 };

  const chunk = 200;
  for (let i = 0; i < records.length; i += chunk) {
    const batch = records.slice(i, i + chunk);
    await sbFetch('alliance_news_codes', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: batch,
    });
  }

  return { imported: records.length };
}

async function getCodes(filter = {}) {
  const params = ['select=*'];
  if (filter.category) params.push(`category=eq.${encodeURIComponent(filter.category)}`);
  if (filter.region)   params.push(`region=eq.${encodeURIComponent(filter.region)}`);
  if (filter.search) {
    const term = `*${filter.search}*`;
    const cols = ['public_identifier', 'description', 'parent_code', 'child_code_1', 'child_code_2', 'child_code_3'];
    const orExpr = cols.map(c => `${c}.ilike.${term}`).join(',');
    params.push(`or=(${encodeURIComponent(orExpr)})`);
  }
  params.push('order=id.asc');
  if (filter.limit) params.push(`limit=${filter.limit}`);
  return sbFetch(`alliance_news_codes?${params.join('&')}`);
}

async function getCategories() {
  const rows = await sbFetch('alliance_news_codes?select=category&category=not.is.null&order=category.asc');
  return [...new Set(rows.map(r => r.category))];
}

async function ensureSetup() {
  // Tables are created once via the setup SQL script run in the Supabase
  // SQL editor (see sql/ directory) — the REST API cannot create tables.
  return Promise.resolve();
}

module.exports = { importCodes, getCodes, getCategories, ensureSetup };
