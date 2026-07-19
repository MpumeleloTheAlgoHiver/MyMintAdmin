-- Correct UAT batch 47486d08 after its one-time recovery used the obsolete
-- R69 custody fallback instead of the configured R25 custody fee.
-- Expected correction: reserve +R3.12, residual +R84.88.

begin;

do $$
declare
  v_batch_id constant uuid := '47486d08-97e6-4572-8613-ccf8dd704826';
  v_strategy_id constant uuid := '26daf728-8e95-4ff0-b9e7-69b382b0bb8c';
  v_user_id constant uuid := 'b215eb9a-4017-45f1-a460-6056b1db0c4d';
  v_transaction_id constant uuid := 'c67c7c21-0ee6-4107-b73a-86752b5eb59e';
  v_reserve_event_id constant uuid := 'b94f342c-3862-4826-b45f-9884a6dcef8b';
  v_correct_fee_cents constant bigint := 5144;
  v_reserve_refund_cents constant bigint := 312;
  v_residual_refund_cents constant bigint := 8488;
  v_now timestamptz := now();
begin
  -- If the correction event exists, this script already completed.
  if exists (
    select 1 from public.strategy_rebalance_cash_events_c
     where batch_id = v_batch_id and strategy_id = v_strategy_id
       and user_id = v_user_id and family_member_id is null
       and event_type = 'MANUAL_CORRECTION'
  ) then return; end if;

  if not exists (
    select 1 from public.app_settings
     where key = 'fees' and (value->>'rebCustodyFee')::numeric = 25
  ) then raise exception 'Configured rebalance custody fee is not R25'; end if;

  if not exists (
    select 1 from public.strategy_rebalance_reserve_events_c
     where id = v_reserve_event_id and batch_id = v_batch_id
       and requested_cents = 13944 and consumed_cents = 5456
       and shortfall_cents = 8488 and reserve_after_cents = 0
  ) then raise exception 'Reserve event no longer matches the known overcharge'; end if;

  if not exists (
    select 1 from public.transactions
     where id = v_transaction_id and buffer_cents = 5456
       and buffer_consumed_cents = 5456 and status::text = 'posted'
       and coalesce(reversed, false) = false
  ) then raise exception 'Reserve source transaction no longer matches the known state'; end if;

  if not exists (
    select 1 from public.strategy_rebalance_residuals
     where strategy_id = v_strategy_id and user_id = v_user_id
       and family_member_id is null and balance_cents = 846
  ) then raise exception 'Residual balance no longer matches the known overcharged state'; end if;

  update public.transactions
     set buffer_consumed_cents = v_correct_fee_cents, updated_at = v_now
   where id = v_transaction_id;

  update public.strategy_rebalance_reserve_events_c
     set requested_cents = v_correct_fee_cents,
         consumed_cents = v_correct_fee_cents,
         shortfall_cents = 0,
         reserve_after_cents = v_reserve_refund_cents,
         metadata = metadata || jsonb_build_object(
           'corrected_at', v_now,
           'correction_reason', 'Configured custody was R25, not obsolete R69 fallback',
           'original_requested_cents', 13944,
           'corrected_requested_cents', v_correct_fee_cents,
           'reserve_refund_cents', v_reserve_refund_cents
         )
   where id = v_reserve_event_id;

  perform public.apply_strategy_rebalance_cash_event(
    v_batch_id, v_strategy_id, v_user_id, null,
    'MANUAL_CORRECTION', v_residual_refund_cents, v_now,
    jsonb_build_object(
      'reason', 'Correct obsolete R69 custody fallback to configured R25',
      'original_custody_per_side_cents', 6900,
      'correct_custody_per_side_cents', 2500,
      'residual_refund_cents', v_residual_refund_cents,
      'reserve_refund_cents', v_reserve_refund_cents
    )
  );
end;
$$;

commit;

select requested_cents, consumed_cents, shortfall_cents,
       reserve_before_cents, reserve_after_cents, metadata
  from public.strategy_rebalance_reserve_events_c
 where batch_id = '47486d08-97e6-4572-8613-ccf8dd704826'::uuid;

select event_type, opening_balance_cents, amount_cents, closing_balance_cents
  from public.strategy_rebalance_cash_events_c
 where batch_id = '47486d08-97e6-4572-8613-ccf8dd704826'::uuid
 order by created_at;
