import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const orderbook = fs.readFileSync(new URL('../public/orderbook.html', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/orderbook/send-csv.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../sql/2026-08-03_rebalance_sequential_batches.sql', import.meta.url), 'utf8');

assert.match(dashboard, /collectRows\(rebRawHoldings, false\);[\s\S]*collectRows\(rebUnfilledHoldings, true\);/,
  'buy-only participants must include filled and pending holdings');
assert.match(dashboard, /predecessor_batch_id: predecessorBatch\?\.id \|\| null/,
  'a secondary buy-only batch must record its predecessor');
assert.doesNotMatch(
  dashboard.slice(dashboard.indexOf('async function rebPersistWalletOnlyBuy'), dashboard.indexOf('async function rebAddOrIncreaseStrategyHolding')),
  /Settle or reverse it first\./,
  'buy-only must not retain the old blanket pending-batch rejection');
assert.match(api, /This is a parked secondary rebalance[\s\S]*predecessorStatus/,
  'server settlement claim must enforce predecessor completion');
assert.match(orderbook, /Reverse the newer parked rebalance[\s\S]*dependent instruction is still pending/,
  'reversal must be newest-first');
assert.match(orderbook, /Parked after[\s\S]*isParkedSecondary \? 'not-allowed'/,
  'the orderbook must visibly park and disable a dependent batch');
assert.match(migration, /foreign key \(predecessor_batch_id\)[\s\S]*references public\.rebalance_batch\(id\)/,
  'database must enforce valid predecessor links');

console.log('sequential buy-only rebalance: 7/7 green');
