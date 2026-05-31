-- Per-strategy rebalance residual cash bucket.
--
-- The old `wallets.rebalance_residual` column was a single per-USER pool —
-- if a user was in multiple strategies, residual cash from any of them
-- accumulated into the same bucket with no traceability. This table
-- replaces that with a per-(user, strategy) ledger so:
--   * MINT can show each strategy's "cash component" in its portfolio total
--   * Future rebalances of strategy X can use ONLY strategy X's leftover cash
--   * The PnL pass-down (Model 2 no-carryover) stays tracked per strategy
--
-- The existing `wallets.rebalance_residual` column STAYS in place and acts
-- as a "legacy unallocated pool". Existing residual balances aren't
-- migrated automatically because they weren't tagged to a strategy at the
-- time of creation. They remain spendable from the wallet modal.

CREATE TABLE IF NOT EXISTS public.strategy_rebalance_residuals (
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id   uuid        NOT NULL REFERENCES public.strategies_c(id) ON DELETE CASCADE,
  balance_cents bigint      NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, strategy_id)
);

-- Lookup by strategy for admin views ("show me all clients with residual in
-- Strategy X"). The PK already covers user-first lookups.
CREATE INDEX IF NOT EXISTS strategy_rebalance_residuals_strategy_idx
  ON public.strategy_rebalance_residuals(strategy_id);

-- RLS: a user can read only their own residuals. Writes happen exclusively
-- from the admin app via the service-role key (bypasses RLS).
ALTER TABLE public.strategy_rebalance_residuals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user reads own residuals"
  ON public.strategy_rebalance_residuals;

CREATE POLICY "user reads own residuals"
  ON public.strategy_rebalance_residuals
  FOR SELECT
  USING (auth.uid() = user_id);

-- Sanity check after creation.
SELECT
  (SELECT COUNT(*) FROM public.strategy_rebalance_residuals) AS row_count,
  (SELECT SUM(balance_cents) / 100.0 FROM public.strategy_rebalance_residuals) AS total_rands;
