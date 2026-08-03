-- Permit a buy-only rebalance to be parked behind an earlier unfilled batch.
-- Each batch retains its own fills, cash bridge and return boundary. The
-- application enforces oldest-first settlement and newest-first reversal.

begin;

alter table public.rebalance_batch
  add column if not exists predecessor_batch_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.rebalance_batch'::regclass
       and conname = 'rebalance_batch_predecessor_batch_id_fkey'
  ) then
    alter table public.rebalance_batch
      add constraint rebalance_batch_predecessor_batch_id_fkey
      foreign key (predecessor_batch_id)
      references public.rebalance_batch(id)
      on delete restrict;
  end if;
end $$;

alter table public.rebalance_batch
  drop constraint if exists rebalance_batch_not_own_predecessor;

alter table public.rebalance_batch
  add constraint rebalance_batch_not_own_predecessor
  check (predecessor_batch_id is null or predecessor_batch_id <> id);

create index if not exists idx_rebalance_batch_predecessor
  on public.rebalance_batch(predecessor_batch_id, status)
  where predecessor_batch_id is not null;

commit;
