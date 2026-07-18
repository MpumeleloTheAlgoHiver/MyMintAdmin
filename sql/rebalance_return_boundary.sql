-- Atomically establish the post-settlement return basis. A rebalance changes
-- composition, not accumulated performance: the prior chain factor is carried
-- forward and value not represented by the new securities becomes continuity cash.

begin;

alter table public.strategy_return_publication_audit_c
  add column if not exists boundary_batch_id uuid references public.rebalance_batch(id) on delete restrict;

create unique index if not exists uq_strategy_return_boundary_batch
  on public.strategy_return_publication_audit_c(boundary_batch_id)
  where boundary_batch_id is not null;

alter table public.strategy_valuation_rules_c
  add column if not exists source_batch_id uuid references public.rebalance_batch(id) on delete restrict;

create unique index if not exists uq_strategy_valuation_rule_source_batch
  on public.strategy_valuation_rules_c(source_batch_id)
  where source_batch_id is not null;

create or replace function public.finalize_rebalance_return_boundary(
  p_batch_id uuid,
  p_securities_value_cents bigint,
  p_holdings_snapshot jsonb,
  p_effective_at timestamptz,
  p_price_observed_at timestamptz,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.rebalance_batch%rowtype;
  v_existing public.strategy_return_publication_audit_c%rowtype;
  v_previous_complete bigint;
  v_previous_chain numeric;
  v_previous_ytd numeric;
  v_cash bigint;
  v_complete bigint;
  v_effective_date date := coalesce(p_effective_at,now())::date;
  v_holding_count integer;
  v_rule_id uuid;
begin
  if p_batch_id is null or p_actor is null then raise exception 'Batch and actor are required'; end if;
  if p_securities_value_cents is null or p_securities_value_cents < 0 then raise exception 'Securities value is invalid'; end if;
  if p_holdings_snapshot is null or jsonb_typeof(p_holdings_snapshot)<>'array' then raise exception 'Holdings snapshot must be an array'; end if;
  v_holding_count := jsonb_array_length(p_holdings_snapshot);

  select * into v_batch from public.rebalance_batch where id=p_batch_id for update;
  if not found then raise exception 'Unknown rebalance batch %',p_batch_id; end if;
  if coalesce(v_batch.is_reversed,false) then raise exception 'Reversed batch cannot publish a return boundary'; end if;

  select * into v_existing from public.strategy_return_publication_audit_c where boundary_batch_id=p_batch_id;
  if found then
    if v_existing.securities_value_cents<>p_securities_value_cents or v_existing.holdings_snapshot<>p_holdings_snapshot then
      raise exception 'Boundary batch was already published with different values';
    end if;
    return jsonb_build_object('idempotent',true,'publication_id',v_existing.id,
      'securities_value_cents',v_existing.securities_value_cents,
      'continuity_cash_cents',v_existing.continuity_cash_cents,
      'complete_value_cents',v_existing.complete_value_cents,'ytd_pct',v_existing.ytd_pct);
  end if;

  select a.complete_value_cents,a.chain_factor,a.ytd_pct
    into v_previous_complete,v_previous_chain,v_previous_ytd
    from public.strategy_return_publication_audit_c a
   where a.strategy_id=v_batch.strategy_id and a.as_of_date<=v_effective_date
   order by a.as_of_date desc limit 1;

  if not found then
    select s.complete_value_cents,1+s.ytd_pct/100,s.ytd_pct
      into v_previous_complete,v_previous_chain,v_previous_ytd
      from public.strategy_returns_shadow_c s
      join public.return_repair_runs_c r on r.id=s.run_id and r.status='PROMOTED'
     where s.strategy_id=v_batch.strategy_id and s.as_of_date<=v_effective_date
     order by r.promoted_at desc nulls last,s.as_of_date desc limit 1;
  end if;

  if v_previous_chain is null then
    select l.basket_value,1+coalesce(l.ytd_pct,0)/100,coalesce(l.ytd_pct,0)
      into v_previous_complete,v_previous_chain,v_previous_ytd
      from public.strategies_returns_c l
     where l.strategy_id=v_batch.strategy_id and l.as_of_date<=v_effective_date
     order by l.as_of_date desc limit 1;
  end if;
  if v_previous_chain is null or v_previous_complete is null then raise exception 'No canonical pre-settlement return basis'; end if;

  -- Preserve complete value where possible. If a buy-only model legitimately
  -- raises the securities minimum, continuity cash floors at zero while the
  -- chain factor still remains unchanged (a composition/capital event, not return).
  v_cash := greatest(0,v_previous_complete-p_securities_value_cents);
  v_complete := p_securities_value_cents+v_cash;

  update public.strategy_valuation_rules_c set status='SUPERSEDED'
   where strategy_id=v_batch.strategy_id and status='ACTIVE';
  insert into public.strategy_valuation_rules_c(
    strategy_id,effective_from,securities_value_per_lot_cents,
    continuity_cash_per_lot_cents,status,methodology_version,source_evidence,
    approved_by,approved_at,created_by,source_batch_id
  ) values (
    v_batch.strategy_id,v_effective_date,p_securities_value_cents,v_cash,'ACTIVE',
    'SETTLEMENT_CHAIN_V1',jsonb_build_object('batch_id',p_batch_id,'basis','actual_fill_and_guarded_prices'),
    p_actor,now(),p_actor,p_batch_id
  ) returning id into v_rule_id;

  insert into public.strategy_return_publication_audit_c(
    strategy_id,as_of_date,securities_value_cents,continuity_cash_cents,
    complete_value_cents,covered_holdings,expected_holdings,freshest_price_at,
    composition_effective_from,holdings_snapshot,boundary_bridge_pct,
    chain_factor,ytd_pct,checks,boundary_batch_id
  ) values (
    v_batch.strategy_id,v_effective_date,p_securities_value_cents,v_cash,v_complete,
    v_holding_count,v_holding_count,coalesce(p_price_observed_at,p_effective_at,now()),
    v_effective_date,p_holdings_snapshot,0,v_previous_chain,v_previous_ytd,
    jsonb_build_object('settlement_boundary',true,'chain_preserved',true,'valuation_rule_id',v_rule_id),p_batch_id
  )
  on conflict(strategy_id,as_of_date) do update set
    securities_value_cents=excluded.securities_value_cents,
    continuity_cash_cents=excluded.continuity_cash_cents,
    complete_value_cents=excluded.complete_value_cents,
    covered_holdings=excluded.covered_holdings,
    expected_holdings=excluded.expected_holdings,
    freshest_price_at=excluded.freshest_price_at,
    composition_effective_from=excluded.composition_effective_from,
    holdings_snapshot=excluded.holdings_snapshot,
    boundary_bridge_pct=excluded.boundary_bridge_pct,
    chain_factor=excluded.chain_factor,
    ytd_pct=excluded.ytd_pct,
    checks=excluded.checks,
    boundary_batch_id=excluded.boundary_batch_id,
    published_at=now();

  update public.rebalance_batch
     set settlement_effective_at=coalesce(p_effective_at,now()),
         holdings_snapshot_after=p_holdings_snapshot,
         updated_at=now()
   where id=p_batch_id;

  return jsonb_build_object('idempotent',false,'valuation_rule_id',v_rule_id,
    'securities_value_cents',p_securities_value_cents,'continuity_cash_cents',v_cash,
    'complete_value_cents',v_complete,'ytd_pct',v_previous_ytd);
end;
$$;

revoke all on function public.finalize_rebalance_return_boundary(uuid,bigint,jsonb,timestamptz,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.finalize_rebalance_return_boundary(uuid,bigint,jsonb,timestamptz,timestamptz,uuid) to service_role;

commit;
