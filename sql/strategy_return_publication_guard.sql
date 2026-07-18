-- Guarded publication for strategy returns.
-- Nightly jobs must stage a complete row and call this RPC instead of writing
-- strategies_returns_c directly. Rebalance boundaries require an immutable
-- composition snapshot and a reconciled bridge return.

begin;

create table if not exists public.strategy_return_publication_audit_c (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies_c(id) on delete restrict,
  as_of_date date not null,
  source_run_id uuid references public.return_repair_runs_c(id) on delete restrict,
  securities_value_cents bigint not null check (securities_value_cents >= 0),
  continuity_cash_cents bigint not null default 0 check (continuity_cash_cents >= 0),
  complete_value_cents bigint not null check (complete_value_cents >= 0),
  covered_holdings integer not null check (covered_holdings >= 0),
  expected_holdings integer not null check (expected_holdings >= 0),
  freshest_price_at timestamptz not null,
  composition_effective_from date not null,
  holdings_snapshot jsonb not null,
  boundary_bridge_pct numeric,
  chain_factor numeric not null check (chain_factor > 0),
  ytd_pct numeric not null,
  checks jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  unique (strategy_id, as_of_date),
  check (complete_value_cents = securities_value_cents + continuity_cash_cents),
  check (covered_holdings = expected_holdings),
  check (jsonb_typeof(holdings_snapshot) = 'array')
);

alter table public.strategy_return_publication_audit_c enable row level security;
revoke all on public.strategy_return_publication_audit_c from public, anon, authenticated;
grant all on public.strategy_return_publication_audit_c to service_role;

create or replace function public.publish_guarded_strategy_return(
  p_strategy_id uuid,
  p_as_of_date date,
  p_source_run_id uuid,
  p_securities_value_cents bigint,
  p_continuity_cash_cents bigint,
  p_complete_value_cents bigint,
  p_covered_holdings integer,
  p_expected_holdings integer,
  p_freshest_price_at timestamptz,
  p_composition_effective_from date,
  p_holdings_snapshot jsonb,
  p_boundary_bridge_pct numeric,
  p_chain_factor numeric,
  p_ytd_pct numeric,
  p_checks jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_previous public.strategy_return_publication_audit_c%rowtype;
  v_has_boundary boolean;
  v_run_status text;
begin
  if p_strategy_id is null or p_as_of_date is null then raise exception 'Strategy and date are required'; end if;
  if p_complete_value_cents <> p_securities_value_cents + p_continuity_cash_cents then
    raise exception 'Complete value identity failed';
  end if;
  if p_expected_holdings <= 0 or p_covered_holdings <> p_expected_holdings then
    raise exception 'Price coverage failed: % of % holdings', p_covered_holdings, p_expected_holdings;
  end if;
  if p_freshest_price_at < (p_as_of_date::timestamptz - interval '1 day') then
    raise exception 'Price freshness failed: %', p_freshest_price_at;
  end if;
  if p_holdings_snapshot is null or jsonb_typeof(p_holdings_snapshot) <> 'array'
     or jsonb_array_length(p_holdings_snapshot) <> p_expected_holdings then
    raise exception 'Composition snapshot is incomplete';
  end if;
  if p_chain_factor is null or p_chain_factor <= 0 or p_ytd_pct is null then
    raise exception 'Return chain is incomplete';
  end if;
  if abs((((p_chain_factor - 1) * 100) - p_ytd_pct)) > 0.0001 then
    raise exception 'YTD does not reconcile to chain factor';
  end if;
  if p_source_run_id is not null then
    select status into v_run_status from public.return_repair_runs_c where id = p_source_run_id;
    if v_run_status not in ('APPROVED','PROMOTED') then
      raise exception 'Source repair run is not approved';
    end if;
  end if;

  select * into v_previous
    from public.strategy_return_publication_audit_c
   where strategy_id = p_strategy_id and as_of_date < p_as_of_date
   order by as_of_date desc limit 1;
  v_has_boundary := found and v_previous.composition_effective_from is distinct from p_composition_effective_from;
  if v_has_boundary and p_boundary_bridge_pct is null then
    raise exception 'Composition changed without a boundary bridge';
  end if;

  insert into public.strategy_return_publication_audit_c (
    strategy_id, as_of_date, source_run_id, securities_value_cents,
    continuity_cash_cents, complete_value_cents, covered_holdings,
    expected_holdings, freshest_price_at, composition_effective_from,
    holdings_snapshot, boundary_bridge_pct, chain_factor, ytd_pct, checks
  ) values (
    p_strategy_id, p_as_of_date, p_source_run_id, p_securities_value_cents,
    p_continuity_cash_cents, p_complete_value_cents, p_covered_holdings,
    p_expected_holdings, p_freshest_price_at, p_composition_effective_from,
    p_holdings_snapshot, p_boundary_bridge_pct, p_chain_factor, p_ytd_pct,
    coalesce(p_checks, '{}'::jsonb) || jsonb_build_object(
      'complete_value_identity', true,
      'full_price_coverage', true,
      'fresh_prices', true,
      'composition_snapshot', true,
      'chain_reconciled', true,
      'boundary_bridge_required', v_has_boundary
    )
  )
  on conflict (strategy_id, as_of_date) do update set
    source_run_id = excluded.source_run_id,
    securities_value_cents = excluded.securities_value_cents,
    continuity_cash_cents = excluded.continuity_cash_cents,
    complete_value_cents = excluded.complete_value_cents,
    covered_holdings = excluded.covered_holdings,
    expected_holdings = excluded.expected_holdings,
    freshest_price_at = excluded.freshest_price_at,
    composition_effective_from = excluded.composition_effective_from,
    holdings_snapshot = excluded.holdings_snapshot,
    boundary_bridge_pct = excluded.boundary_bridge_pct,
    chain_factor = excluded.chain_factor,
    ytd_pct = excluded.ytd_pct,
    checks = excluded.checks,
    published_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.publish_guarded_strategy_return(
  uuid,date,uuid,bigint,bigint,bigint,integer,integer,timestamptz,date,jsonb,numeric,numeric,numeric,jsonb
) from public, anon, authenticated;
grant execute on function public.publish_guarded_strategy_return(
  uuid,date,uuid,bigint,bigint,bigint,integer,integer,timestamptz,date,jsonb,numeric,numeric,numeric,jsonb
) to service_role;

commit;
