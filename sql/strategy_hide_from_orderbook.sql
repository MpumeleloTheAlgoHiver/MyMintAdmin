-- ============================================================
-- Hide a strategy from the orderbook side
-- ------------------------------------------------------------
-- Some strategies are managed entirely on the Rebalances tab —
-- e.g. one that went through a liquidation step. That activity
-- is already shown (correctly) on the Rebalances tab, and must
-- NOT be duplicated on the orderbook side (it reads as a
-- confusing duplicate).
--
-- When hide_from_orderbook is true, the orderbook hides every row
-- of that strategy: it is never shown in the working book, never
-- auto-captured into an Active Order Book, and stripped from the
-- Active Order Books render (so an older captured snapshot no
-- longer shows it). The strategy, its holdings, valuations and the
-- client app are all unaffected — only the orderbook view hides it.
--
-- This is a deliberate, manual, reversible switch. It is NOT a
-- liquidation-lifecycle state: it does not track a batch, and it
-- never changes itself. Flip it off to bring the strategy back.
--
-- The orderbook reads this column at load; until the column exists
-- the read fails gracefully (treated as false), so it is safe to
-- deploy the code before running this.
--
-- Safe to run more than once.
-- ============================================================

ALTER TABLE strategies_c
  ADD COLUMN IF NOT EXISTS hide_from_orderbook boolean NOT NULL DEFAULT false;

-- Yield Basket: went through a partial liquidation (ABG) that lives on the
-- Rebalances tab; hide the duplicate from the orderbook side.
UPDATE strategies_c
   SET hide_from_orderbook = true
 WHERE id = '640dcffb-dc23-4099-9772-0f72ed9688de';

-- To bring a strategy back onto the orderbook later:
--   UPDATE strategies_c SET hide_from_orderbook = false WHERE id = '<strategy_id>';
