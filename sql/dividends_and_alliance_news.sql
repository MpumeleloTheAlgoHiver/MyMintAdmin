-- Run this once in the Supabase SQL editor (Project → SQL Editor).
-- These tables were previously auto-created by raw pg DDL from the server;
-- now that api/_dividends-db.js and api/_alliance-news-db.js use the
-- Supabase REST API, table creation is a one-time manual step.

CREATE TABLE IF NOT EXISTS dividend_runs (
  id              SERIAL PRIMARY KEY,
  file_name       TEXT        NOT NULL,
  payment_date    DATE,
  records         INTEGER     NOT NULL DEFAULT 0,
  total_net_cash  NUMERIC(18,2),
  unmatched_count INTEGER     DEFAULT 0,
  net_cash_col    TEXT,
  sheet_names     TEXT[],
  headers         TEXT[],
  status          TEXT        NOT NULL DEFAULT 'success',
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dividend_payouts_staging (
  id            SERIAL PRIMARY KEY,
  run_id        INTEGER REFERENCES dividend_runs(id) ON DELETE CASCADE,
  security_code TEXT,
  net_cash      NUMERIC(18,2),
  raw_row       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- Enable the service-role key (used by the app's server-side code) to
-- bypass RLS on these tables. If RLS is enabled by default on your project,
-- either leave RLS off for these tables or add a policy allowing the
-- service role full access, e.g.:
-- ALTER TABLE dividend_runs ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "service role full access" ON dividend_runs
--   FOR ALL USING (auth.role() = 'service_role');
