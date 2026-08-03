import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const orderbook = fs.readFileSync(new URL('../public/orderbook.html', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/orderbook/send-csv.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../sql/2026-08-03_rebalance_sequential_batches.sql', import.meta.url), 'utf8');

assert.match(dashboard, /collectRows\(rebRawHoldings, false\);[\s\S]*collectRows\(rebUnfilledHoldings, true\);/,
  'buy-only participants must include filled and pending holdings');
assert.match(dashboard, /PENDING INITIAL FILL/,
  'pending-only strategy members must be visibly identifiable before commit');
assert.match(dashboard, /pendingOnlyParticipants[\s\S]*rebalance_batch_id: rebalanceBatchId/,
  'buy-only must materialise a reversible pending leg for pending-only owners');
assert.match(dashboard, /predecessor_batch_id: predecessorBatch\?\.id \|\| null/,
  'a secondary buy-only batch must record its predecessor');
const buyOnlySource = dashboard.slice(
  dashboard.indexOf('async function rebPersistWalletOnlyBuy'),
  dashboard.indexOf('async function rebAddOrIncreaseStrategyHolding'),
);
assert.match(buyOnlySource, /const predecessorBatch = [\s\S]*predecessor_batch_id: predecessorBatch\?\.id \|\| null/,
  'buy-only must define its predecessor before writing the dependency');
assert.doesNotMatch(
  buyOnlySource,
  /Settle or reverse it first\./,
  'buy-only must not retain the old blanket pending-batch rejection');
assert.match(dashboard, /Independent sell\/buy instructions may coexist[\s\S]*const conflictingBatch[\s\S]*overlaps this sell\/buy security/,
  'disjoint sell/switch books may coexist while overlapping securities remain blocked');
assert.match(dashboard, /only buy-only additions support[\s\S]*Settle or reverse it before committing a liquidation/,
  'liquidation must remain blocked while an earlier batch is pending');
assert.match(api, /This is a parked secondary rebalance[\s\S]*predecessorStatus/,
  'server settlement claim must enforce predecessor completion');
assert.match(api, /Pending buy-only holding must reference a PENDING batch for the same strategy/,
  'the privileged pending-row writer must validate its batch and strategy');
assert.match(orderbook, /Reverse the newer parked rebalance[\s\S]*dependent instruction is still pending/,
  'reversal must be newest-first');
assert.match(orderbook, /Parked after[\s\S]*isParkedSecondary \? 'not-allowed'/,
  'the orderbook must visibly park and disable a dependent batch');
assert.match(orderbook, /pending-row fill[\s\S]*evtResumeErr/,
  'settlement must promote the pre-created pending row instead of duplicating it');
assert.match(orderbook, /data-download-rebalance-csv[\s\S]*Download CSV/,
  'pending rebalance actions must expose CSV download before settlement');
assert.match(orderbook, /const downloadRebalanceBatchCsv[\s\S]*rebalance_event[\s\S]*\['Side', 'Ticker', 'Quantity'\][\s\S]*downloadCsvContent\(csvContent/,
  'rebalance CSV must be built from committed batch events');
assert.doesNotMatch(
  orderbook.slice(orderbook.indexOf('const downloadRebalanceBatchCsv'), orderbook.indexOf('const openFillSettleModal')),
  /fill_price|avg_fill|price_at_commit|Fill Date/,
  'pre-settlement rebalance CSV must not include fill or price fields');
assert.match(migration, /foreign key \(predecessor_batch_id\)[\s\S]*references public\.rebalance_batch\(id\)/,
  'database must enforce valid predecessor links');

console.log('sequential buy-only rebalance: 17/17 green');
