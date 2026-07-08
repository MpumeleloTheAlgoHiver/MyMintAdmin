'use strict';

const Busboy = require('busboy');
const XLSX   = require('xlsx');
const { OfficeFile, DecryptionError, FileFormatError } = require('office-crypto');
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
      const bb = Busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024 } });
      const fields = {};

      bb.on('field', (name, val) => { fields[name] = val; });

      bb.on('file', (_field, fileStream, info) => {
        if (info && info.filename) fileName = info.filename;
        const chunks = [];
        fileStream.on('data',  (d) => chunks.push(d));
        fileStream.on('end',   ()  => { fileBuffer = Buffer.concat(chunks); });
        fileStream.on('error', reject);
      });

      bb.on('finish', () => {
        if (fields.password != null) password    = fields.password;
        if (fields.date     != null) paymentDate = fields.date;
        if (fields.filename != null) fileName    = fields.filename;
        resolve();
      });
      bb.on('error', reject);
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

  // ── 1. Decrypt if password-protected ───────────────────────────────────────
  let parseBuffer = fileBuffer;

  if (password) {
    try {
      const officeFile = OfficeFile(new Uint8Array(fileBuffer));
      officeFile.loadKey({ password });
      const decrypted = officeFile.decrypt();
      parseBuffer = Buffer.from(decrypted);
    } catch (err) {
      const isWrongPwd = err instanceof DecryptionError || /password|key|verify|invalid/i.test(err.message || '');
      const userMsg = isWrongPwd
        ? 'Decryption failed. Please verify the Computershare password.'
        : `Could not decrypt file: ${err.message}`;
      try { await saveRun({ file_name: fileName, payment_date: paymentDate || null, records: 0, status: 'error', error_message: userMsg }, []); } catch (_) {}
      res.writeHead(422, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: userMsg }));
    }
  }

  // ── 2. Parse Workbook ───────────────────────────────────────────────────────
  let workbook;
  try {
    workbook = XLSX.read(parseBuffer, { type: 'buffer' });
  } catch (err) {
    const userMsg = `File could not be parsed: ${err.message}`;
    try { await saveRun({ file_name: fileName, payment_date: paymentDate || null, records: 0, status: 'error', error_message: userMsg }, []); } catch (_) {}
    res.writeHead(422, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: userMsg }));
  }

  const sheetNames = workbook.SheetNames;
  if (!sheetNames.length) {
    res.writeHead(422, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Workbook contains no sheets' }));
  }

  const sheet = workbook.Sheets[sheetNames[0]];

  // ── 3. Hunt for the real header row ────────────────────────────────────────
  // Computershare files have a title row at the top (e.g. "COMPUTERSHARE (PTY) LTD"),
  // so blindly reading row 0 as headers gives __EMPTY columns and misses all data.
  // Scan the raw 2-D array for the first row that looks like actual column headers.
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(rawData.length, 20); i++) {
    const rowStr = rawData[i].join(' ').toUpperCase();
    if (rowStr.includes('CLIENT') && (rowStr.includes('CODE') || rowStr.includes('CASH'))) {
      headerRowIndex = i;
      break;
    }
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { range: headerRowIndex, defval: '' });

  if (!rows.length) {
    res.writeHead(422, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Sheet is empty or has no data rows' }));
  }

  const headers = Object.keys(rows[0]);

  // ── 4. Detect columns ───────────────────────────────────────────────────────
  const NET_PATTERNS = [/net\s*cash/i, /net_cash/i, /nett\s*cash/i, /amount/i, /payout/i, /dividend/i];
  const netCashCol = headers.find((h) => NET_PATTERNS.some((p) => p.test(h))) || null;

  const SEC_PATTERNS = [/security\s*code/i, /isin/i, /ticker/i, /symbol/i, /code/i, /jse/i];
  const secCol = headers.find((h) => SEC_PATTERNS.some((p) => p.test(h))) || null;

  // ── 5. Extract & sanitize rows ──────────────────────────────────────────────
  /**
   * Parse South African localised currency strings into a float.
   * Handles: numbers, "R 1 500,50", "1500.50", "1,500.50", "1 500,50"
   */
  function parseSaAmount(raw) {
    if (typeof raw === 'number') return raw;
    if (raw == null || raw === '') return NaN;
    let s = String(raw).replace(/R|\s/gi, ''); // strip "R" and spaces
    if (s.includes(',') && !s.includes('.')) {
      s = s.replace(',', '.');          // "1500,50" → "1500.50"
    } else if (s.includes(',') && s.includes('.')) {
      s = s.replace(/,/g, '');          // "1,500.50" → "1500.50"
    }
    return parseFloat(s);
  }

  let totalNetCash = 0;
  let unmatchedCount = 0;
  const extractedRows = [];

  for (const row of rows) {
    // Skip TOTAL rows, footer/confidentiality notices, and completely empty rows
    const firstVal = String(row[headers[0]] ?? '').toUpperCase().trim();
    if (firstVal === '' || firstVal.includes('TOTAL') || firstVal.includes('CONFIDENTIAL')) continue;

    const n = netCashCol ? parseSaAmount(row[netCashCol]) : NaN;
    if (!isNaN(n)) totalNetCash += n;

    const secCode = secCol ? String(row[secCol]).trim() : '';
    if (!secCode || !/^[A-Z0-9]{3,12}$/i.test(secCode)) unmatchedCount++;

    extractedRows.push({
      security_code: secCode,
      net_cash:      isNaN(n) ? 0 : n,
      raw_row:       row,
    });
  }

  totalNetCash = Math.round(totalNetCash * 100) / 100;
  const previewRows = rows.slice(0, 20);

  // ── 4. Save metadata + staging rows ─────────────────────────────────────────
  let savedRun = null;
  try {
    savedRun = await saveRun({
      file_name:       fileName,
      payment_date:    paymentDate || null,
      records:         extractedRows.length,
      total_net_cash:  totalNetCash,
      unmatched_count: unmatchedCount,
      net_cash_col:    netCashCol,
      sheet_names:     sheetNames,
      headers,
      status:          'success',
    }, extractedRows);
  } catch (dbErr) {
    console.error('[dividends-extract] DB save failed:', dbErr.message);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok:             true,
    records:        extractedRows.length,
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
