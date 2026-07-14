# Rebalance Hardening — Working Checklist

Living tracker for aligning MINT's rebalance engine with the
**MINT Returns Engine – Rebalance Clarity v7.1** workbook.
Plain-English background: `Downloads/MINT_Rebalancing_Explained.docx`.

**Legend:** ✅ Have · 🟡 Partial · 🔴 Missing · 🎯 Done this effort

Update the status + "Last touched" whenever we finish a step. Dry tests live in
[`tests/rebalance-rules.test.mjs`](../tests/rebalance-rules.test.mjs) — run with
`node tests/rebalance-rules.test.mjs`.

---

## Status board

| # | Capability | Status | Tests | Notes |
|---|---|---|---|---|
| 1 | **Legs, not pooling** — each buy is its own row | ✅ Have | structural | `stock_holdings_c`, one row per purchase |
| 2 | **New leg on rebalance** — never rewrite a live leg | 🎯 Done | logic + structural | Partial sell now splits: close sold sub-leg + reissue remainder at original entry. `orderbook.html executeFillAndSettle` |
| 3 | **Sold-out keeps realised profit** | ✅ Have | logic | `is_active=false` + `avg_exit`; app reads `(avg_exit−avg_fill)×qty` |
| 4 | **Recycled cash / leftover pot** | ✅ Have | — | `strategy_rebalance_residuals` |
| 5 | **Client's true cost basis** | ✅ Have | — | `Expected_fill` preferred over `avg_fill` |
| 6 | **Fresh daily security prices** | 🎯 Done | manual | Daily spine = `stock_returns_c` (cents). Fixed onConflict/constraint bug (was failing since 2026-06-02), backfilled 1yr, self-healing EOD writer. **+ 2026-07-13:** normalized 5,328 mis-scaled rows (Yahoo quotes some JSE symbols in RANDS) + `normalizeYahooCloseCents` guard + recomputed returns job (fake +49% YTD → true values). See [[price-units-returns-pipeline]]. ⚠️ **OPEN follow-up:** live `stock_intraday_c` + `securities_c.last_price` are ~10× high for STX500 (and likely other feeder ETFs) — the app's live P&L shows +842% on STX500; needs an intraday-feed unit fix. |
| 7 | **Date-gated client eligibility** | 🎯 Done | logic + structural | `Fill_date ≤ effective_date` gate; `effective_date` on all 3 batch inserts; UI date input. Needs `sql/rebalance_effective_date.sql` (✅ run 2026-07-10) |
| 8 | **"Can we execute this sell?" guard** | 🎯 Done | logic + structural | Blocks if `soldQty > heldQty` (workbook `Can_Execute`) |
| 9 | **Funding-matches check** | 🔴 Missing | — | Assert `sell_value ≈ buy_value + residual` within a cent after a switch |
| 10 | **Per-leg starting point for returns** | 🟡 Partial | — | Confirm mid-period joiners aren't shown pre-entry returns (`MAX(entry, period_ref)`) |
| 11 | **Automatic checks after every rebalance** | 🔴 Missing | — | Port workbook tab 13 invariants into a post-settle harness that blocks a bad batch |
| 12 | **Client picks which batch to sell** | 🔴 Missing | — | Withdraw flow sells by strategy; workbook wants tranche choice |

---

## Suggested order of attack

1. **#6 Daily price feed** — foundation; nothing values correctly without it.
2. **#11 Checks harness** — highest safety-per-effort; make bad batches un-committable.
3. **#9 Funding reconciliation** — small, pairs with #11.
4. **#10 Per-leg return flooring** — verification pass, likely small fix.
5. **#12 Tranche-choice sells** — app-side feature, defer.

---

## `stock_returns_c` cleanup (later — sequence so nothing breaks)
1. Fix writers to upsert on `(symbol, as_of_date)` incl. `symbol`. ✅ done (index.cjs + eod-save.js).
2. Add a `(security_id, as_of_date)` unique constraint alongside the symbol one, migrate
   writers/readers to key off the stable FK `security_id`, then drop the symbol constraint.
3. Split the table: lean `security_daily_close (security_id, as_of_date, close_cents)` for the
   time-series spine; keep `stock_returns_c` for the returns snapshot (or a view). Rebalance
   valuation reads the lean table.
4. Rename digit-prefixed columns (`1d_pct` → `pct_1d`) once readers are updated.

## Changelog

- **2026-07-10** — #2, #7, #8 implemented (CRM only; app is read-only and auto-reflects).
  Migration `sql/rebalance_effective_date.sql` run in Supabase. Dry-test suite added.
- **2026-07-10** — #6: root-caused the stalled daily spine (wrong onConflict vs the real
  `(symbol,as_of_date)` constraint). Backfilled 1yr from Yahoo; fixed + self-healed the daily
  EOD writer (index.cjs) and eod-save.js. App logs stripped in prod build; dead 404 trigger removed.
- **2026-07-13** — #6 done: found Yahoo quotes some JSE symbols in RANDS → fake +49% strategy
  YTD. Added `normalizeYahooCloseCents` guard (returns job + EOD writer + backfill), fixed
  `computeAndSaveStrategyReturns` to price spine-first/intraday-first (not stale securities_c),
  repaired 5,328 price rows + 225 poisoned return rows (`server/repairPriceData.cjs`). Commit
  `1214c58e`. NEW open bug surfaced: live intraday feed has STX500 (+likely feeder ETFs) ~10× high.
