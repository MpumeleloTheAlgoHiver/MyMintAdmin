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
`;

let _setupDone = false;
async function ensureSetup() {
  if (_setupDone) return;
  await pool().query(SETUP_SQL);
  _setupDone = true;
}

/**
 * Save a completed (or failed) extraction run.
 */
async function saveRun(data) {
  await ensureSetup();
  const { rows } = await pool().query(
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
  return rows[0];
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
      COUNT(*)                                   AS total_runs,
      COALESCE(SUM(records), 0)                 AS total_records,
      COALESCE(SUM(total_net_cash), 0)          AS total_net_cash,
      COUNT(*) FILTER (WHERE status = 'success') AS successful_runs,
      MAX(created_at)                            AS last_run_at
    FROM dividend_runs
  `);
  return rows[0];
}

module.exports = { saveRun, getRuns, getStats };
