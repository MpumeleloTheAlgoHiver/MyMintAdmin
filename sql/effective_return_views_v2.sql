-- ============================================================
-- Canonical effective return views — the single read contract (v2)
-- Supersedes sql/canonical_return_views.sql.
-- ------------------------------------------------------------
-- Two coherent daily series (strategy + client), each stitched by source with
-- canonical's careful date-range selection:
--   strategy: promoted repair shadow (before publication) > guarded publication
--             (from its start) > legacy nightly (non-repaired, before publication).
--   client:   promoted repair shadow > legacy (owners the repair did not touch).
--
-- What v2 adds over canonical_return_views.sql (WITHOUT changing its columns or
-- its source selection, so the app + CRM contract is preserved):
--   * ALL periods (1d/5d/1m/mtd + 6m/1y/5y/all for strategy) are DERIVED from the
--     unified ytd chain via window functions (cf = 1 + ytd/100). Canonical derived
--     them only within each segment, so a just-started publication segment showed
--     null 5d/1m/mtd until it accumulated rows. Deriving from the full chain makes
--     every period correct immediately and continuous across handoffs (the Stage-1
--     seed guaranteed the chain is continuous).
--   * strategy view exposes basket_value (cents alias of basket_value_cents) so
--     CRM readers can select it exactly like the legacy strategies_returns_c.
--   * strategy_returns_effective_latest_c / client_..._latest_c: one row per key
--     (latest as_of_date) so readers need no global-date step (effective dates are
--     per-key / ragged).
--
-- Access: strategy views -> anon/authenticated/service_role (browser reads them,
-- non-sensitive aggregates). client views -> service_role only (per-owner data;
-- read server-side via service role in api/investors + app approved.js).
-- security_invoker = false so the browser/service reads repaired shadow data
-- through the view without RLS grants on the shadow tables.
--
-- Non-destructive: views only. Safe to run more than once.
-- ============================================================

begin;

drop view if exists public.strategy_returns_effective_latest_c        cascade;
drop view if exists public.client_strategy_returns_effective_latest_c cascade;
drop view if exists public.strategy_returns_effective_c               cascade;
drop view if exists public.client_strategy_returns_effective_c        cascade;

