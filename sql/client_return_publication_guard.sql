-- Guarded daily publication for per-owner strategy returns.
-- Deploy before enabling CLIENT_RETURNS_PUBLISH_APPLY.

begin;

create table if not exists public.client_strategy_return_publication_audit_c (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  family_member_id uuid,
  strategy_id uuid not null references public.strategies_c(id) on delete restrict,
  as_of_date date not null,
  securities_value_cents bigint not null check (securities_value_cents >= 0),
  residual_cash_cents bigint not null default 0 check (residual_cash_cents >= 0),
  unused_reserve_cents bigint not null default 0 check (unused_reserve_cents >= 0),
  accrued_liability_cents bigint not null default 0 check (accrued_liability_cents >= 0),
  performance_nav_cents bigint not null check (performance_nav_cents >= 0),
  complete_nav_cents bigint not null check (complete_nav_cents >= 0),
  opening_performance_nav_cents bigint not null check (opening_performance_nav_cents > 0),
  external_contribution_cents bigint,
  gross_strategy_twr_pct numeric not null,
  chain_factor numeric not null check (chain_factor > 0),
  inception_pnl_cents bigint not null,
  net_cash_pnl_cents bigint,
  net_cash_return_pct numeric,
  covered_holdings integer not null check (covered_holdings >= 0),
  expected_holdings integer not null check (expected_holdings > 0),
  oldest_price_at timestamptz not null,
  holdings_snapshot jsonb not null,
  boundary_batch_id uuid references public.rebalance_batch(id) on delete restrict,
  checks jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  unique nulls not distinct (user_id, family_member_id, strategy_id, as_of_date),
  check (performance_nav_cents = securities_value_cents + residual_cash_cents + unused_reserve_cents),
  check (complete_nav_cents = performance_nav_cents - accrued_liability_cents),
  check (covered_holdings = expected_holdings),
  check (jsonb_typeof(holdings_snapshot) = 'array')
);

create index if not exists idx_client_return_publication_owner_date
  on public.client_strategy_return_publication_audit_c
  (user_id, strategy_id, as_of_date);

alter table public.client_strategy_return_publication_audit_c enable row level security;
revoke all on public.client_strategy_return_publication_audit_c from public, anon, authenticated;
grant all on public.client_strategy_return_publication_audit_c to service_role;

