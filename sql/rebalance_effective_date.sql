-- ============================================================
-- Rebalance: effective_date column
-- ------------------------------------------------------------
-- Adds an explicit "effective date" to every rebalance batch.
--
-- Why (workbook 05_Rebalance_Events / 08_Rebalance_Walkthrough):
--   A client is affected by a rebalance ONLY if they held the
--   strategy on or before this date. The CRM now gates eligible
--   holders on  Fill_date <= effective_date  at execute time and
--   stores the date it used here, so every batch is auditable:
--   "who was eligible, and as of when."
--
-- Backfill: existing rows get their created_at date, which matches
--   the previous implicit behaviour (eligibility = holders active
--   at execute time). No behavioural change for historical batches.
--
-- Safe to run more than once.
-- ============================================================

ALTER TABLE rebalance_batch
  ADD COLUMN IF NOT EXISTS effective_date date;

-- Backfill historical rows to their creation date (implicit old behaviour).
UPDATE rebalance_batch
   SET effective_date = created_at::date
 WHERE effective_date IS NULL;

-- New rows always carry an effective_date from the app; default to today
-- as a safety net for any direct insert that omits it.
ALTER TABLE rebalance_batch
  ALTER COLUMN effective_date SET DEFAULT (now() AT TIME ZONE 'UTC')::date;
