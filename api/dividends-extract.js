'use strict';

const Busboy = require('busboy');
const XLSX   = require('xlsx');

/**
 * POST /api/dividends/extract
 * Accepts multipart/form-data with:
 *   file     — the .xlsx file
 *   password — the Computershare report password (optional, send '' if none)
 *   date     — effective payment date (YYYY-MM-DD) for record keeping
 *
 * Returns JSON:
 *   { ok: true, records, totalNetCash, unmatchedCount, sheetNames, headers }
 * or
 *   { ok: false, error: string }
 */
module.exports = async function dividendsExtractHandler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Expected multipart/form-data' }));
  }

  let fileBuffer = null;
  let password   = '';
  let paymentDate = '';

  try {
    await new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers });

      bb.on('field', (name, val) => {
        if (name === 'password')    password    = val;
        if (name === 'date')        paymentDate = val;
      });

      bb.on('file', (_fieldname, stream, _info) => {
        const chunks = [];
        stream.on('data',  (d) => chunks.push(d));
        stream.on('end',   ()  => { fileBuffer = Buffer.concat(chunks); });
        stream.on('error', reject);
      });

      bb.on('finish', resolve);
      bb.on('error',  reject);
      req.pipe(bb);
    });
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: `Upload parsing failed: ${err.message}` }));
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'No file received' }));
  }

  let workbook;
  try {
    const readOpts = { type: 'buffer' };
    if (password) readOpts.password = password;
    workbook = XLSX.read(fileBuffer, readOpts);
  } catch (err) {
    const msg = err.message || '';
    const isPasswordError = msg.toLowerCase().includes('password') ||
                            msg.toLowerCase().includes('decrypt') ||
                            msg.toLowerCase().includes('cfb') ||
                            msg.toLowerCase().includes('encrypted');
    res.writeHead(422, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: false,
      error: isPasswordError
        ? 'Decryption failed. Please verify the Computershare password.'
        : `File could not be parsed: ${msg}`
    }));
  }

  const sheetNames = workbook.SheetNames;
  if (!sheetNames.length) {
    res.writeHead(422, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Workbook contains no sheets' }));
  }

  const sheet = workbook.Sheets[sheetNames[0]];
  const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (!rows.length) {
    res.writeHead(422, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: "Sheet is empty or has no data rows" }));
  }

  const headers = Object.keys(rows[0]);

  // ── Detect "net cash" column ───────────────────────────────────────────────
  // Try common column name patterns case-insensitively.
  const NET_CASH_PATTERNS = [/net\s*cash/i, /net_cash/i, /nett\s*cash/i, /amount/i, /payout/i, /dividend/i];
  const netCashCol = headers.find((h) => NET_CASH_PATTERNS.some((p) => p.test(h)));

  let totalNetCash = 0;
  if (netCashCol) {
    for (const row of rows) {
      const raw = row[netCashCol];
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
      if (!isNaN(num)) totalNetCash += num;
    }
  }

  // ── Detect unmatched security codes ───────────────────────────────────────
  // Look for a "security code" / ISIN / ticker column
  const SEC_CODE_PATTERNS = [/security\s*code/i, /isin/i, /ticker/i, /symbol/i, /code/i];
  const secCol = headers.find((h) => SEC_CODE_PATTERNS.some((p) => p.test(h)));

  let unmatchedCount = 0;
  if (secCol) {
    const codes = [...new Set(rows.map((r) => String(r[secCol]).trim()).filter(Boolean))];
    // Flag codes that look non-standard (not 4–12 alpha-numeric chars) as unmatched
    unmatchedCount = codes.filter((c) => !/^[A-Z0-9]{4,12}$/i.test(c)).length;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok:             true,
    records:        rows.length,
    totalNetCash:   Math.round(totalNetCash * 100) / 100,
    unmatchedCount,
    sheetNames,
    headers,
    netCashCol:     netCashCol || null,
    paymentDate:    paymentDate || null
  }));
};
