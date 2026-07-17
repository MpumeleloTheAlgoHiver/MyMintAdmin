# Final strategy and security repair — 2026-07-17

Execution window: after 21:30 Africa/Johannesburg.

## Non-negotiable safety rules

- No production writes before the execution window.
- Snapshot and verify row counts before changing any source table.
- Exclude UAT strategies and test profiles from the production correction.
- Do not change a strategy/client whose current result reconciles within tolerance.
- Price units are integer ZAc in database price tables; Yahoo `.JO` closes are ZAR. Convert exactly once.
- Intraday is the first source for a current scope check; official daily close is the backfill source.
- Derive historical composition from settled rebalance events and immutable before/after snapshots.
- A rebalance or liquidation is an internal value transfer, not an investment return.
- Complete NAV is securities + eligible cash + residual + unused reserve - liabilities.
- All corrected returns are written to shadow/staging tables first and reconciled before cutover.
- Existing workbook generators contain manual transition constants and are evidence-only, never production writers.

## Controlled flow

1. Confirm Yahoo has a final daily bar for every active `.JO` symbol.
2. Run `sql/backup_pre_final_market_fix_20260717.sql` and save its manifest result.
3. Export current securities, strategy returns and client returns with checksums.
4. Scope-check every security: `securities_c.last_price` vs latest intraday vs latest daily return.
5. Flag only missing, stale, scale-mismatched or discontinuous security rows.
6. Backfill flagged security dates into staging; verify currency/scale and daily continuity.
7. Reconstruct point-in-time strategy compositions from settled events/snapshots.
8. Compute chain-linked 1D, 5D, MTD, 1M and YTD in staging.
9. Reconstruct affected non-test client NAV using personal holdings, residual and unused reserve.
10. Reconcile staging against Yahoo, event cash conservation and the pre-fix snapshot.
11. Produce an approval table: old value, proposed value, delta, reason and evidence source.
12. Cut over only approved affected rows, then rerun CRM/app/OEM checks.
13. Keep the rollback schema and monitoring window intact.

## Required gates

- No symbol differs from Yahoo by approximately 100x.
- No unexplained price jump at the old-data/backfill boundary.
- Every rebalance satisfies opening NAV + external flow = closing NAV + fees/P&L treatment.
- Sold holdings stop contributing after settlement; their realized/cash value remains in complete NAV.
- Unaffected strategies remain byte-for-byte/row-for-row unchanged.
- CRM, client app and OEM agree for each repaired client and strategy.

## Evidence tools

- `scratch/create-pre-fix-evidence-backup.cjs`
- `scratch/generate-strategy-current-and-corrected-workbooks.cjs` (evidence only)
- `scratch/generate-all-current-system-workbooks.cjs` (evidence only)
- `BACKUP_AND_FIX_FLOW_20260716.md`

