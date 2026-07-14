-- Immutable value/composition retention across settled rebalances.
-- Deploy before the matching orderbook/API code.

begin;

alter table public.rebalance_batch
  add column if not exists holdings_snapshot_after jsonb,
  add column if not exists settlement_effective_at timestamptz;

create table if not exists public.strategy_rebalance_cash_events_c (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.rebalance_batch(id) on delete restrict,
  strategy_id uuid not null,
  user_id uuid not null,
  family_member_id uuid,
  event_type text not null check (event_type in (
    'LIQUIDATION_PROCEEDS', 'REBALANCE_RESIDUAL', 'WALLET_BUY',
    'REVERSAL', 'MANUAL_CORRECTION'
  )),
  opening_balance_cents bigint not null check (opening_balance_cents >= 0),
  amount_cents bigint not null,
  closing_balance_cents bigint not null check (closing_balance_cents >= 0),
  effective_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint strategy_rebalance_cash_event_balance_check
    check (closing_balance_cents = opening_balance_cents + amount_cents)
);

create unique index if not exists uq_strategy_rebalance_cash_event_batch_owner_type
  on public.strategy_rebalance_cash_events_c
  (batch_id, strategy_id, user_id, coalesce(family_member_id, '00000000-0000-0000-0000-000000000000'::uuid), event_type);

create index if not exists idx_strategy_rebalance_cash_events_owner_date
  on public.strategy_rebalance_cash_events_c
  (user_id, strategy_id, effective_at);

alter table public.strategy_rebalance_cash_events_c enable row level security;

create or replace function public.apply_strategy_rebalance_cash_event(
  p_batch_id uuid,
  p_strategy_id uuid,
  p_user_id uuid,
  p_family_member_id uuid,
  p_event_type text,
  p_amount_cents bigint,
  p_effective_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opening bigint;
  v_closing bigint;
begin
  select closing_balance_cents into v_closing
    from public.strategy_rebalance_cash_events_c
   where batch_id = p_batch_id
     and strategy_id = p_strategy_id
     and user_id = p_user_id
     and family_member_id is not distinct from p_family_member_id
     and event_type = p_event_type;
  if found then return v_closing; end if;

  select balance_cents into v_opening
    from public.strategy_rebalance_residuals
   where strategy_id = p_strategy_id
     and user_id = p_user_id
     and family_member_id is not distinct from p_family_member_id
   for update;

  if not found then
    v_opening := 0;
    insert into public.strategy_rebalance_residuals
      (strategy_id, user_id, family_member_id, balance_cents, updated_at)
    values
      (p_strategy_id, p_user_id, p_family_member_id, 0, now());
  end if;

  v_closing := v_opening + p_amount_cents;
  if v_closing < 0 then raise exception 'Residual balance cannot be negative'; end if;

  update public.strategy_rebalance_residuals
     set balance_cents = v_closing, updated_at = now()
   where strategy_id = p_strategy_id
     and user_id = p_user_id
     and family_member_id is not distinct from p_family_member_id;

  insert into public.strategy_rebalance_cash_events_c
    (batch_id, strategy_id, user_id, family_member_id, event_type,
     opening_balance_cents, amount_cents, closing_balance_cents,
     effective_at, metadata)
  values
    (p_batch_id, p_strategy_id, p_user_id, p_family_member_id, p_event_type,
     v_opening, p_amount_cents, v_closing,
     coalesce(p_effective_at, now()), coalesce(p_metadata, '{}'::jsonb));

  return v_closing;
end;
$$;

revoke all on function public.apply_strategy_rebalance_cash_event(uuid,uuid,uuid,uuid,text,bigint,timestamptz,jsonb) from public;
grant execute on function public.apply_strategy_rebalance_cash_event(uuid,uuid,uuid,uuid,text,bigint,timestamptz,jsonb) to service_role;

commit;
