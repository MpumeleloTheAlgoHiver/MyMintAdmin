-- One canonical read contract for strategy and client returns.
-- Promoted repaired series replace only the matching legacy series; unaffected
-- strategies/owners continue to resolve from production history.

begin;

create or replace view public.strategy_returns_effective_c
with (security_invoker = false)
as
with selected_runs as (
  select distinct on (s.strategy_id) s.strategy_id,s.run_id
    from public.strategy_returns_shadow_c s
    join public.return_repair_runs_c r on r.id=s.run_id
   where r.status='PROMOTED'
   order by s.strategy_id,r.promoted_at desc nulls last,r.created_at desc
), promoted as (
  select s.* from public.strategy_returns_shadow_c s
  join selected_runs x on x.strategy_id=s.strategy_id and x.run_id=s.run_id
), repaired_strategies as (
  select distinct strategy_id from promoted
)
select p.strategy_id,p.as_of_date,
       p.securities_value_cents,p.continuity_cash_cents,p.complete_value_cents,
       p.chain_nav_cents as basket_value_cents,
       p."1d_pct",p."5d_pct",p."1m_pct",p.mtd_pct,p.ytd_pct,
       p.composition_effective_from,p.holdings_snapshot,
       'PROMOTED_REPAIR'::text as source_kind,p.run_id as repair_run_id
  from promoted p
union all
select l.strategy_id,l.as_of_date,
       l.basket_value::bigint as securities_value_cents,0::bigint as continuity_cash_cents,
       l.basket_value::bigint as complete_value_cents,l.basket_value::bigint as basket_value_cents,
       l."1d_pct",l."5d_pct",l."1m_pct",null::numeric as mtd_pct,l.ytd_pct,
       l.as_of_date as composition_effective_from,'[]'::jsonb as holdings_snapshot,
       'LEGACY_PRODUCTION'::text as source_kind,null::uuid as repair_run_id
  from public.strategies_returns_c l
 where not exists (select 1 from repaired_strategies x where x.strategy_id=l.strategy_id);

create or replace view public.client_strategy_returns_effective_c
with (security_invoker = false)
as
with selected_runs as (
  select distinct on (c.user_id,coalesce(c.family_member_id,'00000000-0000-0000-0000-000000000000'::uuid),c.strategy_id)
         c.user_id,c.family_member_id,c.strategy_id,c.run_id
    from public.client_strategy_returns_shadow_c c
    join public.return_repair_runs_c r on r.id=c.run_id
   where r.status='PROMOTED'
   order by c.user_id,coalesce(c.family_member_id,'00000000-0000-0000-0000-000000000000'::uuid),c.strategy_id,
            r.promoted_at desc nulls last,r.created_at desc
), promoted as (
  select c.*,
         first_value(c.complete_nav_cents+c.accrued_liability_cents) over (
           partition by c.run_id,c.user_id,coalesce(c.family_member_id,'00000000-0000-0000-0000-000000000000'::uuid),c.strategy_id
           order by c.as_of_date asc
         ) as opening_performance_nav_cents,
         lag(c.gross_strategy_twr_pct,1) over (
           partition by c.run_id,c.user_id,coalesce(c.family_member_id,'00000000-0000-0000-0000-000000000000'::uuid),c.strategy_id
           order by c.as_of_date asc
         ) as previous_twr,
         lag(c.gross_strategy_twr_pct,5) over (
           partition by c.run_id,c.user_id,coalesce(c.family_member_id,'00000000-0000-0000-0000-000000000000'::uuid),c.strategy_id
           order by c.as_of_date asc
         ) as five_day_twr
    from public.client_strategy_returns_shadow_c c
    join selected_runs x on x.user_id=c.user_id and x.strategy_id=c.strategy_id
      and x.family_member_id is not distinct from c.family_member_id and x.run_id=c.run_id
), repaired_owners as (
  select distinct user_id,family_member_id,strategy_id from promoted
)
select p.user_id,p.family_member_id,p.strategy_id,p.as_of_date,
       p.securities_value_cents,p.residual_cash_cents,p.unused_reserve_cents,
       p.accrued_liability_cents,p.complete_nav_cents as basket_value_cents,
       case when p.previous_twr is null then null else
         ((1+p.gross_strategy_twr_pct/100)/(1+p.previous_twr/100)-1)*100 end as "1d_pct",
       case when p.five_day_twr is null then null else
         ((1+p.gross_strategy_twr_pct/100)/(1+p.five_day_twr/100)-1)*100 end as "5d_pct",
       null::numeric as "1m_pct",p.gross_strategy_twr_pct as ytd_pct,
       p.gross_strategy_twr_pct as inception_pct,
       round(p.opening_performance_nav_cents*p.gross_strategy_twr_pct/100)::bigint as inception_pnl_cents,
       p.net_cash_pnl_cents,p.net_cash_return_pct,p.opening_performance_nav_cents,
       'PROMOTED_REPAIR'::text as source_kind,p.run_id as repair_run_id
  from promoted p
union all
select l.user_id,l.family_member::uuid as family_member_id,l.strategy_id,l.as_of_date,
       l.basket_value::bigint as securities_value_cents,0::bigint as residual_cash_cents,
       0::bigint as unused_reserve_cents,0::bigint as accrued_liability_cents,
       l.basket_value::bigint as basket_value_cents,l."1d_pct",l."5d_pct",l."1m_pct",l.ytd_pct,
       l.inception_pct,l.inception_pnl::bigint as inception_pnl_cents,
       l.inception_pnl::bigint as net_cash_pnl_cents,l.inception_pct as net_cash_return_pct,
       null::bigint as opening_performance_nav_cents,
       'LEGACY_PRODUCTION'::text as source_kind,null::uuid as repair_run_id
  from public.client_strategy_returns_c l
 where not exists (
   select 1 from repaired_owners x
    where x.user_id=l.user_id and x.strategy_id=l.strategy_id
      and x.family_member_id is not distinct from l.family_member::uuid
 );

revoke all on public.strategy_returns_effective_c from public,anon,authenticated;
revoke all on public.client_strategy_returns_effective_c from public,anon,authenticated;
grant select on public.strategy_returns_effective_c to service_role;
grant select on public.client_strategy_returns_effective_c to service_role;

commit;
