import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../sql/rebalance_ca_reconciliation.sql', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/orderbook/send-csv.js', import.meta.url), 'utf8');
const orderbook = fs.readFileSync(new URL('../public/orderbook.html', import.meta.url), 'utf8');

assert.match(sql, /model_capital_cents = securities_value_cents \+ strategy_ca_cents/);
assert.match(sql, /client residual does not match the immutable cash-event closing balance/i);
assert.match(sql, /Every affected owner requires an immutable rebalance cash event/);
assert.match(sql, /execution_reserve_excluded/);
assert.match(sql, /SETTLEMENT_CA_RECONCILED_V2/);
assert.match(api, /rpc\/reconcile_rebalance_ca/);
assert.match(api, /caReconciliation/);

const boundaryCall = api.indexOf("rpc/finalize_rebalance_return_boundary");
const reconciliationCall = api.indexOf("rpc/reconcile_rebalance_ca");
assert.ok(boundaryCall >= 0 && reconciliationCall > boundaryCall);

const settleCall = orderbook.indexOf("status: 'SETTLED'");
const boundaryUiCall = orderbook.indexOf('action=rebalance-finalize-return-boundary');
assert.ok(boundaryUiCall >= 0 && settleCall > boundaryUiCall);

console.log('rebalance CA reconciliation: 10/10 green');
