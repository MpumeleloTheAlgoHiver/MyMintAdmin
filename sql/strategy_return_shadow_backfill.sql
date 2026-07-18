-- Non-destructive shadow layer for corrected strategy/client returns.
-- Production return tables and application read paths are intentionally untouched.

begin;

create table if not exists public.return_repair_runs_c (
  id uuid primary key default gen_random_uuid(),
  repair_key text not null unique,
  status text not null default 'DRAFT' check (status in (
    'DRAFT','VALIDATED','APPROVED','PROMOTED','REJECTED','ROLLED_BACK'
  )),
  scope jsonb not null default '{}'::jsonb,
  methodology_version text not null,
  backup_sha256 text not null,
  evidence_sha256 jsonb not null default '{}'::jsonb,
  validation_summary jsonb not null default '{}'::jsonb,
  created_by uuid,
  approved_by uuid,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  approved_at timestamptz,
  promoted_at timestamptz,
  rolled_back_at timestamptz
);

create table if not exists public.strategy_returns_shadow_c (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.return_repair_runs_c(id) on delete restrict,
  strategy_id uuid not null,
  as_of_date date not null,
  securities_value_cents bigint not null,
  continuity_cash_cents bigint not null default 0,
  complete_value_cents bigint not null,
  chain_nav_cents bigint not null,
  "1d_pct" numeric,
  "5d_pct" numeric,
  "1m_pct" numeric,
  mtd_pct numeric,
  ytd_pct numeric,
  composition_effective_from date,
  holdings_snapshot jsonb not null default '[]'::jsonb,
  source_method text not null,
  source_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (complete_value_cents = securities_value_cents + continuity_cash_cents),
  unique (run_id, strategy_id, as_of_date)
);

create table if not exists public.client_strategy_returns_shadow_c (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.return_repair_runs_c(id) on delete restrict,
  user_id uuid not null,
  family_member_id uuid,
  strategy_id uuid not null,
  as_of_date date not null,
  securities_value_cents bigint not null,
  residual_cash_cents bigint not null default 0,
  unused_reserve_cents bigint not null default 0,
  accrued_liability_cents bigint not null default 0,
  complete_nav_cents bigint not null,
  external_contribution_cents bigint,
  explicit_upfront_fees_cents bigint,
  gross_strategy_twr_pct numeric,
  net_cash_pnl_cents bigint,
  net_cash_return_pct numeric,
  stored_ytd_pct_comparator numeric,
  confidence text not null,
  source_method text not null,
  source_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (complete_nav_cents = securities_value_cents + residual_cash_cents
                              + unused_reserve_cents - accrued_liability_cents),
  unique nulls not distinct (run_id, user_id, strategy_id, as_of_date,
                             family_member_id)
);

create index if not exists idx_strategy_returns_shadow_run_strategy_date
  on public.strategy_returns_shadow_c(run_id, strategy_id, as_of_date);
create index if not exists idx_client_returns_shadow_run_owner_date
  on public.client_strategy_returns_shadow_c(run_id, user_id, strategy_id, as_of_date);

alter table public.return_repair_runs_c enable row level security;
alter table public.strategy_returns_shadow_c enable row level security;
alter table public.client_strategy_returns_shadow_c enable row level security;

revoke all on public.return_repair_runs_c from public, anon, authenticated;
revoke all on public.strategy_returns_shadow_c from public, anon, authenticated;
revoke all on public.client_strategy_returns_shadow_c from public, anon, authenticated;
grant all on public.return_repair_runs_c to service_role;
grant all on public.strategy_returns_shadow_c to service_role;
grant all on public.client_strategy_returns_shadow_c to service_role;

-- A run may only become VALIDATED when its intended scope is complete and all
-- core accounting identities pass. This function does not promote app reads.
create or replace function public.validate_return_repair_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.return_repair_runs_c%rowtype;
  v_strategy_rows bigint;
  v_client_rows bigint;
  v_bad_strategy bigint;
  v_bad_client bigint;
  v_summary jsonb;
begin
  select * into v_run from public.return_repair_runs_c where id = p_run_id for update;
  if not found then raise exception 'Unknown repair run %', p_run_id; end if;
  if v_run.status not in ('DRAFT','VALIDATED') then
    raise exception 'Run % cannot be validated from status %', p_run_id, v_run.status;
  end if;

  select count(*) into v_strategy_rows from public.strategy_returns_shadow_c where run_id=p_run_id;
  select count(*) into v_client_rows from public.client_strategy_returns_shadow_c where run_id=p_run_id;
  select count(*) into v_bad_strategy from public.strategy_returns_shadow_c
   where run_id=p_run_id
     and complete_value_cents <> securities_value_cents + continuity_cash_cents;
  select count(*) into v_bad_client from public.client_strategy_returns_shadow_c
   where run_id=p_run_id
     and complete_nav_cents <> securities_value_cents + residual_cash_cents
                                + unused_reserve_cents - accrued_liability_cents;

  if v_strategy_rows = 0 or v_client_rows = 0 or v_bad_strategy > 0 or v_bad_client > 0 then
    raise exception 'Repair validation failed: strategy_rows %, client_rows %, bad_strategy %, bad_client %',
      v_strategy_rows, v_client_rows, v_bad_strategy, v_bad_client;
  end if;

  v_summary := jsonb_build_object(
    'strategy_rows',v_strategy_rows,'client_rows',v_client_rows,
    'bad_strategy_identities',v_bad_strategy,'bad_client_identities',v_bad_client,
    'validated_at',now()
  );
  update public.return_repair_runs_c
     set status='VALIDATED', validation_summary=v_summary, validated_at=now()
   where id=p_run_id;
  return v_summary;
end;
$$;

revoke all on function public.validate_return_repair_run(uuid) from public, anon, authenticated;
grant execute on function public.validate_return_repair_run(uuid) to service_role;

commit;

-- Verification (expected: three tables):
select table_name
from information_schema.tables
where table_schema='public'
  and table_name in ('return_repair_runs_c','strategy_returns_shadow_c','client_strategy_returns_shadow_c')
order by table_name;
