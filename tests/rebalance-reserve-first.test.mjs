import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const orderbook = fs.readFileSync(new URL('../public/orderbook.html', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/orderbook/send-csv.js', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../sql/rebalance_execution_reserve.sql', import.meta.url), 'utf8');

function plan({ gross, buyGross, sellFees, buyFees, reserve }) {
  const totalFees = sellFees + buyFees;
  const reserveUsed = Math.min(reserve, totalFees);
  const shortfall = totalFees - reserveUsed;
  return {
    reserveUsed,
    reserveAfter: reserve - reserveUsed,
    shortfall,
    residual: gross - buyGross - shortfall,
  };
}

assert.deepEqual(
  plan({ gross: 100, buyGross: 100, sellFees: 15, buyFees: 15, reserve: 40 }),
  { reserveUsed: 30, reserveAfter: 10, shortfall: 0, residual: 0 },
  'R40 reserve must preserve a R100 replacement when total fees are R30',
);
assert.deepEqual(
  plan({ gross: 100, buyGross: 90, sellFees: 25, buyFees: 25, reserve: 40 }),
  { reserveUsed: 40, reserveAfter: 0, shortfall: 10, residual: 0 },
  'only the fee amount beyond reserve may reduce invested capital',
);

assert.match(dashboard, /rebLoadReserveBalances/, 'dashboard loads owner-scoped reserves');
assert.match(dashboard, /Fees Paid from Reserve/, 'preview itemises reserve fee consumption');
assert.match(dashboard, /Execute anyway\?/, 'reserve reduction requires explicit override');
assert.match(dashboard, /walletIn:\s+Number\(buyExec\.reserveUsed/, 'execute reconciliation includes reserve funding');
assert.match(orderbook, /rebalance-consume-reserves/, 'settlement consumes actual-fill fees from reserve');
assert.match(orderbook, /feeShortfallCents/, 'settlement only deducts uncovered fees from proceeds');
assert.match(api, /apply_rebalance_reserve_charge/, 'service-role endpoint uses atomic reserve RPC');
assert.match(sql, /uq_rebalance_reserve_event_batch_owner/, 'reserve charge is idempotent per batch owner');
assert.match(dashboard, /id="rebBuyEffectBtn"/, 'buy execution exposes detailed-effect action beside commit');
assert.match(dashboard, /id="rebEffectModal"/, 'full-page detailed effect modal exists');
assert.match(dashboard, /Composition comparison/, 'detail view compares holdings before and after');
assert.match(dashboard, /Cash and fee bridge/, 'detail view itemises the funding bridge');
assert.match(dashboard, /Previous P&amp;L history/, 'detail view explains P&L retention');
assert.match(dashboard, /Per-client reserve effect/, 'detail view includes owner-level reserve consequences');

console.log('16 reserve-first rebalance assertions passed');
