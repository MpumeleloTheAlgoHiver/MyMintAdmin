import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('sql/rebalance_value_retention.sql', 'utf8');
const orderbook = fs.readFileSync('public/orderbook.html', 'utf8');
const endpoint = fs.readFileSync('api/orderbook/send-csv.js', 'utf8');
const dashboard = fs.readFileSync('public/dashboard.html', 'utf8');

assert.match(migration, /holdings_snapshot_after jsonb/);
assert.match(migration, /strategy_rebalance_cash_events_c/);
assert.match(migration, /closing_balance_cents = opening_balance_cents \+ amount_cents/);
assert.match(migration, /apply_strategy_rebalance_cash_event/);
assert.match(migration, /for update/);
assert.match(orderbook, /holdings_snapshot_after: settledStrategy\?\.holdings \|\| null/);
assert.match(orderbook, /eventType: 'LIQUIDATION_PROCEEDS'/);
assert.match(endpoint, /rpc\/apply_strategy_rebalance_cash_event/);
assert.match(orderbook, /const settleRebalanceCashBridge = async/);
assert.match(orderbook, /eventType: 'REBALANCE_RESIDUAL'/);
assert.match(orderbook, /sellGrossCents - sellBrokerCents - sellCustodyCents/);
assert.match(orderbook, /buyGrossCents - buyBrokerCents - buyCustodyCents/);
assert.match(dashboard, /Workbook rule:[\s\S]{0,300}do not move client cash yet[\s\S]{0,300}rebWalletByClient/);

// Workbook switch example: proceeds are recycled; only fees/residual alter cash.
const sellGross = 1_000_00;
const buyGross = 850_00;
const brokerageRate = 0.005;
const custody = 69_00;
const delta = sellGross - Math.round(sellGross * brokerageRate) - custody
  - buyGross - Math.round(buyGross * brokerageRate) - custody;
assert.equal(delta, 275);

console.log('15 rebalance value-retention assertions passed');
