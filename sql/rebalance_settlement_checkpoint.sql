-- Resumable rebalance settlement checkpoint.
-- Deploy before the matching orderbook code.

begin;

alter table public.rebalance_batch
  add column if not exists settlement_state text not null default 'PENDING',
  add column if not exists settlement_started_at timestamptz,
  add column if not exists settlement_error text;

update public.rebalance_batch
   set settlement_state = case
     when upper(coalesce(status::text, '')) = 'SETTLED' then 'COMPLETE'
     when upper(coalesce(status::text, '')) = 'REVERSED' then 'REVERSED'
     else 'PENDING'
   end
 where upper(coalesce(status::text, '')) in ('SETTLED','REVERSED')
    or settlement_state is null
    or settlement_state not in ('PENDING','PROCESSING','PAUSED','COMPLETE','REVERSED');

alter table public.rebalance_batch
  drop constraint if exists rebalance_batch_settlement_state_check;

alter table public.rebalance_batch
  add constraint rebalance_batch_settlement_state_check
  check (settlement_state in ('PENDING','PROCESSING','PAUSED','COMPLETE','REVERSED'));

create index if not exists idx_rebalance_batch_settlement_state
  on public.rebalance_batch(status, settlement_state);

commit;