-- ── Strategy ────────────────────────────────────────────────────────────────
create view public.strategy_returns_effective_c
with (security_invoker = false)
as
with selected_runs as (
  select distinct on (s.strategy_id) s.strategy_id, s.run_id
    from public.strategy_returns_shadow_c s
    join public.return_repair_runs_c r on r.id = s.run_id
   where r.status = 'PROMOTED'
   order by s.strategy_id, r.promoted_at desc nulls last, r.created_at desc
), promoted as (
  select s.* from public.strategy_returns_shadow_c s
  join selected_runs x on x.strategy_id = s.strategy_id and x.run_id = s.run_id
), publication_start as (
  select strategy_id, min(as_of_date) as first_date
    from public.strategy_return_publication_audit_c
   group by strategy_id
), repaired_strategies as (
  select distinct strategy_id from promoted
),
-- Same source selection as canonical, reduced to passthrough columns; periods are
-- derived below from the unified ytd chain.
base as (
  select p.strategy_id, p.as_of_date,
         p.securities_value_cents, p.continuity_cash_cents, p.complete_value_cents,
         p.complete_value_cents as basket_value_cents, p.ytd_pct,
         p.composition_effective_from, p.holdings_snapshot,
         'PROMOTED_REPAIR'::text as source_kind, p.run_id as repair_run_id
    from promoted p
    left join publication_start u on u.strategy_id = p.strategy_id
   where u.first_date is null or p.as_of_date < u.first_date
  union all
  select a.strategy_id, a.as_of_date,
         a.securities_value_cents, a.continuity_cash_cents, a.complete_value_cents,
         a.complete_value_cents as basket_value_cents, a.ytd_pct,
         a.composition_effective_from, a.holdings_snapshot,
         'GUARDED_PUBLICATION'::text as source_kind, a.source_run_id as repair_run_id
    from public.strategy_return_publication_audit_c a
  union all
  select l.strategy_id, l.as_of_date,
         l.basket_value::bigint as securities_value_cents, 0::bigint as continuity_cash_cents,
         l.basket_value::bigint as complete_value_cents, l.basket_value::bigint as basket_value_cents,
         l.ytd_pct, l.as_of_date as composition_effective_from, '[]'::jsonb as holdings_snapshot,
         'LEGACY_PRODUCTION'::text as source_kind, null::uuid as repair_run_id
    from public.strategies_returns_c l
    left join publication_start u on u.strategy_id = l.strategy_id
   where not exists (select 1 from repaired_strategies x where x.strategy_id = l.strategy_id)
     and (u.first_date is null or l.as_of_date < u.first_date)
),
chained as (
  select b.*,
         (1 + b.ytd_pct / 100.0) as cf,
         lag(1 + b.ytd_pct / 100.0, 1)    over w as cf_1,
         lag(1 + b.ytd_pct / 100.0, 5)    over w as cf_5,
         lag(1 + b.ytd_pct / 100.0, 21)   over w as cf_21,
         lag(1 + b.ytd_pct / 100.0, 126)  over w as cf_126,
         lag(1 + b.ytd_pct / 100.0, 252)  over w as cf_252,
         lag(1 + b.ytd_pct / 100.0, 1260) over w as cf_1260,
         first_value(1 + b.ytd_pct / 100.0) over w as cf_first,
         first_value(1 + b.ytd_pct / 100.0) over (
           partition by b.strategy_id, date_trunc('month', b.as_of_date::timestamp)
           order by b.as_of_date rows between unbounded preceding and unbounded following
         ) as cf_month_first
    from base b window w as (partition by b.strategy_id order by b.as_of_date)
)
select strategy_id, as_of_date,
       securities_value_cents, continuity_cash_cents, complete_value_cents,
       basket_value_cents, basket_value_cents as basket_value, ytd_pct,
       case when cf_1     is null or cf_1     = 0 then null else round(((cf/cf_1)    -1)*100,6) end as "1d_pct",
       case when cf_5     is null or cf_5     = 0 then null else round(((cf/cf_5)    -1)*100,6) end as "5d_pct",
       case when cf_21    is null or cf_21    = 0 then null else round(((cf/cf_21)   -1)*100,6) end as "1m_pct",
       case when cf_month_first is null or cf_month_first = 0 then null else round(((cf/cf_month_first)-1)*100,6) end as mtd_pct,
       case when cf_126   is null or cf_126   = 0 then null else round(((cf/cf_126)  -1)*100,6) end as "6m_pct",
       case when cf_252   is null or cf_252   = 0 then null else round(((cf/cf_252)  -1)*100,6) end as "1y_pct",
       case when cf_1260  is null or cf_1260  = 0 then null else round(((cf/cf_1260) -1)*100,6) end as "5y_pct",
       case when cf_first is null or cf_first = 0 then null else round(((cf/cf_first)-1)*100,6) end as all_pct,
       composition_effective_from, holdings_snapshot, source_kind, repair_run_id
  from chained;

