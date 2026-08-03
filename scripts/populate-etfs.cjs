'use strict';
const XLSX = require('xlsx');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };

const SECTOR_KEYS = [
  ['Top 40 Equity',        'Equity'],
  ['Other Local Equity',   'Equity'],
  ['International Equity', 'International Equity'],
  ['Commodity',            'Commodity'],
  ['Fixed Income',         'Fixed Income'],
  ['Currency',             'Currency'],
  ['Real Estate',          'Real Estate'],
  ['Multi Asset',          'Multi-Asset'],
  ['Actively Managed',     'Multi-Asset'],
];

async function fetchYahoo(symbol) {
  try {
    const r = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?interval=1d&range=5d',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const j = await r.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    return {
      last_price:     Math.round(meta.regularMarketPrice),
      change_percent: meta.regularMarketChangePercent ?? null,
      shortName:      meta.shortName || null,
    };
  } catch { return null; }
}

async function main() {
  // ── 1. Parse spreadsheet ─────────────────────────────────────────────────
  const wb = XLSX.readFile('attached_assets/New_ETF_List_1785755747591.xlsx');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

  let currentSector = 'Equity';
  const allTickers = [];
  for (const row of rows) {
    const alpha = row[0], name = row[1];
    if (alpha && (!name || String(name).trim() === '')) {
      for (const [k, v] of SECTOR_KEYS) {
        if (String(alpha).includes(k.split(' ')[0])) { currentSector = v; break; }
      }
      continue;
    }
    if (alpha && name && typeof alpha === 'string' && alpha === alpha.toUpperCase()
        && !alpha.includes(' ') && alpha.length <= 10) {
      allTickers.push({ ticker: alpha, symbol: alpha + '.JO', name: String(name).trim(), sector: currentSector });
    }
  }
  console.log('Spreadsheet tickers:', allTickers.length);

  // ── 2. Find which already exist ──────────────────────────────────────────
  const symList = allTickers.map(t => t.symbol).join(',');
  const existRes = await fetch(url + '/rest/v1/securities_c?symbol=in.(' + symList + ')&select=symbol', { headers: h });
  const existing = await existRes.json();
  const existingSet = new Set((existing || []).map(e => e.symbol));
  const toInsert = allTickers.filter(t => !existingSet.has(t.symbol));
  console.log('Already in DB:', existingSet.size, '| To insert:', toInsert.length);

  // ── 3. Fetch Yahoo prices in batches of 20 ───────────────────────────────
  const BATCH = 20;
  const yahooData = {};
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(t => fetchYahoo(t.symbol)));
    batch.forEach((t, idx) => { yahooData[t.symbol] = results[idx]; });
    process.stdout.write('.');
    if (i + BATCH < toInsert.length) await new Promise(r => setTimeout(r, 400));
  }
  console.log('\nYahoo fetched:', Object.values(yahooData).filter(Boolean).length + '/' + toInsert.length);

  // ── 4. Build insert rows ─────────────────────────────────────────────────
  const insertRows = toInsert.map(t => {
    const yf = yahooData[t.symbol] || {};
    return {
      symbol:         t.symbol,
      name:           yf.shortName || t.name,
      exchange:       'JSE',
      sector:         t.sector,
      is_active:      true,
      last_price:     yf.last_price || null,
      change_percent: yf.change_percent != null
                        ? Math.round(yf.change_percent * 10000) / 100
                        : null,
    };
  });

  // ── 5. Upsert into securities_c (in chunks of 50 to avoid payload limits) ─
  let allUpserted = [];
  const CHUNK = 50;
  for (let i = 0; i < insertRows.length; i += CHUNK) {
    const chunk = insertRows.slice(i, i + CHUNK);
    const res = await fetch(url + '/rest/v1/securities_c', {
      method: 'POST',
      headers: { ...h, 'Prefer': 'resolution=merge-duplicates,return=representation', 'on_conflict': 'symbol' },
      body: JSON.stringify(chunk),
    });
    const data = await res.json();
    if (!Array.isArray(data)) {
      console.error('Upsert chunk failed:', JSON.stringify(data).substring(0, 300));
      process.exit(1);
    }
    allUpserted = allUpserted.concat(data);
    process.stdout.write('+');
  }
  console.log('\nUpserted into securities_c:', allUpserted.length);

  // ── 6. Seed stock_returns_c with today's price ───────────────────────────
  const today = new Date().toISOString().substring(0, 10);
  const returnRows = allUpserted
    .filter(s => s.last_price != null)
    .map(s => ({
      security_id:   s.id,
      symbol:        s.symbol,
      as_of_date:    today,
      current_price: s.last_price,
    }));

  for (let i = 0; i < returnRows.length; i += CHUNK) {
    const chunk = returnRows.slice(i, i + CHUNK);
    const res = await fetch(url + '/rest/v1/stock_returns_c', {
      method: 'POST',
      headers: { ...h, 'Prefer': 'resolution=merge-duplicates,return=minimal', 'on_conflict': 'security_id,as_of_date' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('\nSeed chunk error:', t.substring(0, 300));
    }
    process.stdout.write('~');
  }
  console.log('\nstock_returns_c seeded:', returnRows.length, 'rows');

  // ── 7. Summary ───────────────────────────────────────────────────────────
  const withPrice = allUpserted.filter(s => s.last_price != null).length;
  const noPrice   = allUpserted.filter(s => s.last_price == null).length;
  console.log('\n=== DONE ===');
  console.log('Inserted:', allUpserted.length, '| With price:', withPrice, '| Missing price:', noPrice);
  if (noPrice > 0) console.log('No price:', allUpserted.filter(s => s.last_price == null).map(s => s.symbol).join(', '));
}

main().catch(err => { console.error(err); process.exit(1); });
