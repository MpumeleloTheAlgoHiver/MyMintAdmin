import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('sql/rebalance_value_retention.sql', 'utf8');
const orderbook = fs.readFileSync('public/orderbook.html', 'utf8');
const endpoint = fs.readFileSync('api/orderbook/send-csv.js', 'utf8');

assert.match(migration, /holdings_snapshot_after jsonb/);
assert.match(migration, /strategy_rebalance_cash_events_c/);
assert.match(migration, /closing_balance_cents = opening_balance_cents \+ amount_cents/);
assert.match(migration, /apply_strategy_rebalance_cash_event/);
assert.match(migration, /for update/);
assert.match(orderbook, /holdings_snapshot_after: settledStrategy\?\.holdings \|\| null/);
assert.match(orderbook, /eventType: 'LIQUIDATION_PROCEEDS'/);
assert.match(endpoint, /rpc\/apply_strategy_rebalance_cash_event/);

console.log('8 rebalance value-retention assertions passed');
