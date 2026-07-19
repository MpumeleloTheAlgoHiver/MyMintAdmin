# Final returns and settlement handoff — 2026-07-19

## Non-negotiable architecture

- Yahoo/JSE prices are market inputs, not the stored return answer.
- `stock_holdings_c`, strategy residual cash, unused execution reserve and accrued liabilities build each owner's NAV.
- `client_strategy_return_publication_audit_c` is the append-only daily personal return chain.
- `strategy_return_publication_audit_c` is the append-only daily global strategy chain.
- `client_strategy_returns_effective_c` and `strategy_returns_effective_c` are the canonical read views. Do not point a UI back at the legacy tables.
- Rebalances preserve the chain through `rebalance_return_boundaries_c`; internal sells, buys, residual movements and reserve use are not investor contributions or withdrawals.

## Jobs

- Vercel schedule: `vercel.json`, `0 16 * * *` (18:00 Africa/Johannesburg).
- Entry point: `api/orderbook/cron-daily.js`.
- Global publisher: `api/_returns-publish.js`.
- Client publisher: `api/_client-returns-publish.js`.
- Production writes require the existing publication apply flags. Preview remains the safe default.
- Test exclusion must retain both checks: `profiles.is_test = true` and `wallets.status = 'test'`.

## New allocation rule

A new owner/strategy is seeded automatically at 0% only when every active holding was filled/created on the publication date and every linked transaction is posted and unreversed. Older unseeded accounts remain blocked with `no trusted return seed`; they are never silently reset.

## Settlement state machine

Deploy `sql/rebalance_settlement_checkpoint.sql` before the matching CRM code.

`rebalance_batch.status` remains the business status:

- `PENDING` until every write succeeds.
- `SETTLED` only after holdings, activity, reserve, residual, composition and return boundary succeed.
- `REVERSED` for a reversed batch.

`rebalance_batch.settlement_state` is the technical checkpoint:

- `PENDING` — ready.
- `PROCESSING` — atomically claimed; another browser cannot settle it.
- `PAUSED` — a write failed; the UI offers Resume Settlement.
- `COMPLETE` — final business status is Settled.
- `REVERSED` — no settlement allowed.

Fee configuration is loaded before the claim. Missing `rebCustodyFee` or `rebBrokerageRate` stops with zero writes. No R69 fallback exists. BUY and SELL legs are detected by batch/owner/security on resume; residual and reserve RPCs remain batch-idempotent; activity rows use `REBALANCE-<batch>-<owner>` references.

## Deployment order

1. Run `sql/rebalance_settlement_checkpoint.sql` in the Retail Supabase SQL editor.
2. Verify the query at the bottom of the coworker guide or inspect `rebalance_batch` columns.
3. Deploy CRM `main`.
4. Deploy the retail app `features/fees2` commit containing the approved-reader migration.
5. Run one UAT buy-only, one sell→buy and one liquidation. Upload actual broker fills.
6. Confirm the batch stays Pending/Paused on any induced failure and becomes Settled only at the end.
7. After the 18:00 SAST job, confirm publication audit rows and effective latest views advance by one date.

## Regression commands

```text
node tests/buy-only-settlement.test.mjs
node tests/rebalance-reserve-first.test.mjs
node tests/rebalance-value-retention.test.mjs
node tests/rebalance-return-boundary.test.mjs
node tests/rebalance-rules.test.mjs
node tests/rebalance-settlement-checkpoint.test.mjs
node tests/client-return-inception.test.mjs
node tests/canonical-investor-reader.test.mjs
node tests/canonical-return-views.test.mjs
```

Retail app: `npm run build`.

## Do not regress

- Never mark a batch Settled as a locking mechanism.
- Never hardcode fees or convert JSE cents twice.
- Never replace residual cash; apply an idempotent delta.
- Never recalculate old dates with today's holdings.
- Never count reserve/residual transfers as performance.
- Never let the retail browser read protected personal effective views directly; use `/api/returns/approved`.
- Never revive `client_strategy_returns_c` as a UI fallback.

