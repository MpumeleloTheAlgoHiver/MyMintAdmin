# How portfolio values display

This is the plain-language map for operations, finance and management.

## What the client owns today

| Display | Meaning | Main source |
|---|---|---|
| Holdings | Current shares × latest valid JSE price | `stock_holdings_c` + `stock_intraday_c` / `securities_c` |
| Residual | Cash left inside that specific client and strategy after actual rebalance fills or liquidation | `strategy_rebalance_residuals` |
| Reserve | Unused part of the original 8% execution reserve | `transactions.buffer_cents - buffer_consumed_cents` |
| Accrued fee | Earned AUM fee not yet settled; shown separately | `aum_fee_accrual_segments` |
| Performance NAV | Holdings + residual + unused reserve | daily client publication audit |
| Complete value | Performance NAV − accrued liability | `client_strategy_returns_effective_c.basket_value_cents` |

Cash is scoped by user, child (if any) and strategy. Kgomotso's Yield cash cannot overwrite her ETF cash; a parent's cash cannot become a child's cash.

## Return and P&L

YTD and inception return are time-weighted strategy performance. They answer: “How did the invested strategy perform?” They exclude deposits, withdrawals and internal rebalance cash movements.

Normal day:

`daily return = (today's securities + yesterday's residual + yesterday's unused reserve) / yesterday's performance NAV − 1`

The daily factors are chained. A sell→buy, buy-only rebalance or liquidation writes a return boundary, so the percentage earned before the trade is retained and tomorrow continues from the new holdings. The sale itself is not a loss.

Displayed strategy P&L is the chained performance amount, derived from the opening performance NAV and the time-weighted return. Accrued platform fees are displayed separately and do not masquerade as poor market performance.

## Where each screen reads

| Screen | Approved source |
|---|---|
| CRM Investors and personal charts | `client_strategy_returns_effective_c` through `api/investors/data.js` |
| CRM strategy cards/factsheets | `strategy_returns_effective_c` |
| Retail app strategy list, purple balance card, personal charts, period tabs and child views | authenticated `/api/returns/approved` |
| Repair history | promoted shadow rows before publication, guarded audit rows after publication; the effective view joins them into one timeline |

The old `client_strategy_returns_c` table remains historical evidence. It is not an approved display source.

## Why YTD can differ from all-time

All-time starts on the client's first investment date. YTD starts at the beginning of the current calendar year. For a client who invested during the current year they may initially be equal; for an older investment they normally differ. A difference is not automatically a bug.

## When values update

- Holdings may move intraday as valid prices update.
- Official personal and strategy return chains publish after market close through the 18:00 SAST guarded job.
- A newly filled allocation starts at 0% on its first publication day, then earns market return from the next daily link.
- A failed publication leaves the previous approved value visible; it does not publish a guessed number.

## Rebalance safety visible to staff

- Pending: broker fill has not been completely applied.
- Settling: one admin session owns the checkpoint.
- Settlement paused: something failed; the batch is not falsely complete and can be resumed.
- Settled: holdings, cash, reserve and return boundary all succeeded.

The configured App Settings custody and brokerage fees are used. If they cannot be read, settlement stops before changing client money.

## Daily control checks

1. Prices are fresh and within the cents/rands sanity range.
2. No production publication includes a test wallet/profile.
3. Every composition change has a settled return boundary.
4. Complete value reconciles to holdings + residual + reserve − liability.
5. Latest effective rows have today's business date after the close job.
6. Any paused settlement is investigated and resumed; never manually flip it to Settled.

