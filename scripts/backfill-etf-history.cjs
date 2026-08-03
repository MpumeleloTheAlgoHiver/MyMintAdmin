'use strict';

const XLSX = require('xlsx');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };

const TODAY = new Date().toISOString().substring(0, 10);
const CHUNK = 500;
const DELAY = 300;

// ── Build the list of 130 new ETF symbols from the spreadsheet ────────────────
function getSpreadsheetSymbols() {
  const wb = XLSX.readFile('attached_assets/New_ETF_List_1785755747591.xlsx');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const symbols = [];
  for (const row of rows) {
    const alpha = row[0], name = row[1];
    if (alpha && name && typeof alpha === 'string' && alpha === alpha.toUpperCase()
        && !alpha.includes(' ') && alpha.length <= 10) {
      symbols.push(alpha + '.JO');
    }
  }
  return symbols;
}

async function fetchHistory(symbol) {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=max`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result) return null;
    const timestamps = result.timestamp || [];
    const closes    = result.indicators?.quote?.[0]?.close || [];
    const rows = [];
    for (let i = 0; i < timestamps.length; i++) {
      const price = closes[i];
      if (!price || price <= 0) continue;
      const date = new Date(timestamps[i] * 1000).toISOString().substring(0, 10);
      if (date === TODAY) continue;   // already seeded as anchor
      rows.push({ date, price: Math.round(price) });
    }
    return rows;
  } catch { return null; }
}

async function upsertRows(rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await fetch(url + '/rest/v1/stock_returns_c?on_conflict=symbol,as_of_date', {
      method: 'POST',
      headers: { ...h, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error('DB upsert failed: ' + t.substring(0, 200));
    }
  }
}

async function main() {
  // 1. Get the 140 ETF symbols from spreadsheet
  const spreadsheetSymbols = getSpreadsheetSymbols();
  console.log('Spreadsheet ETFs:', spreadsheetSymbols.length);

  // 2. Resolve security IDs for all of them from the DB
  const symList = spreadsheetSymbols.join(',');
  const secRes = await fetch(url + '/rest/v1/securities_c?symbol=in.(' + symList + ')&select=id,symbol', { headers: h });
  const securities = await secRes.json();
  const secMap = Object.fromEntries(securities.map(s => [s.symbol, s.id]));
  console.log('Found in DB:', securities.length);

  // 3. Check which already have history beyond today's anchor
  const hasHistory = new Set();
  for (let i = 0; i < spreadsheetSymbols.length; i += 50) {
    const batch = spreadsheetSymbols.slice(i, i + 50);
    const r = await fetch(
      url + '/rest/v1/stock_returns_c?symbol=in.(' + batch.join(',') + ')&as_of_date=neq.' + TODAY + '&select=symbol&limit=1000',
      { headers: h }
    );
    const rows = await r.json();
    (rows || []).forEach(row => hasHistory.add(row.symbol));
  }
  console.log('Already have history:', hasHistory.size);

  const toBackfill = spreadsheetSymbols.filter(s => !hasHistory.has(s));
  console.log('To backfill:', toBackfill.length);

  let done = 0, skipped = 0, totalRows = 0;

  for (const symbol of toBackfill) {
    const secId = secMap[symbol];
    if (!secId) { process.stdout.write('?'); skipped++; continue; }

    try {
      const history = await fetchHistory(symbol);
      if (!history || history.length === 0) {
        process.stdout.write('0');
        skipped++;
        await new Promise(r => setTimeout(r, DELAY));
        continue;
      }

      // Deduplicate by date — Yahoo sometimes returns the same date twice
      const seen = new Map();
      for (const row of history) seen.set(row.date, row.price);
      const dbRows = Array.from(seen.entries()).map(([date, price]) => ({
        security_id:   secId,
        symbol:        symbol,
        as_of_date:    date,
        current_price: price,
      }));

      await upsertRows(dbRows);
      totalRows += dbRows.length;
      done++;
      process.stdout.write('.');
    } catch (err) {
      process.stdout.write('E');
      console.error(`\n[ERROR] ${symbol}: ${err.message}`);
      skipped++;
    }
    await new Promise(r => setTimeout(r, DELAY));
  }

  console.log(`\n\n=== DONE ===`);
  console.log(`Backfilled: ${done} | Skipped/no-data: ${skipped} | Total rows inserted: ${totalRows}`);

  // Spot-check 5
  const samples = toBackfill.slice(0, 5);
  for (const sym of samples) {
    const r = await fetch(url + `/rest/v1/stock_returns_c?symbol=eq.${sym}&select=count`,
      { headers: { ...h, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' } });
    const count = r.headers.get('content-range');
    const r2 = await fetch(url + `/rest/v1/stock_returns_c?symbol=eq.${sym}&select=as_of_date&order=as_of_date.asc&limit=1`, { headers: h });
    const earliest = await r2.json();
    console.log(`  ${sym.padEnd(14)} rows: ${(count||'').split('/')[1]?.padStart(5)}  earliest: ${earliest[0]?.as_of_date || 'none'}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
