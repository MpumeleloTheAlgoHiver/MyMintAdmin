-- Stable model snapshots for independently settled, disjoint rebalance books.
-- Run after the updated rebalance_ca_reconciliation.sql definition.

begin;

alter table public.rebalance_batch
  add column if not exists holdings_snapshot_planned jsonb,
  add column if not exists min_investment_planned numeric;

alter table public.rebalance_batch
  drop constraint if exists rebalance_batch_min_investment_planned_check;

alter table public.rebalance_batch
  add constraint rebalance_batch_min_investment_planned_check
  check (min_investment_planned is null or min_investment_planned >= 0);

-- Existing open books predate the planned-composition checkpoint. They all
-- point at the strategy's currently committed final model, so freeze that
-- basis before either book can change min_investment during settlement.
update public.rebalance_batch b
   set holdings_snapshot_planned = coalesce(b.holdings_snapshot_planned, s.holdings),
       min_investment_planned = coalesce(b.min_investment_planned, s.min_investment),
       updated_at = now()
  from public.strategies_c s
 where s.id = b.strategy_id
   and b.status = 'PENDING'
   and b.predecessor_batch_id is null
   and (b.sell_security_id is not null or b.buy_security_id is not null)
   and (b.holdings_snapshot_planned is null or b.min_investment_planned is null);

commit;
