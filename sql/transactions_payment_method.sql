-- ============================================================
-- transactions.payment_method
-- ------------------------------------------------------------
-- Tags how a transaction was funded so the CRM can filter by it.
-- Currently used by the EFT tab's "Ozow Payments" view, which
-- reads transactions WHERE payment_method = 'ozow'.
--
-- The mint app's Ozow webhook (api/ozow/notify.js) and success
-- recorder (api/ozow/record-success.js) stamp 'ozow' on the
-- transaction after it is recorded (best-effort — the payment is
-- still recorded even if this column is missing, so it is safe to
-- deploy the app before/after running this).
--
-- Additive + nullable: existing rows keep NULL (untagged), nothing
-- breaks. Future methods can reuse the same column ('wallet',
-- 'eft', 'gift', 'ozow', ...).
--
-- Safe to run more than once.
-- ============================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS payment_method text;

-- Optional: index if the Ozow view grows large.
-- CREATE INDEX IF NOT EXISTS idx_transactions_payment_method
--   ON transactions (payment_method);
