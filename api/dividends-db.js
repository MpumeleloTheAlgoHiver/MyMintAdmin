'use strict';

const { Pool } = require('pg');

let _pool = null;
function pool() {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

const SETUP_SQL = `
  CREATE TABLE IF NOT EXISTS dividend_runs (
    id            SERIAL PRIMARY KEY,
    file_name     TEXT        NOT NULL,
    payment_date  DATE,
    records       INTEGER     NOT NULL DEFAULT 0,
    total_net_cash NUMERIC(18,2),
    unmatched_count INTEGER   DEFAULT 0,
    net_cash_col  TEXT,
    sheet_names   TEXT[],
    headers       TEXT[],
    status        TEXT        NOT NULL DEFAULT 'success',
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS dividend_payouts_staging (
    id            SERIAL PRIMARY KEY,
    run_id        INTEGER REFERENCES dividend_runs(id) ON DELETE CASCADE,
    security_code TEXT,
    net_cash      NUMERIC(18,2),
    raw_row       JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

let _setupDone = false;
async function ensureSetup() {
  if (_setupDone) return;
  await pool().query(SETUP_SQL);
  _setupDone = true;
}

/**
 * Save a completed (or failed) extraction run and stage the parsed rows.
 * @param {object} data - run metadata
 * @param {Array}  extractedRows - array of { security_code, net_cash, raw_row }
 */
async function saveRun(data, extractedRows = []) {
  await ensureSetup();

  // 1. Save run metadata
  const runResult = await pool().query(
    `INSERT INTO dividend_runs
       (file_name, payment_date, records, total_net_cash, unmatched_count,
        net_cash_col, sheet_names, headers, status, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      data.file_name     || 'unknown.xlsx',
      data.payment_date  || null,
      data.records       || 0,
      data.total_net_cash != null ? data.total_net_cash : null,
      data.unmatched_count != null ? data.unmatched_count : null,
      data.net_cash_col  || null,
      data.sheet_names   || null,
      data.headers       || null,
      data.status        || 'success',
      data.error_message || null,
    ]
  );

  const runRecord = runResult.rows[0];

  // 2. Bulk insert staging rows
  if (data.status === 'success' && extractedRows.length > 0) {
    const placeholders = [];
    const vals = [];
    let paramIndex = 1;

    for (const row of extractedRows) {
      placeholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
      vals.push(
        runRecord.id,
        row.security_code || null,
        row.net_cash,
        JSON.stringify(row.raw_row) // preserve original row for shifting-column safety
      );
    }

    await pool().query(
      `INSERT INTO dividend_payouts_staging (run_id, security_code, net_cash, raw_row)
       VALUES ${placeholders.join(',')}`,
      vals
    );
  }

  return runRecord;
}

/**
 * Fetch the N most recent runs.
 */
async function getRuns(limit = 50) {
  await ensureSetup();
  const { rows } = await pool().query(
    `SELECT * FROM dividend_runs ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

/**
 * Aggregate stats across all runs.
 */
async function getStats() {
  await ensureSetup();
  const { rows } = await pool().query(`
    SELECT
      COUNT(*)                                     AS total_runs,
      COALESCE(SUM(records), 0)                 AS total_records,
      COALESCE(SUM(total_net_cash), 0)          AS total_net_cash,
      COUNT(*) FILTER (WHERE status = 'success') AS successful_runs,
      MAX(created_at)                            AS last_run_at
    FROM dividend_runs
  `);
  return rows[0];
}

/**
 * Fetch staged payout rows for a specific run.
 */
async function getPayouts(runId, limit = 2000) {
  await ensureSetup();
  const { rows } = await pool().query(
    `SELECT id, security_code, net_cash, raw_row, created_at
     FROM dividend_payouts_staging
     WHERE run_id = $1
     ORDER BY id
     LIMIT $2`,
    [runId, limit]
  );
  return rows;
}

module.exports = { saveRun, getRuns, getStats, getPayouts };
