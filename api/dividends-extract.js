'use strict';

const Busboy = require('busboy');
const XLSX   = require('xlsx');
const { saveRun } = require('./dividends-db');

/**
 * POST /api/dividends/extract
 * multipart/form-data:
 *   file     — .xlsx file
 *   password — Computershare password ('' if none)
 *   date     — YYYY-MM-DD effective payment date
 */
module.exports = async function dividendsExtractHandler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  }

  const ct = req.headers['content-type'] || '';
  if (!ct.includes('multipart/form-data')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Expected multipart/form-data' }));
  }

  let fileBuffer = null;
  let fileName   = 'upload.xlsx';
  let password   = '';
  let paymentDate = '';

  try {
    await new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers });
      bb.on('field', (name, val) => {
        if (name === 'password')    password    = val;
        if (name === 'date')        paymentDate = val;
        if (name === 'filename')    fileName    = val;
      });
      bb.on('file', (_field, stream, info) => {
        if (info && info.filename) fileName = info.filename;
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
    return res.end(JSON.stringify({ ok: false, error: `Upload parse failed: ${err.message}` }));
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'No file received' }));
  }

  // ── Parse workbook ──────────────────────────────────────────────────────────
  let workbook;
  try {
    const opts = { type: 'buffer' };
    if (password) opts.password = password;
    workbook = XLSX.read(fileBuffer, opts);
  } catch (err) {
    const msg = err.message || '';
    const isAuth = /password|decrypt|encrypt|cfb|protected/i.test(msg);
    const userMsg = isAuth
      ? 'Decryption failed. Please verify the Computershare password.'
      : `File could not be parsed: ${msg}`;

    // Save failed run
    try { await saveRun({ file_name: fileName, payment_date: paymentDate || null, records: 0, status: 'error', error_message: userMsg }); } catch (_) {}

    res.writeHead(422, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: userMsg }));
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
    return res.end(JSON.stringify({ ok: false, error: 'Sheet is empty or has no data rows' }));
  }

  const headers = Object.keys(rows[0]);

  // ── Detect net cash column ─────────────────────────────────────────────────
  const NET_PATTERNS = [/net\s*cash/i, /net_cash/i, /nett\s*cash/i, /amount/i, /payout/i, /dividend/i];
  const netCashCol = headers.find((h) => NET_PATTERNS.some((p) => p.test(h))) || null;

  let totalNetCash = 0;
  if (netCashCol) {
    for (const row of rows) {
      const raw = row[netCashCol];
      const n   = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
      if (!isNaN(n)) totalNetCash += n;
    }
  }
  totalNetCash = Math.round(totalNetCash * 100) / 100;

  // ── Detect unmatched security codes ────────────────────────────────────────
  const SEC_PATTERNS = [/security\s*code/i, /isin/i, /ticker/i, /symbol/i, /code/i];
  const secCol = headers.find((h) => SEC_PATTERNS.some((p) => p.test(h))) || null;
  let unmatchedCount = 0;
  if (secCol) {
    const codes = [...new Set(rows.map((r) => String(r[secCol]).trim()).filter(Boolean))];
    unmatchedCount = codes.filter((c) => !/^[A-Z0-9]{4,12}$/i.test(c)).length;
  }

  // ── Preview rows (first 20) ─────────────────────────────────────────────────
  const previewRows = rows.slice(0, 20);

  // ── Save to DB ─────────────────────────────────────────────────────────────
  let savedRun = null;
  try {
    savedRun = await saveRun({
      file_name:       fileName,
      payment_date:    paymentDate || null,
      records:         rows.length,
      total_net_cash:  totalNetCash,
      unmatched_count: unmatchedCount,
      net_cash_col:    netCashCol,
      sheet_names:     sheetNames,
      headers,
      status:          'success',
    });
  } catch (dbErr) {
    console.error('[dividends-extract] DB save failed:', dbErr.message);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok:             true,
    records:        rows.length,
    totalNetCash,
    unmatchedCount,
    sheetNames,
    headers,
    netCashCol,
    paymentDate:    paymentDate || null,
    previewRows,
    runId:          savedRun?.id || null,
  }));
};
