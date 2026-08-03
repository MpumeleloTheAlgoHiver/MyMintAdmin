import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const orderbook = fs.readFileSync(new URL('../public/orderbook.html', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/orderbook/send-csv.js', import.meta.url), 'utf8');
const reconciliation = fs.readFileSync(new URL('../sql/rebalance_ca_reconciliation.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../sql/2026-08-03_rebalance_independent_books.sql', import.meta.url), 'utf8');

assert.match(dashboard, /const proposedCodes = new Set[\s\S]*const conflictingBatch[\s\S]*proposedCodes\.has\(code\)/,
  'CRM must allow only security-disjoint concurrent books');
assert.match(dashboard, /Independent-book composition checkpoint[\s\S]*effective_date[\s\S]*predecessor_batch_id/,
  'every open independent sibling must share the latest final planned model');
assert.match(api, /Concurrent, disjoint rebalance books[\s\S]*siblingFillEvents[\s\S]*combinedFillBySecId/,
  'canonical boundary must combine actual fills across same-day sibling books');
assert.match(api, /combinedFillBySecId\[security\.id\]/,
  'combined actual fills must drive boundary valuation');
assert.match(orderbook, /const boundaryHoldings = Array\.isArray\(batch\.holdings_snapshot_planned\)[\s\S]*holdingsSnapshot: boundaryHoldings/,
  'settlement must value the frozen final group composition');
assert.match(reconciliation, /from public\.rebalance_event[\s\S]*union[\s\S]*from public\.strategy_rebalance_cash_events_c/,
  'CA reconciliation must include pending-only owners without executable events');
assert.match(reconciliation, /left join lateral[\s\S]*newest strategy ledger closing balance[\s\S]*order by c\.created_at desc/,
  'CA validation must tolerate a later sibling cash event by checking the latest owner ledger balance');
assert.match(migration, /update public\.rebalance_batch b[\s\S]*holdings_snapshot_planned[\s\S]*min_investment_planned/,
  'existing open books must receive a stable final model basis before settlement');

console.log('independent rebalance books: 8/8 green');