create or replace function public.publish_guarded_client_strategy_return(
  p_user_id uuid,
  p_family_member_id uuid,
  p_strategy_id uuid,
  p_as_of_date date,
  p_securities_value_cents bigint,
  p_residual_cash_cents bigint,
  p_unused_reserve_cents bigint,
  p_accrued_liability_cents bigint,
  p_performance_nav_cents bigint,
  p_complete_nav_cents bigint,
  p_opening_performance_nav_cents bigint,
  p_external_contribution_cents bigint,
  p_gross_strategy_twr_pct numeric,
  p_chain_factor numeric,
  p_inception_pnl_cents bigint,
  p_net_cash_pnl_cents bigint,
  p_net_cash_return_pct numeric,
  p_covered_holdings integer,
  p_expected_holdings integer,
  p_oldest_price_at timestamptz,
  p_holdings_snapshot jsonb,
  p_boundary_batch_id uuid,
  p_checks jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_previous public.client_strategy_return_publication_audit_c%rowtype;
begin
  if p_user_id is null or p_strategy_id is null or p_as_of_date is null then
    raise exception 'Owner, strategy and date are required';
  end if;
  if p_performance_nav_cents <> p_securities_value_cents + p_residual_cash_cents + p_unused_reserve_cents then
    raise exception 'Client performance NAV identity failed';
  end if;
  if p_complete_nav_cents <> p_performance_nav_cents - p_accrued_liability_cents then
    raise exception 'Client complete NAV identity failed';
  end if;
  if p_complete_nav_cents < 0 then raise exception 'Client complete NAV cannot be negative'; end if;
  if p_covered_holdings <> p_expected_holdings or p_expected_holdings <= 0 then
    raise exception 'Client price coverage failed: % of %', p_covered_holdings, p_expected_holdings;
  end if;
  if p_oldest_price_at < (p_as_of_date::timestamptz - interval '1 day') then
    raise exception 'Client price freshness failed: %', p_oldest_price_at;
  end if;
  if p_holdings_snapshot is null or jsonb_typeof(p_holdings_snapshot) <> 'array'
     or jsonb_array_length(p_holdings_snapshot) <> p_expected_holdings then
    raise exception 'Client holdings snapshot is incomplete';
  end if;
  if p_chain_factor is null or p_chain_factor <= 0 or p_gross_strategy_twr_pct is null then
    raise exception 'Client return chain is incomplete';
  end if;
  if abs((((p_chain_factor - 1) * 100) - p_gross_strategy_twr_pct)) > 0.0001 then
    raise exception 'Client TWR does not reconcile to chain factor';
  end if;

  select * into v_previous
    from public.client_strategy_return_publication_audit_c
   where user_id = p_user_id
     and family_member_id is not distinct from p_family_member_id
     and strategy_id = p_strategy_id and as_of_date < p_as_of_date
   order by as_of_date desc limit 1;

  if found and v_previous.holdings_snapshot is distinct from p_holdings_snapshot then
    if p_boundary_batch_id is null then
      raise exception 'Client composition changed without a settled rebalance boundary';
    end if;
    if abs(p_chain_factor - v_previous.chain_factor) > 0.000001 then
      raise exception 'Client rebalance boundary did not preserve the return chain';
    end if;
  end if;

  insert into public.client_strategy_return_publication_audit_c (
    user_id, family_member_id, strategy_id, as_of_date,
    securities_value_cents, residual_cash_cents, unused_reserve_cents,
    accrued_liability_cents, performance_nav_cents, complete_nav_cents,
    opening_performance_nav_cents, external_contribution_cents,
    gross_strategy_twr_pct, chain_factor, inception_pnl_cents,
    net_cash_pnl_cents, net_cash_return_pct, covered_holdings,
    expected_holdings, oldest_price_at, holdings_snapshot,
    boundary_batch_id, checks
  ) values (
    p_user_id, p_family_member_id, p_strategy_id, p_as_of_date,
    p_securities_value_cents, p_residual_cash_cents, p_unused_reserve_cents,
    p_accrued_liability_cents, p_performance_nav_cents, p_complete_nav_cents,
    p_opening_performance_nav_cents, p_external_contribution_cents,
    p_gross_strategy_twr_pct, p_chain_factor, p_inception_pnl_cents,
    p_net_cash_pnl_cents, p_net_cash_return_pct, p_covered_holdings,
    p_expected_holdings, p_oldest_price_at, p_holdings_snapshot,
    p_boundary_batch_id, coalesce(p_checks, '{}'::jsonb) || jsonb_build_object(
      'performance_nav_identity', true, 'complete_nav_identity', true,
      'full_price_coverage', true, 'fresh_prices', true,
      'holdings_snapshot', true, 'chain_reconciled', true
    )
  )
  on conflict (user_id, family_member_id, strategy_id, as_of_date) do update set
    securities_value_cents = excluded.securities_value_cents,
    residual_cash_cents = excluded.residual_cash_cents,
    unused_reserve_cents = excluded.unused_reserve_cents,
    accrued_liability_cents = excluded.accrued_liability_cents,
    performance_nav_cents = excluded.performance_nav_cents,
    complete_nav_cents = excluded.complete_nav_cents,
    opening_performance_nav_cents = excluded.opening_performance_nav_cents,
    external_contribution_cents = excluded.external_contribution_cents,
    gross_strategy_twr_pct = excluded.gross_strategy_twr_pct,
    chain_factor = excluded.chain_factor,
    inception_pnl_cents = excluded.inception_pnl_cents,
    net_cash_pnl_cents = excluded.net_cash_pnl_cents,
    net_cash_return_pct = excluded.net_cash_return_pct,
    covered_holdings = excluded.covered_holdings,
    expected_holdings = excluded.expected_holdings,
    oldest_price_at = excluded.oldest_price_at,
    holdings_snapshot = excluded.holdings_snapshot,
    boundary_batch_id = excluded.boundary_batch_id,
    checks = excluded.checks,
    published_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.publish_guarded_client_strategy_return(
  uuid,uuid,uuid,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,
  numeric,numeric,bigint,bigint,numeric,integer,integer,timestamptz,jsonb,uuid,jsonb
) from public, anon, authenticated;
grant execute on function public.publish_guarded_client_strategy_return(
  uuid,uuid,uuid,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,
  numeric,numeric,bigint,bigint,numeric,integer,integer,timestamptz,jsonb,uuid,jsonb
) to service_role;

commit;