-- ── Client ──────────────────────────────────────────────────────────────────
create view public.client_strategy_returns_effective_c
with (security_invoker = false)
as
with selected_runs as (
  select distinct on (c.user_id, coalesce(c.family_member_id,'00000000-0000-0000-0000-000000000000'::uuid), c.strategy_id)
         c.user_id, c.family_member_id, c.strategy_id, c.run_id
    from public.client_strategy_returns_shadow_c c
    join public.return_repair_runs_c r on r.id = c.run_id
   where r.status = 'PROMOTED'
   order by c.user_id, coalesce(c.family_member_id,'00000000-0000-0000-0000-000000000000'::uuid), c.strategy_id,
            r.promoted_at desc nulls last, r.created_at desc
), promoted as (
  select c.*,
         first_value(c.complete_nav_cents + c.accrued_liability_cents) over (
           partition by c.run_id, c.user_id, coalesce(c.family_member_id,'00000000-0000-0000-0000-000000000000'::uuid), c.strategy_id
           order by c.as_of_date asc
         ) as opening_perf_nav
    from public.client_strategy_returns_shadow_c c
    join selected_runs x on x.user_id = c.user_id and x.strategy_id = c.strategy_id
      and x.family_member_id is not distinct from c.family_member_id and x.run_id = c.run_id
), repaired_owners as (
  select distinct user_id, family_member_id, strategy_id from promoted
),
base as (
  select p.user_id, p.family_member_id, p.strategy_id, p.as_of_date,
         p.securities_value_cents, p.residual_cash_cents, p.unused_reserve_cents,
         p.accrued_liability_cents, p.complete_nav_cents as basket_value_cents,
         p.gross_strategy_twr_pct as ytd_pct, p.gross_strategy_twr_pct as inception_pct,
         round(p.opening_perf_nav * p.gross_strategy_twr_pct / 100)::bigint as inception_pnl_cents,
         p.net_cash_pnl_cents, p.net_cash_return_pct, p.opening_perf_nav as opening_performance_nav_cents,
         'PROMOTED_REPAIR'::text as source_kind, p.run_id as repair_run_id
    from promoted p
  union all
  select l.user_id, l.family_member::uuid as family_member_id, l.strategy_id, l.as_of_date,
         l.basket_value::bigint as securities_value_cents, 0::bigint as residual_cash_cents,
         0::bigint as unused_reserve_cents, 0::bigint as accrued_liability_cents,
         l.basket_value::bigint as basket_value_cents, l.ytd_pct, l.inception_pct,
         l.inception_pnl::bigint as inception_pnl_cents,
         l.inception_pnl::bigint as net_cash_pnl_cents, l.inception_pct as net_cash_return_pct,
         null::bigint as opening_performance_nav_cents,
         'LEGACY_PRODUCTION'::text as source_kind, null::uuid as repair_run_id
    from public.client_strategy_returns_c l
   where not exists (
     select 1 from repaired_owners x
      where x.user_id = l.user_id and x.strategy_id = l.strategy_id
        and x.family_member_id is not distinct from l.family_member::uuid
   )
),
chained as (
  select b.*,
         (1 + b.ytd_pct / 100.0) as cf,
         lag(1 + b.ytd_pct / 100.0, 1)  over w as cf_1,
         lag(1 + b.ytd_pct / 100.0, 5)  over w as cf_5,
         lag(1 + b.ytd_pct / 100.0, 21) over w as cf_21,
         first_value(1 + b.ytd_pct / 100.0) over (
           partition by b.user_id, b.family_member_id, b.strategy_id, date_trunc('month', b.as_of_date::timestamp)
           order by b.as_of_date rows between unbounded preceding and unbounded following
         ) as cf_month_first
    from base b
   window w as (partition by b.user_id, b.family_member_id, b.strategy_id order by b.as_of_date)
)
select user_id, family_member_id, strategy_id, as_of_date,
       securities_value_cents, residual_cash_cents, unused_reserve_cents, accrued_liability_cents,
       basket_value_cents, ytd_pct, inception_pct, inception_pnl_cents,
       net_cash_pnl_cents, net_cash_return_pct, opening_performance_nav_cents,
       case when cf_1  is null or cf_1  = 0 then null else round(((cf/cf_1) -1)*100,6) end as "1d_pct",
       case when cf_5  is null or cf_5  = 0 then null else round(((cf/cf_5) -1)*100,6) end as "5d_pct",
       case when cf_21 is null or cf_21 = 0 then null else round(((cf/cf_21)-1)*100,6) end as "1m_pct",
       case when cf_month_first is null or cf_month_first = 0 then null else round(((cf/cf_month_first)-1)*100,6) end as mtd_pct,
       source_kind, repair_run_id
  from chained;

-- ── Latest-per-key companions ────────────────────────────────────────────────
create view public.strategy_returns_effective_latest_c
with (security_invoker = false)
as
select distinct on (strategy_id) *
  from public.strategy_returns_effective_c
 order by strategy_id, as_of_date desc;

create view public.client_strategy_returns_effective_latest_c
with (security_invoker = false)
as
select distinct on (user_id, family_member_id, strategy_id) *
  from public.client_strategy_returns_effective_c
 order by user_id, family_member_id, strategy_id, as_of_date desc;

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke all on public.strategy_returns_effective_c               from public;
revoke all on public.strategy_returns_effective_latest_c        from public;
revoke all on public.client_strategy_returns_effective_c        from public, anon, authenticated;
revoke all on public.client_strategy_returns_effective_latest_c from public, anon, authenticated;
grant select on public.strategy_returns_effective_c        to anon, authenticated, service_role;
grant select on public.strategy_returns_effective_latest_c to anon, authenticated, service_role;
grant select on public.client_strategy_returns_effective_c        to service_role;
grant select on public.client_strategy_returns_effective_latest_c to service_role;

commit;

-- Verify strategy (latest per strategy):
-- select strategy_id, as_of_date, basket_value, ytd_pct, "1d_pct","5d_pct","1m_pct",mtd_pct,"6m_pct","1y_pct","5y_pct",all_pct,
--        complete_value_cents, repair_run_id, source_kind
--   from public.strategy_returns_effective_latest_c order by strategy_id;
-- Verify client (repaired owners on Yield should show as PROMOTED_REPAIR):
-- select user_id, family_member_id, strategy_id, as_of_date, basket_value_cents, ytd_pct, inception_pnl_cents, source_kind
--   from public.client_strategy_returns_effective_latest_c order by user_id, strategy_id;
