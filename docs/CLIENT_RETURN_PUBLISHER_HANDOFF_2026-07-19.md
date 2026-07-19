# Client Return Publisher — Handoff (2026-07-19)

## Current state

The rebalance-aware strategy return chain and the guarded per-client strategy
return chain are live. CRM readers use the effective views; no production legacy
history was rewritten.

Relevant commits:

- `00f7fd0` — settlement hard-halts when saved rebalance fees cannot be loaded;
  no R69 fallback is permitted.
- `e373783` — consolidated strategy/client effective return views.
- `3a6c0f1` — guarded daily client return publisher and cron integration.

SQL already deployed in Supabase:

1. `sql/client_return_publication_guard.sql`
2. `sql/effective_return_views_v2.sql` (rerun after the guard migration)

Vercel Production setting reported enabled by Mpumelelo:

```text
CLIENT_RETURNS_PUBLISH_APPLY=1
```

These must remain unset or `0` in Production unless explicitly testing UAT:

```text
CLIENT_RETURNS_INCLUDE_UAT=0
CLIENT_RETURNS_INCLUDE_TEST=0
```

The scheduled endpoint is `/api/orderbook/cron-daily`, configured in
`vercel.json` for `0 16 * * *` (18:00 SAST).

## Initial publication proof

The approved initial publication for `2026-07-19` wrote six genuine
owner-strategy rows:

- audit rows: 6
- effective latest rows: 6
- invalid accounting identities: 0
- test-account rows: 0
- duplicate rows on an immediate second apply: 0 (all six skipped)

Key repaired clients were preserved exactly at the handoff:

| Client | Strategy | Complete NAV | Gross TWR / displayed YTD |
|---|---|---:|---:|
| Rufaro Mapanda | Yield Basket | R6,847.37 | +0.7363788314% |
| Kgomotso Maphai | Yield Basket | R2,335.93 | -4.9032270762% |

Both now resolve through `client_strategy_returns_effective_latest_c` with
`source_kind = 'GUARDED_CLIENT_PUBLICATION'`.

## Accounting contract — do not weaken

Every client publication must satisfy:

```text
performance_nav_cents
  = securities_value_cents
  + residual_cash_cents
  + unused_reserve_cents

complete_nav_cents
  = performance_nav_cents
  - accrued_liability_cents

gross_strategy_twr_pct
  = (chain_factor - 1) * 100
```

Normal-day gross performance is cash-neutral:

```text
daily factor
  = (current securities + previous residual + previous unused reserve)
    / previous performance NAV
```

This prevents deposits, residual movements, reserve movements and fee funding
from being reported as market performance. The current cash amounts still become
the next day's valuation basis.

Composition changes are rejected unless a settled rebalance batch is found.
At a valid rebalance boundary the prior chain factor is preserved; the new actual
holdings become the forward basis. Missing prices, stale prices, incomplete
coverage, negative NAV, broken identities and unexplained composition changes
must fail closed and publish nothing.

## Test/UAT exclusion — do not simplify

Production publication excludes test owners using both existing CRM classifiers:

- `profiles.is_test = true`
- `wallets.status = 'test'`

Both sources are required and the publisher fails closed if they cannot be read.
This is necessary because Tsie is identified through the test wallet even though
his profile currently has `is_test = false`.

## Important files

- `api/_client-returns-publish.js` — read/plan/apply publisher.
- `api/orderbook/cron-daily.js` — strategy publication followed by client publication.
- `sql/client_return_publication_guard.sql` — immutable audit table and guarded RPC.
- `sql/effective_return_views_v2.sql` — single strategy/client reader contract.
- `tests/client-return-publication.test.mjs` — cash-neutral and structural checks.
- `tests/rebalance-return-boundary.test.mjs`
- `tests/strategy-return-publication-guard.test.mjs`

Run before changing this area:

```text
node tests/client-return-publication.test.mjs
node tests/rebalance-return-boundary.test.mjs
node tests/strategy-return-publication-guard.test.mjs
```

## Next checkpoint

Do not change formulas immediately after this handoff. First inspect the first
publication after a fresh market-price day. It must use
`mode = 'market-chain-cash-neutral'` and have a non-null `daily_pct`.

Verify:

1. exactly one row per genuine owner/strategy/date;
2. Rufaro and Kgomotso chain from the values above rather than resetting;
3. cash/reserve changes do not enter `daily_pct`;
4. audit identities remain exact;
5. effective latest rows use `GUARDED_CLIENT_PUBLICATION`;
6. no UAT/test owners appear;
7. a same-date retry skips without mutation.

Only after that verification should this track be considered fully observed in
nightly production. A future enhancement may add a CRM Repair-tab monitor for
publication status, failures and guarded manual reruns; it must call the same
publisher/RPC rather than introduce parallel return math.
