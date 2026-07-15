-- Reserve-first rebalance fees. Deploy before the matching CRM code.
-- The original transaction remains the cash source; this ledger makes every
-- batch charge idempotent and auditable per owner.

begin;

create table if not exists public.strategy_rebalance_reserve_events_c (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.rebalance_batch(id) on delete restrict,
  strategy_id uuid not null,
  user_id uuid not null,
  family_member_id uuid,
  requested_cents bigint not null check (requested_cents >= 0),
  consumed_cents bigint not null check (consumed_cents >= 0),
  shortfall_cents bigint not null check (shortfall_cents >= 0),
  reserve_before_cents bigint not null check (reserve_before_cents >= 0),
  reserve_after_cents bigint not null check (reserve_after_cents >= 0),
  metadata jsonb not null default '{}'::jsonb,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (requested_cents = consumed_cents + shortfall_cents),
  check (reserve_after_cents = reserve_before_cents - consumed_cents)
);

create unique index if not exists uq_rebalance_reserve_event_batch_owner
  on public.strategy_rebalance_reserve_events_c
  (batch_id, strategy_id, user_id,
   coalesce(family_member_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.strategy_rebalance_reserve_events_c enable row level security;

create or replace function public.apply_rebalance_reserve_charge(
  p_batch_id uuid,
  p_strategy_id uuid,
  p_user_id uuid,
  p_family_member_id uuid,
  p_requested_cents bigint,
  p_effective_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.strategy_rebalance_reserve_events_c%rowtype;
  v_tx record;
  v_available bigint := 0;
  v_remaining bigint := greatest(0, coalesce(p_requested_cents, 0));
  v_draw bigint;
  v_consumed bigint := 0;
begin
  select * into v_existing
    from public.strategy_rebalance_reserve_events_c
   where batch_id = p_batch_id
     and strategy_id = p_strategy_id
     and user_id = p_user_id
     and family_member_id is not distinct from p_family_member_id;
  if found then
    return jsonb_build_object(
      'requested_cents', v_existing.requested_cents,
      'consumed_cents', v_existing.consumed_cents,
      'shortfall_cents', v_existing.shortfall_cents,
      'reserve_before_cents', v_existing.reserve_before_cents,
      'reserve_after_cents', v_existing.reserve_after_cents,
      'idempotent', true
    );
  end if;

  -- Lock each distinct posted purchase transaction connected to this owner and
  -- strategy. Replacement holdings retain transaction_id, so reserve remains
  -- attached to the investor rather than to the security that was sold.
  for v_tx in
    select t.id, t.buffer_cents, t.buffer_consumed_cents
      from public.transactions t
     where exists (
       select 1 from public.stock_holdings_c h
        where h.transaction_id = t.id
          and h.strategy_id = p_strategy_id
          and h.user_id = p_user_id
          and h.family_member_id is not distinct from p_family_member_id
     )
       and coalesce(t.status, '') = 'posted'
       and coalesce(t.reversed, false) = false
     order by t.id
     for update of t
  loop
    v_available := v_available + greatest(0,
      coalesce(v_tx.buffer_cents, 0) - coalesce(v_tx.buffer_consumed_cents, 0));
    if v_remaining > 0 then
      v_draw := least(v_remaining, greatest(0,
        coalesce(v_tx.buffer_cents, 0) - coalesce(v_tx.buffer_consumed_cents, 0)));
      if v_draw > 0 then
        update public.transactions
           set buffer_consumed_cents = coalesce(buffer_consumed_cents, 0) + v_draw,
               updated_at = now()
         where id = v_tx.id;
        v_remaining := v_remaining - v_draw;
        v_consumed := v_consumed + v_draw;
      end if;
    end if;
  end loop;

  insert into public.strategy_rebalance_reserve_events_c
    (batch_id, strategy_id, user_id, family_member_id, requested_cents,
     consumed_cents, shortfall_cents, reserve_before_cents,
     reserve_after_cents, metadata, effective_at)
  values
    (p_batch_id, p_strategy_id, p_user_id, p_family_member_id,
     greatest(0, coalesce(p_requested_cents, 0)), v_consumed, v_remaining,
     v_available, v_available - v_consumed, coalesce(p_metadata, '{}'::jsonb),
     coalesce(p_effective_at, now()));

  return jsonb_build_object(
    'requested_cents', greatest(0, coalesce(p_requested_cents, 0)),
    'consumed_cents', v_consumed,
    'shortfall_cents', v_remaining,
    'reserve_before_cents', v_available,
    'reserve_after_cents', v_available - v_consumed,
    'idempotent', false
  );
end;
$$;

revoke all on function public.apply_rebalance_reserve_charge(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb) from public;
grant execute on function public.apply_rebalance_reserve_charge(uuid,uuid,uuid,uuid,bigint,timestamptz,jsonb) to service_role;

commit;
