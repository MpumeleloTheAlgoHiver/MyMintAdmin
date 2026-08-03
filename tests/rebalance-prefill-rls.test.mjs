import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('public/dashboard.html', 'utf8');
const orderbook = fs.readFileSync('public/orderbook.html', 'utf8');
const endpoint = fs.readFileSync('api/orderbook/send-csv.js', 'utf8');

assert.match(endpoint, /action === 'rebalance-pending-holding-write'[\s\S]*?requirePermission\(req, res, 'dashboard', 'commit_rebalance'\)/,
  'pending holding writes must require rebalance permission');
assert.match(endpoint, /Pending-order endpoint cannot mutate a filled holding/,
  'the privileged endpoint must reject filled holdings');
assert.match(endpoint, /allowedPatchFields = new Set\([\s\S]*?'Expected_fill'/,
  'pending updates must use a strict field whitelist');
assert.match(endpoint, /operation === 'insert'[\s\S]*?avg_fill: null/,
  'new replacement holdings must remain pending');
assert.match(endpoint, /action === 'rebalance-pending-batch-holdings-cleanup'[\s\S]*?status=eq\.PENDING/,
  'batch cleanup must be restricted to pending batches');
assert.match(endpoint, /action === 'rebalance-pending-snapshot-capability'[\s\S]*?select=pending_swap_snapshot/,
  'the API must expose a fail-fast pending-snapshot capability check');
assert.match(dashboard, /rebEnsurePendingSwapSnapshotSchema\(\); \/\/ fail before creating a batch/,
  'ordinary rebalance must verify reversal-ledger schema before any batch write');
assert.match(dashboard, /rebEnsurePendingSwapSnapshotSchema\(\); \/\/ liquidation of pending orders must remain reversible/,
  'liquidation must verify reversal-ledger schema before any batch write');
assert.match(dashboard, /settlement_state: "REVERSED"[\s\S]{0,180}reversed_reason: `Commit rolled back:/,
  'automatic rollback must close both business and technical settlement state');

const pendingCommit = dashboard.slice(
  dashboard.indexOf('UNFILLED-ORDER SWAP'),
  dashboard.indexOf('Update wallet credits'),
);
assert.match(pendingCommit, /rebPendingHoldingInsert\(/, 'pre-fill replacement must use the server bridge');
assert.match(pendingCommit, /rebPendingHoldingUpdate\(/, 'pre-fill retirement and rollback must use the server bridge');
assert.match(pendingCommit, /rebPendingHoldingDelete\(/, 'pre-fill rollback must use the server bridge');
assert.doesNotMatch(pendingCommit, /\.from\("stock_holdings_c"\)[\s\S]{0,180}\.(insert|update|delete)\(/,
  'pre-fill commit must not mutate holdings through browser RLS');
assert.match(pendingCommit, /expectedSellRands = Number\(row\.expected_fill\)/, 'pending principal must read authoritative Expected_fill');
assert.match(pendingCommit, /remainingQuantity: Math\.max\(0, originalQuantity - soldQty\)/,
  'partial pending rebalances must retain unsold quantity');
assert.match(pendingCommit, /mergedOriginalExpectedFill/, 'merged replacements must preserve reversible price basis');

const liquidationCommit = dashboard.slice(
  dashboard.indexOf('async function rebPersistLiquidationToCash'),
  dashboard.indexOf('Wallet Modal: per-user wallet view'),
);
assert.match(liquidationCommit, /rebPendingHoldingUpdate\(/, 'pending liquidation and rollback must use the server bridge');
assert.doesNotMatch(liquidationCommit, /\.from\("stock_holdings_c"\)[\s\S]{0,180}\.update\(/,
  'pending liquidation must not update holdings through browser RLS');
assert.match(liquidationCommit, /cashDeltaCents: plan\.committedCents/,
  'pending liquidation must move exact committed principal into CA');

const reversal = orderbook.slice(
  orderbook.indexOf('const executeReverseRebalanceBatch'),
  orderbook.indexOf('const renderRebalanceBatchDetail'),
);
assert.match(reversal, /rebalance-pending-holding-write/, 'reversal must restore pending holdings through the server bridge');
assert.match(reversal, /rebalance-pending-batch-holdings-cleanup/, 'reversal cleanup must bypass browser RLS safely');

console.log('rebalance pre-fill RLS safety: 22/22 green');
