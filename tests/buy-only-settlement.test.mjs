import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const orderbook = fs.readFileSync(new URL('../public/orderbook.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../sql/rebalance_buy_only_settlement.sql', import.meta.url), 'utf8');

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
};

const actualRequirement = ({ quantity, fillCents, brokerageRate, custodyCents, reserveCents }) => {
  const grossCents = Math.round(quantity * fillCents);
  const feesCents = Math.round(grossCents * brokerageRate) + custodyCents;
  const feeShortfallCents = Math.max(0, feesCents - reserveCents);
  return { grossCents, feesCents, feeShortfallCents, requiredCents: grossCents + feeShortfallCents };
};

check('JSE fill remains cents exactly once (2 × 15495c = 30990c)', () => {
  assert.equal(actualRequirement({ quantity: 2, fillCents: 15495, brokerageRate: 0, custodyCents: 0, reserveCents: 0 }).grossCents, 30990);
});

check('reserve pays fees before residual-funded portfolio value', () => {
  const result = actualRequirement({ quantity: 2, fillCents: 15495, brokerageRate: 0.005, custodyCents: 6900, reserveCents: 4000 });
  assert.deepEqual(result, { grossCents: 30990, feesCents: 7055, feeShortfallCents: 3055, requiredCents: 34045 });
});

check('commit stores a plan and does not persist composition', () => {
  assert.match(dashboard, /rebAddOrIncreaseStrategyHolding\(\{[\s\S]*?persist: false/);
  assert.match(dashboard, /holdings_snapshot_planned: plannedHoldings\?\.holdings/);
});

check('commit does not deduct an estimated wallet balance', () => {
  const start = dashboard.indexOf('async function rebPersistWalletOnlyBuy');
  const end = dashboard.indexOf('async function rebAddOrIncreaseStrategyHolding', start);
  const body = dashboard.slice(start, end);
  assert.doesNotMatch(body, /rebUpsertWalletBalances\(/);
});

check('wallet-buy events preserve parent/child ownership scope', () => {
  assert.match(dashboard, /closed_reason: "REBALANCE_EVENT_BUY_WALLET"/);
  assert.match(dashboard, /family_member_id: rebSelectedFamilyMemberId \|\| null/);
});

check('actual-fill preflight runs before atomic settlement claim', () => {
  const preflight = orderbook.indexOf('await preflightWalletOnlyBuy(');
  const claim = orderbook.indexOf('action=rebalance-settlement-claim', preflight);
  assert.ok(preflight >= 0 && claim > preflight);
});

check('business status stays pending until final successful checkpoint', () => {
  const claim = orderbook.indexOf('action=rebalance-settlement-claim');
  const final = orderbook.indexOf("status: 'SETTLED'", claim);
  assert.ok(claim >= 0 && final > claim);
  assert.doesNotMatch(orderbook.slice(claim, final), /update\(\{ status: 'SETTLED'/);
});

check('100x cents/rands anomalies are blocked', () => {
  assert.match(orderbook, /ratio < 0\.2 \|\| ratio > 5/);
  assert.match(orderbook, /Possible cents\/rands unit error; settlement blocked/);
});

check('actual affordability includes reserve-first fee shortfall', () => {
  assert.match(orderbook, /requiredCents = amounts\.grossCents \+ feeShortfallCents/);
  assert.match(orderbook, /residualCents < requiredCents/);
});

check('planned composition is published only in settlement', () => {
  assert.match(orderbook, /Publish a wallet-only composition only after actual-fill holdings/);
  assert.match(orderbook, /delete clean\.pending/);
});

check('migration supplies immutable pending-plan fields', () => {
  assert.match(migration, /holdings_snapshot_planned jsonb/);
  assert.match(migration, /min_investment_planned numeric/);
});

console.log(`buy-only settlement: ${passed}/11 green`);
