import assert from 'node:assert/strict';
import fs from 'node:fs';

const orderbook = fs.readFileSync(new URL('../public/orderbook.html', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/orderbook/send-csv.js', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../sql/rebalance_settlement_checkpoint.sql', import.meta.url), 'utf8');

assert.match(sql, /settlement_state text not null default 'PENDING'/);
assert.match(sql, /'PENDING','PROCESSING','PAUSED','COMPLETE','REVERSED'/);
assert.match(api, /action === 'rebalance-settlement-claim'/);
assert.match(api, /status=eq\.PENDING&settlement_state=eq\./);
assert.match(api, /settlement_state: 'PROCESSING'/);
assert.match(api, /action === 'rebalance-settlement-pause'/);
assert.match(orderbook, /loadRebFeeConfigStrict\(settlementToken\)/);
assert.match(orderbook, /action=rebalance-settlement-claim/);
assert.match(orderbook, /action=rebalance-settlement-pause/);
assert.match(orderbook, /settlement_state: 'COMPLETE'/);
assert.match(orderbook, /settledSellQuery/);
assert.match(orderbook, /settledBuyQuery/);
assert.match(orderbook, /store_reference: `REBALANCE-/);

const claimAt = orderbook.indexOf('action=rebalance-settlement-claim');
const finalAt = orderbook.indexOf("status: 'SETTLED'", claimAt);
assert.ok(claimAt >= 0 && finalAt > claimAt, 'SETTLED must only appear in finalization after checkpoint claim');

console.log('rebalance settlement checkpoint: 14/14 green');
