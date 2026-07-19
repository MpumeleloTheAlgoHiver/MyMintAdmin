-- ============================================================
-- Strategy effective return views — the single read contract (Stage 2 + 3)
-- ------------------------------------------------------------
-- strategy_returns_effective_c        : one coherent daily series per strategy.
-- strategy_returns_effective_latest_c : latest row per strategy (reader convenience).
--
-- Series is stitched by priority PER DATE:
--   publication (guarded daily cron / settlement) > promoted repair shadow >
--   legacy nightly.
-- Because ytd_pct IS the chain value at each date (chain_factor = 1 + ytd/100),
-- ALL periods (1d / 5d / 1m / MTD / 6m / 1y / 5y / all) are DERIVED from that
-- unified chain via window functions — consistent and accurate across the
-- shadow->publication and legacy->publication handoffs (the Stage-1 seed made
-- those handoffs continuous).
--
-- Rebalance-aware: value is the COMPLETE lot (securities + continuity cash) once
-- a strategy is published; a rebalance's securities->cash shift never resets YTD
-- because the chain carries through the boundary.
--
-- Shape-compatible with strategies_returns_c so CRM readers can swap the source
-- with no logic change: exposes basket_value (cents, same as legacy) AND
-- basket_value_cents, plus the full period set.
--
-- Access: SELECT to anon/authenticated/service_role. security_invoker = false so
-- the browser reads repaired data through the view WITHOUT needing RLS grants on
-- the shadow/publication tables. Strategy-level returns are non-sensitive
-- aggregates (already shown in the CRM); no per-user data is exposed.
--
-- Non-destructive: views only. Safe to run more than once.
-- ============================================================

begin;

-- CREATE OR REPLACE can't change a view's column set (42P16); drop + recreate.
drop view if exists public.strategy_returns_effective_latest_c cascade;
drop view if exists public.strategy_returns_effective_c cascade;

create view public.strategy_returns_effective_c
with (security_invoker = false)
as
with sourced as (
  -- publication (guarded) — highest priority
  select p.strategy_id, p.as_of_date, p.ytd_pct,
         p.complete_value_cents as value_cents,
         'PUBLICATION'::text as source_kind, 3 as priority
    from public.strategy_return_publication_audit_c p
  union all
  -- promoted repair shadow (repaired truth)
  select s.strategy_id, s.as_of_date, s.ytd_pct,
         s.chain_nav_cents as value_cents,
         'REPAIR_SHADOW'::text, 2
    from public.strategy_returns_shadow_c s
    join public.return_repair_runs_c r on r.id = s.run_id and r.status = 'PROMOTED'
  union all
  -- legacy nightly (non-repaired, and historical)
  select l.strategy_id, l.as_of_date, l.ytd_pct,
         l.basket_value::bigint as value_cents,
         'LEGACY'::text, 1
    from public.strategies_returns_c l
),
ranked as (
  select *,
         row_number() over (partition by strategy_id, as_of_date order by priority desc) as rn
    from sourced
    where ytd_pct is not null
),
unified as (
  select strategy_id, as_of_date, ytd_pct, value_cents, source_kind
    from ranked
   where rn = 1
),
chained as (
  select u.*,
         (1 + ytd_pct / 100.0) as cf,
         lag(1 + ytd_pct / 100.0, 1)    over w as cf_1,
         lag(1 + ytd_pct / 100.0, 5)    over w as cf_5,
         lag(1 + ytd_pct / 100.0, 21)   over w as cf_21,
         lag(1 + ytd_pct / 100.0, 126)  over w as cf_126,
         lag(1 + ytd_pct / 100.0, 252)  over w as cf_252,
         lag(1 + ytd_pct / 100.0, 1260) over w as cf_1260,
         first_value(1 + ytd_pct / 100.0) over w as cf_first,
         first_value(1 + ytd_pct / 100.0) over (
           partition by strategy_id, date_trunc('month', as_of_date::timestamp)
           order by as_of_date
           rows between unbounded preceding and unbounded following
         ) as cf_month_first
    from unified u
  window w as (partition by strategy_id order by as_of_date)
)
select
  strategy_id,
  as_of_date,
  value_cents                          as basket_value_cents,
  value_cents                          as basket_value,   -- legacy alias (cents)
  ytd_pct,
  case when cf_1     is null or cf_1     = 0 then null else round(((cf / cf_1)     - 1) * 100, 6) end as "1d_pct",
  case when cf_5     is null or cf_5     = 0 then null else round(((cf / cf_5)     - 1) * 100, 6) end as "5d_pct",
  case when cf_21    is null or cf_21    = 0 then null else round(((cf / cf_21)    - 1) * 100, 6) end as "1m_pct",
  case when cf_month_first is null or cf_month_first = 0 then null
       else round(((cf / cf_month_first) - 1) * 100, 6) end as mtd_pct,
  case when cf_126   is null or cf_126   = 0 then null else round(((cf / cf_126)   - 1) * 100, 6) end as "6m_pct",
  case when cf_252   is null or cf_252   = 0 then null else round(((cf / cf_252)   - 1) * 100, 6) end as "1y_pct",
  case when cf_1260  is null or cf_1260  = 0 then null else round(((cf / cf_1260)  - 1) * 100, 6) end as "5y_pct",
  case when cf_first is null or cf_first = 0 then null else round(((cf / cf_first) - 1) * 100, 6) end as all_pct,
  source_kind
from chained;

create view public.strategy_returns_effective_latest_c
with (security_invoker = false)
as
select distinct on (strategy_id) *
  from public.strategy_returns_effective_c
 order by strategy_id, as_of_date desc;

revoke all on public.strategy_returns_effective_c        from public;
revoke all on public.strategy_returns_effective_latest_c from public;
grant select on public.strategy_returns_effective_c        to anon, authenticated, service_role;
grant select on public.strategy_returns_effective_latest_c to anon, authenticated, service_role;

commit;

-- Verify (latest row per strategy):
-- select strategy_id, as_of_date, basket_value, ytd_pct, "1d_pct", "5d_pct",
--        "1m_pct", mtd_pct, "6m_pct", "1y_pct", "5y_pct", all_pct, source_kind
--   from public.strategy_returns_effective_latest_c
--  order by strategy_id;
