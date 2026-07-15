-- Defer wallet-funded buy-only composition changes until actual-fill settlement.
-- Deploy before the matching dashboard/orderbook code.

begin;

alter table public.rebalance_batch
  add column if not exists holdings_snapshot_planned jsonb,
  add column if not exists min_investment_planned numeric;

alter table public.rebalance_batch
  drop constraint if exists rebalance_batch_min_investment_planned_check;

alter table public.rebalance_batch
  add constraint rebalance_batch_min_investment_planned_check
  check (min_investment_planned is null or min_investment_planned >= 0);

commit;
