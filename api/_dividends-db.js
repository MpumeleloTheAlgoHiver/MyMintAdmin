'use strict';

// Supabase REST API access (same pattern as _team.js) — replaces the raw
// Postgres pool. Avoids DATABASE_URL / SSL / network issues entirely and
// keeps everything on the same Supabase project as the rest of the app.

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

/**
 * Save a completed (or failed) extraction run and stage the parsed rows.
 * @param {object} data - run metadata
 * @param {Array}  extractedRows - array of { security_code, net_cash, raw_row }
 */
async function saveRun(data, extractedRows = []) {
  // 1. Save run metadata
  const inserted = await sbFetch('dividend_runs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      file_name: data.file_name || 'unknown.xlsx',
      payment_date: data.payment_date || null,
      records: data.records || 0,
      total_net_cash: data.total_net_cash != null ? data.total_net_cash : null,
      unmatched_count: data.unmatched_count != null ? data.unmatched_count : null,
      net_cash_col: data.net_cash_col || null,
      sheet_names: data.sheet_names || null,
      headers: data.headers || null,
      status: data.status || 'success',
      error_message: data.error_message || null,
    },
  });
  const runRecord = Array.isArray(inserted) ? inserted[0] : inserted;

  // 2. Bulk insert staging rows
  if (data.status === 'success' && extractedRows.length > 0) {
    const rows = extractedRows.map((row) => ({
      run_id: runRecord.id,
      security_code: row.security_code || null,
      net_cash: row.net_cash,
      raw_row: row.raw_row, // preserve original row for shifting-column safety
    }));

    // Insert in chunks to keep request bodies reasonable
    const chunk = 200;
    for (let i = 0; i < rows.length; i += chunk) {
      await sbFetch('dividend_payouts_staging', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: rows.slice(i, i + chunk),
      });
    }
  }

  return runRecord;
}

/**
 * Fetch the N most recent runs.
 */
async function getRuns(limit = 50) {
  return sbFetch(`dividend_runs?select=*&order=created_at.desc&limit=${limit}`);
}

/**
 * Aggregate stats across all runs. Computed client-side since PostgREST
 * doesn't support arbitrary aggregate expressions like COUNT(*) FILTER(...).
 */
async function getStats() {
  const rows = await sbFetch('dividend_runs?select=records,total_net_cash,status,created_at');

  let total_records = 0;
  let total_net_cash = 0;
  let successful_runs = 0;
  let last_run_at = null;

  for (const r of rows) {
    total_records += Number(r.records) || 0;
    total_net_cash += Number(r.total_net_cash) || 0;
    if (r.status === 'success') successful_runs++;
    if (!last_run_at || (r.created_at && r.created_at > last_run_at)) last_run_at = r.created_at;
  }

  return {
    total_runs: String(rows.length),
    total_records: String(total_records),
    total_net_cash: String(total_net_cash),
    successful_runs: String(successful_runs),
    last_run_at,
  };
}

/**
 * Fetch staged payout rows for a specific run.
 */
async function getPayouts(runId, limit = 2000) {
  return sbFetch(
    `dividend_payouts_staging?select=id,security_code,net_cash,raw_row,created_at&run_id=eq.${runId}&order=id.asc&limit=${limit}`
  );
}

module.exports = { saveRun, getRuns, getStats, getPayouts };
