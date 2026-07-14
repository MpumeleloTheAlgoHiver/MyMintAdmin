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
const replaceHoldingFn = dashboard.slice(
  dashboard.indexOf('async function rebReplaceStrategyHoldingAfterBuy'),
  dashboard.indexOf('async function rebPersistCommittedTradeSequence'),
);
assert.match(replaceHoldingFn, /rebalance-update-strategy-holdings/, 'ordinary rebalances must update composition through the service endpoint');
assert.doesNotMatch(replaceHoldingFn, /\.from\("strategies_c"\)[\s\S]*?\.update\(/, 'ordinary rebalance composition must not write through browser RLS');
assert.match(endpoint, /action === 'rebalance-update-strategy-holdings'[\s\S]*?requirePermission\(req, res, 'dashboard', 'commit_rebalance'\)/, 'composition endpoint must retain the rebalance permission gate');

// Workbook switch example: proceeds are recycled; only fees/residual alter cash.
const sellGross = 1_000_00;
const buyGross = 850_00;
const brokerageRate = 0.005;
const custody = 69_00;
const delta = sellGross - Math.round(sellGross * brokerageRate) - custody
  - buyGross - Math.round(buyGross * brokerageRate) - custody;
assert.equal(delta, 275);

console.log('18 rebalance value-retention assertions passed');
