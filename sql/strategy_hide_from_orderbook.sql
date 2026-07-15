-- ============================================================
-- Strategy liquidation flag
-- ------------------------------------------------------------
-- A strategy being wound down to cash is managed ENTIRELY on the
-- Rebalances tab (batch-level Fill & Settle). When is_liquidating
-- is true, the orderbook hides every row of that strategy — it is
-- never shown in the working book and never captured into (or
-- rendered in) an Active Order Book. It appears ONLY on the
-- Rebalances tab.
--
-- The orderbook reads this column at load; until the column exists
-- the read fails gracefully (flag treated as false), so it is safe
-- to deploy the code before running this.
--
-- Safe to run more than once.
-- ============================================================

ALTER TABLE strategies_c
  ADD COLUMN IF NOT EXISTS is_liquidating boolean NOT NULL DEFAULT false;

-- Flag Yield Basket — the strategy currently under liquidation.
UPDATE strategies_c
   SET is_liquidating = true
 WHERE id = '640dcffb-dc23-4099-9772-0f72ed9688de';

-- To wind a strategy back into normal trading later:
--   UPDATE strategies_c SET is_liquidating = false WHERE id = '<strategy_id>';
