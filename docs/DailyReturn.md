# Daily Return — Data Pipeline & Display Reference

## Overview

This document describes how daily return figures are sourced, stored, and displayed throughout the Mint CRM admin portal. Use this as the starting point when debugging or extending any daily-return feature.

---

## 1. Strategy Card Daily Return

### Where it shows
The "Daily return" row on each strategy card in the Strategies tab (and the `renderTopAssetsRow` function).

### How it works
The frontend reads `strategies_returns_c.1d_pct` for the **latest `as_of_date`** per strategy, via `fetchStrategyReturns()`:

```js
// dashboard.html — fetchStrategyReturns()
const stratRet = strategyReturnsMap.get(String(strategy.id));
const dailyReturn = stratRet?.['1d_pct'] != null ? Number(stratRet['1d_pct']) : null;
```

There is **no fallback**. If `1d_pct` is `null` for the latest date row, the card shows `—`.

### Current status (confirmed 2026-06-18)
`strategies_returns_c.1d_pct` is `null` for **all strategies** on the latest date. The data pipeline only populates `ytd_pct` and longer-period returns — it does not yet calculate or write `1d_pct`.

### Fix options
**Option A — Update the data pipeline (recommended):**
In whatever job writes to `strategies_returns_c`, add a `1d_pct` calculation:
```
1d_pct = (basket_value_today - basket_value_yesterday) / basket_value_yesterday * 100
```
Store as a **percentage value** (e.g. `1.75` = 1.75%). Other period columns (`ytd_pct`, etc.) follow the same convention.

**Option B — Frontend fallback:**
Calculate a weighted average from holdings intraday data when `1d_pct` is null:
```
strategy_1d_pct = Σ (holding_weight × stock_intraday_c.1d_pct)
```
where `holding_weight = (avg_fill_cents × quantity) / basket_value_cents`.

---

## 2. Top Gainers / Top Losers Panel

### Where it shows
Right panel of the dashboard overview — "Return Insights" section. Has tab buttons: 1D | 5D | 1M | 6M | YTD | 1Y | 5Y | All.

### Data sources by tab

| Tab | Source table | Column | Notes |
|-----|-------------|--------|-------|
| 1D  | `stock_intraday_c` | `1d_pct` | Live tick; latest row per security |
| 5D  | `stock_returns_c`  | `5d_pct` | End-of-day snapshot |
| 1M  | `stock_returns_c`  | `1m_pct` | End-of-day snapshot |
| 6M  | `stock_returns_c`  | `6m_pct` | End-of-day snapshot |
| YTD | `stock_returns_c`  | `ytd_pct` | End-of-day snapshot |
| 1Y  | `stock_returns_c`  | `1y_pct` | End-of-day snapshot |
| 5Y  | `stock_returns_c`  | `5y_pct` | End-of-day snapshot |
| All | `stock_returns_c`  | `all_pct` | End-of-day snapshot |

### Unit convention (critical)
All `_pct` columns in both tables are stored as **percentage values**, not decimals:
- `1.7877` = **+1.79%** ✓ (correct, reasonable for JSE stock daily move)
- `14.9124` = **+14.91%** ✓ (reasonable YTD for JSE)

The frontend displays them directly via `val.toFixed(2) + '%'` — no multiplication.

**If a column appears inflated**, check whether the data pipeline is accidentally multiplying by 100 before writing (e.g. writing `0.45 × 100 = 45` instead of `0.45`, resulting in `4500%` display).

### Known issue — inflation on non-1D tabs
`stock_returns_c.1d_pct` stores values consistently (e.g. `-0.069` for ABG.JO = -0.07%). However, if the **data pipeline for a specific period column** (e.g. `ytd_pct`) writes raw decimal fractions (e.g. `0.149` instead of `14.91`), those stocks will display as nearly flat. Conversely, if it writes basis points (e.g. `1491` for 14.91%), they will display as massively inflated.

Run this query to audit unit consistency across periods:
```sql
SELECT symbol, "1d_pct", "5d_pct", "1m_pct", ytd_pct, "1y_pct"
FROM stock_returns_c
WHERE as_of_date = (SELECT MAX(as_of_date) FROM stock_returns_c)
ORDER BY ytd_pct DESC
LIMIT 20;
```
All columns should be in the same unit range (e.g. daily moves 0.1–5%, YTD moves 1–50%).

---

## 3. Key Functions (dashboard.html)

| Function | Purpose |
|----------|---------|
| `fetchStrategyReturns(ids)` | Loads latest `strategies_returns_c` row per strategy → `strategyReturnsMap` |
| `fetchStockReturnsBySec(secIds)` | Loads latest `stock_returns_c` row per security → used to build `_returnInsightsData` |
| `fetchIntradayBySec(secIds)` | Loads latest `stock_intraday_c` row per security → `_riIntradayMap` |
| `loadStrategyYtd()` | Calls `fetchStrategyReturns`, populates `strategyReturnsMap` & `strategyYtdMap` |
| `_renderReturnInsights(tab)` | Renders the top gainers/losers panel for the selected time-period tab |
| `renderTopAssetsRow()` | Renders the scrollable strategy card row; reads `strategyReturnsMap` for daily/YTD |

---

## 4. Database Tables Reference

### `strategies_returns_c`
One row per strategy per date. Populated by the external data pipeline.
- `strategy_id` — FK to `strategies_c.id`
- `as_of_date` — snapshot date
- `1d_pct` — **currently null** — daily basket return (%)
- `ytd_pct` — year-to-date basket return (%)
- `basket_value` — total basket value in cents

### `stock_returns_c`
One row per security per date. Populated by the external data pipeline.
- `security_id` — FK to `securities_c.id`
- `symbol` — JSE ticker
- `as_of_date` — snapshot date
- `1d_pct`, `5d_pct`, `1m_pct`, `6m_pct`, `ytd_pct`, `1y_pct`, `5y_pct`, `all_pct` — all in **% form**

### `stock_intraday_c`
Multiple rows per security per day (tick data). Queried by most-recent timestamp.
- `security_id` — FK to `securities_c.id`
- `symbol` — JSE ticker
- `current_price` — price in **cents** (divide by 100 to get Rand)
- `1d_abs` — absolute day change in **cents**
- `1d_pct` — percentage day change (already in %, e.g. `-0.73` = -0.73%)
- `timestamp` — tick timestamp

---

## 5. Checklist for next migration / import

When bringing this project into a new Replit environment:

1. Set `SUPABASE_URL` env var (non-secret, already in `.replit` userenv)
2. Set `SUPABASE_SERVICE_ROLE_KEY` as a **secret**
3. Set `RESEND_API_KEY` as a **secret** (for email features)
4. Set `SUMSUB_APP_TOKEN` and `SUMSUB_APP_SECRET` as **secrets** (for KYC)
5. Run `npm install` (only `dotenv` and `pg` are dependencies)
6. Start with `node server.js` on port 5000
7. To fix strategy card daily return: populate `strategies_returns_c.1d_pct` in the data pipeline
