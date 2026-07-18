-- Global, effective-dated strategy valuation rules.
--
-- A rule describes one complete strategy lot. Continuity cash is part of the
-- strategy model and applies equally to every holder/new purchaser from the
-- effective date. It is deliberately separate from investor-owned residual
-- cash and the investor's unused execution reserve.

begin;

create table if not exists public.strategy_valuation_rules_c (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies_c(id) on delete restrict,
  effective_from date not null,
  securities_value_per_lot_cents bigint not null check (securities_value_per_lot_cents >= 0),
  continuity_cash_per_lot_cents bigint not null default 0 check (continuity_cash_per_lot_cents >= 0),
  complete_value_per_lot_cents bigint generated always as
    (securities_value_per_lot_cents + continuity_cash_per_lot_cents) stored,
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','SUPERSEDED','REJECTED')),
  repair_run_id uuid references public.return_repair_runs_c(id) on delete restrict,
  methodology_version text not null,
  source_evidence jsonb not null default '{}'::jsonb,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint strategy_valuation_rule_approval_check check (
    (status = 'DRAFT' and approved_at is null and approved_by is null)
    or (status in ('ACTIVE','SUPERSEDED') and approved_at is not null and approved_by is not null)
    or status = 'REJECTED'
  ),
  unique (strategy_id, effective_from)
);

create unique index if not exists uq_strategy_valuation_rules_one_active
  on public.strategy_valuation_rules_c(strategy_id)
  where status = 'ACTIVE';

create index if not exists idx_strategy_valuation_rules_history
  on public.strategy_valuation_rules_c(strategy_id, effective_from desc);

alter table public.strategy_valuation_rules_c enable row level security;
revoke all on public.strategy_valuation_rules_c from public, anon, authenticated;
grant all on public.strategy_valuation_rules_c to service_role;

-- Read the rule that was in force on a particular date. This is the single
-- lookup purchases, NAV, returns and rebalance previews must ultimately use.
create or replace function public.get_strategy_valuation_rule(
  p_strategy_id uuid,
  p_as_of_date date default current_date
) returns public.strategy_valuation_rules_c
language sql
stable
security definer
set search_path = public
as $$
  select r.*
    from public.strategy_valuation_rules_c r
   where r.strategy_id = p_strategy_id
     and r.status in ('ACTIVE','SUPERSEDED')
     and r.effective_from <= coalesce(p_as_of_date, current_date)
   order by r.effective_from desc
   limit 1
$$;

revoke all on function public.get_strategy_valuation_rule(uuid,date) from public, anon, authenticated;
grant execute on function public.get_strategy_valuation_rule(uuid,date) to service_role;

-- Activation is atomic and preserves the preceding rule as historical. A
-- DRAFT rule may only be activated from an APPROVED repair run.
create or replace function public.activate_strategy_valuation_rule(
  p_rule_id uuid,
  p_approved_by uuid
) returns public.strategy_valuation_rules_c
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.strategy_valuation_rules_c%rowtype;
  v_run_status text;
begin
  if p_approved_by is null then raise exception 'Approver is required'; end if;

  select * into v_rule
    from public.strategy_valuation_rules_c
   where id = p_rule_id
   for update;
  if not found then raise exception 'Unknown strategy valuation rule %', p_rule_id; end if;
  if v_rule.status <> 'DRAFT' then
    raise exception 'Rule % cannot be activated from status %', p_rule_id, v_rule.status;
  end if;
  if v_rule.repair_run_id is null then raise exception 'Rule has no repair run'; end if;

  select status into v_run_status
    from public.return_repair_runs_c
   where id = v_rule.repair_run_id
   for update;
  if v_run_status <> 'APPROVED' then
    raise exception 'Repair run must be APPROVED before rule activation (current: %)', coalesce(v_run_status,'missing');
  end if;

  update public.strategy_valuation_rules_c
     set status = 'SUPERSEDED'
   where strategy_id = v_rule.strategy_id
     and status = 'ACTIVE';

  update public.strategy_valuation_rules_c
     set status = 'ACTIVE', approved_by = p_approved_by, approved_at = now()
   where id = p_rule_id
   returning * into v_rule;

  return v_rule;
end;
$$;

revoke all on function public.activate_strategy_valuation_rule(uuid,uuid) from public, anon, authenticated;
grant execute on function public.activate_strategy_valuation_rule(uuid,uuid) to service_role;

commit;

