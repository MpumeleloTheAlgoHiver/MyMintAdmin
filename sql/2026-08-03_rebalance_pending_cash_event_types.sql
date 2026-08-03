-- Pending rebalance/liquidation commits move exact unfilled-order principal
-- and sub-share residuals into strategy CA before broker settlement. These
-- event types are deliberately distinct from actual-fill settlement events so
-- the immutable batch/owner/type idempotency key cannot suppress either leg.

begin;

alter table public.strategy_rebalance_cash_events_c
  drop constraint if exists strategy_rebalance_cash_events_c_event_type_check;

alter table public.strategy_rebalance_cash_events_c
  add constraint strategy_rebalance_cash_events_c_event_type_check
  check (
    event_type in (
      'LIQUIDATION_PROCEEDS',
      'REBALANCE_RESIDUAL',
      'WALLET_BUY',
      'REVERSAL',
      'MANUAL_CORRECTION',
      'PENDING_REBALANCE_RESIDUAL',
      'PENDING_REBALANCE_RESIDUAL_ROLLBACK',
      'PENDING_LIQUIDATION_PRINCIPAL',
      'PENDING_LIQUIDATION_PRINCIPAL_ROLLBACK',
      'PENDING_ADJUSTMENT_REVERSAL'
    )
  );

commit;

notify pgrst, 'reload schema';
