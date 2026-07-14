import fs from 'node:fs';
import assert from 'node:assert/strict';

const updatePrice = fs.readFileSync('api/orderbook/update-price.js', 'utf8');
const team = fs.readFileSync('api/team.js', 'utf8');
const orderbook = fs.readFileSync('public/orderbook.html', 'utf8');

assert.match(updatePrice, /isMasterOrDev\(authResult\.member\)/, 'Master must bypass direct fill approval');
assert.match(updatePrice, /expected_exit=is\.null/, 'legacy SELL exits need an expected-exit fallback');
assert.match(team, /applyApprovedPriceUpdate\(/, 'Master approval must apply the queued fill');
assert.match(team, /or=\(approver_tier\.eq\.master,role\.eq\.master_admin\)/, 'all Master variants must receive requests');
assert.match(orderbook, /\.eq\('is_active', true\)/, 'broker Excel matching must exclude sold holdings');
assert.match(orderbook, /fillPricePerm === false\) fillPricePerm = 'pending'/, 'non-Masters must route to approval');

console.log('6 orderbook approval assertions passed');
