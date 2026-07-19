-- Complete the cash/return stages of UAT batch 47486d08 after its holdings
-- settled but the original enum bug paused the cash bridge.
-- Atomic and idempotent: any failed precondition rolls back every write.

begin;

do $$
declare
  v_batch_id constant uuid := '47486d08-97e6-4572-8613-ccf8dd704826';
  v_strategy_id constant uuid := '26daf728-8e95-4ff0-b9e7-69b382b0bb8c';
  v_user_id constant uuid := 'b215eb9a-4017-45f1-a460-6056b1db0c4d';
  v_actor constant uuid := 'd3f65e83-0f29-4b1e-9351-46943756de45';
  v_requested_fees_cents constant bigint := 13944;
  v_sell_gross_cents constant bigint := 16562;
  v_buy_gross_cents constant bigint := 12104;
  v_securities_value_cents constant bigint := 49095;
  v_batch public.rebalance_batch%rowtype;
  v_holdings jsonb;
  v_reserve jsonb;
  v_consumed bigint;
  v_shortfall bigint;
  v_cash_delta bigint;
  v_now timestamptz := now();
begin
  select * into v_batch
    from public.rebalance_batch
   where id = v_batch_id
   for update;

  if not found then raise exception 'Expected UAT batch does not exist'; end if;
  if v_batch.strategy_id <> v_strategy_id then raise exception 'Batch strategy mismatch'; end if;
  if coalesce(v_batch.is_reversed, false) then raise exception 'Batch is reversed'; end if;

  -- A populated settled_at means a previous run already completed everything.
  if v_batch.settled_at is not null then return; end if;

  if not exists (
    select 1 from public.rebalance_event
     where batch_id = v_batch_id and user_id = v_user_id
       and trade_side = 'SELL' and security_id = '45a90857-cefa-4db0-bd49-83cca0b5a452'::uuid
       and quantity = 1 and avg_fill = 16562 and fill_date = date '2026-07-19'
  ) then raise exception 'ARI sell fill is not fully applied'; end if;

  if not exists (
    select 1 from public.rebalance_event e
    join public.stock_holdings_c h on h.id = e.settled_holding_id
     where e.batch_id = v_batch_id and e.user_id = v_user_id
       and e.trade_side = 'BUY' and e.security_id = '8e0a0ab7-c88d-4e31-b514-6fbfaa1c4322'::uuid
       and e.quantity = 2 and e.avg_fill = 6052
       and h.is_active = true and h.quantity = 2 and h.avg_fill = 6052
  ) then raise exception 'HYP buy holding is not fully applied'; end if;

  select holdings into v_holdings
    from public.strategies_c
   where id = v_strategy_id;
  if v_holdings is null or jsonb_array_length(v_holdings) <> 5 then
    raise exception 'Unexpected post-rebalance strategy composition';
  end if;

  v_reserve := public.apply_rebalance_reserve_charge(
    v_batch_id, v_strategy_id, v_user_id, null,
    v_requested_fees_cents, v_now,
    jsonb_build_object(
      'repair', 'RESUME_PAUSED_SETTLEMENT',
      'sell_gross_cents', v_sell_gross_cents,
      'buy_gross_cents', v_buy_gross_cents,
      'requested_fee_cents', v_requested_fees_cents
    )
  );
  v_consumed := coalesce((v_reserve->>'consumed_cents')::bigint, 0);
  v_shortfall := v_requested_fees_cents - v_consumed;
  v_cash_delta := v_sell_gross_cents - v_buy_gross_cents - v_shortfall;

  perform public.apply_strategy_rebalance_cash_event(
    v_batch_id, v_strategy_id, v_user_id, null,
    'REBALANCE_RESIDUAL', v_cash_delta, v_now,
    jsonb_build_object(
      'repair', 'RESUME_PAUSED_SETTLEMENT',
      'sell_gross_cents', v_sell_gross_cents,
      'buy_gross_cents', v_buy_gross_cents,
      'requested_fee_cents', v_requested_fees_cents,
      'reserve_consumed_cents', v_consumed,
      'fee_shortfall_cents', v_shortfall
    )
  );

  perform public.finalize_rebalance_return_boundary(
    v_batch_id, v_securities_value_cents, v_holdings,
    v_now, v_now, v_actor
  );

  update public.rebalance_batch
     set status = 'SETTLED', settled_at = v_now, settled_by = v_actor,
         settlement_effective_at = v_now, holdings_snapshot_after = v_holdings,
         updated_at = v_now
   where id = v_batch_id;
end;
$$;

commit;

select id, status, settled_at, settlement_effective_at,
       holdings_snapshot_after is not null as has_after_snapshot
  from public.rebalance_batch
 where id = '47486d08-97e6-4572-8613-ccf8dd704826'::uuid;

select requested_cents, consumed_cents, shortfall_cents,
       reserve_before_cents, reserve_after_cents
  from public.strategy_rebalance_reserve_events_c
 where batch_id = '47486d08-97e6-4572-8613-ccf8dd704826'::uuid;

select opening_balance_cents, amount_cents, closing_balance_cents
  from public.strategy_rebalance_cash_events_c
 where batch_id = '47486d08-97e6-4572-8613-ccf8dd704826'::uuid;
