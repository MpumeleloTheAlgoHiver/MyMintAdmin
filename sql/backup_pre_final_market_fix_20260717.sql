-- Immutable rollback snapshot immediately before the final security/return repair.
-- Run once after 21:30 SAST and before any production correction.

begin;

create schema if not exists backup_20260717_pre_final_market_fix;

create table if not exists backup_20260717_pre_final_market_fix.manifest (
  source_table text primary key,
  backup_table text not null,
  row_count bigint not null,
  captured_at timestamptz not null default now()
);

do $$
declare
  v_table text;
  v_count bigint;
  v_tables text[] := array[
    'securities_c', 'stock_intraday_c', 'stock_returns_c',
    'strategies_c', 'strategies_returns_c', 'client_strategy_returns_c',
    'profiles', 'family_members', 'stock_holdings_c', 'transactions',
    'strategy_rebalance_residuals', 'strategy_rebalance_cash_events_c',
    'strategy_rebalance_reserve_events_c', 'rebalance_batch', 'rebalance_event',
    'buffer_drawdowns_c', 'strategy_aum_fee_state', 'aum_fee_transactions',
    'aum_fee_accrual_segments'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise notice 'Skipping missing public.%', v_table;
      continue;
    end if;
    if to_regclass(format('backup_20260717_pre_final_market_fix.%I', v_table)) is null then
      execute format('create table backup_20260717_pre_final_market_fix.%I as table public.%I', v_table, v_table);
    end if;
    execute format('select count(*) from backup_20260717_pre_final_market_fix.%I', v_table) into v_count;
    insert into backup_20260717_pre_final_market_fix.manifest(source_table, backup_table, row_count)
    values(v_table, format('backup_20260717_pre_final_market_fix.%I', v_table), v_count)
    on conflict(source_table) do nothing;
  end loop;
end $$;

revoke all on schema backup_20260717_pre_final_market_fix from anon, authenticated;
revoke all on all tables in schema backup_20260717_pre_final_market_fix from anon, authenticated;

commit;

select * from backup_20260717_pre_final_market_fix.manifest order by source_table;

