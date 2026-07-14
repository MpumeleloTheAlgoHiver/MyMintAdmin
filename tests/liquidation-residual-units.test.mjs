import fs from 'node:fs';
import assert from 'node:assert/strict';

const orderbook = fs.readFileSync('public/orderbook.html', 'utf8');
const dashboard = fs.readFileSync('public/dashboard.html', 'utf8');
const endpoint = fs.readFileSync('api/orderbook/send-csv.js', 'utf8');

assert.match(orderbook, /residualDeltasCentsByUser/, 'settlement must send explicit cent deltas');
assert.doesNotMatch(orderbook, /priorRands \* 100 \+ creditCents/, 'settlement must not replace from a stale batch snapshot');
assert.match(endpoint, /hasExplicitCents/, 'endpoint must distinguish cents from legacy rands');
assert.match(endpoint, /\(hasExplicitCents \|\| hasDeltasCents\)\s*\?\s*Math\.round\(Number\(balance\)/, 'explicit cents must not be multiplied by 100');
assert.match(endpoint, /rpc\/apply_strategy_rebalance_cash_event/, 'settlement must apply the delta through the atomic cash-ledger RPC');
assert.match(dashboard, /acc\[item\.userId\] = item\.floorCents \/ 100/, 'client allocations must leave the helper in rands');
assert.match(dashboard, /const mainResidual = Number\(residualSplitAfterMain\[userId\] \|\| 0\)/, 'wallet preview must not divide rand allocations twice');
assert.match(dashboard, /const affectedClients = clients;/, 'sale preview must use selected-instrument holders');
assert.match(dashboard, /rebDistributeMoneyByLots\(sellExec\.netProceeds, affectedClients\)/, 'sale proceeds must use selected-instrument weights');
assert.match(orderbook, /isLiquidation: !b\.buy_isin_code && !b\.extra_buy_isin_code/, 'sell-only batches must be classified as liquidations');
assert.match(orderbook, /const operationLabel = isLiquidation \? 'Liquidation' : 'Rebalance'/, 'liquidations need their own orderbook label');
assert.match(orderbook, /const destinationLabel = isLiquidation \? 'Cash' : sb\.buyIsin/, 'liquidation destination must display as Cash');

const distributeRands = (totalAmount, weights) => {
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const totalCents = Math.round(totalAmount * 100);
  return weights.map((value) => Math.floor(totalCents * value / totalWeight) / 100);
};
assert.deepEqual(distributeRands(96.50, [5]), [96.50], 'R96.50 must never become R9,650');

const fillRands = 215.51;
const totalGross = fillRands * 3;
const actualNetCents = Math.round((totalGross * (1 - 0.005) - 34.5 * 2) * 100);
assert.equal(actualNetCents, 57430);
assert.equal(Math.round(actualNetCents / 3), 19143);

console.log('15 liquidation residual unit assertions passed');
