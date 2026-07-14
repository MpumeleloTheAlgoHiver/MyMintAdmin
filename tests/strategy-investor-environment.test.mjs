import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('sql/strategy_investor_environment.sql', 'utf8');
const dashboard = fs.readFileSync('public/dashboard.html', 'utf8');
const orderbook = fs.readFileSync('public/orderbook.html', 'utf8');

assert.match(migration, /investor_environment text not null default 'LIVE'/);
assert.match(migration, /check \(investor_environment in \('LIVE', 'UAT'\)\)/);
assert.match(migration, /26daf728-8e95-4ff0-b9e7-69b382b0bb8c/);
assert.match(dashboard, /id="ovInvestorEnvironmentBadge"/);
assert.match(dashboard, /id="_sdInvestorEnvironment"/);
assert.match(dashboard, /investor_environment: overlay\.querySelector/);
assert.match(dashboard, /_investorEnv === 'UAT' \? _testUids\.has\(r\.user_id\) : !_testUids\.has\(r\.user_id\)/);
assert.match(dashboard, /investorEnv === 'UAT' \? isTest : !isTest/);
assert.match(dashboard, /scopedHoldRows\.forEach/);
assert.match(dashboard, /rebLoadWalletBalances\(strategy\.id, scopedUserIds\)/);
assert.match(dashboard, /const isUatStrategy = strat && String\(strat\.investor_environment \|\| 'LIVE'\)\.toUpperCase\(\) === 'UAT'/);
assert.match(dashboard, /const showRebalance = showLiveRebalance \|\| isUatStrategy/);
assert.match(dashboard, /showRebalance && !window\._rebPermBlocked/);
assert.match(dashboard, /id="rebalanceNavBtn" onclick="window\.openRebalancingModal\(\)"/);
assert.match(orderbook, /id="rebalanceUatToggle"/);
assert.match(orderbook, /select\('id, name, short_name, slug, investor_environment'\)/);
assert.match(orderbook, /return orderbookUatMode \? environment === 'UAT' : environment !== 'UAT'/);
assert.match(orderbook, /rebalanceUatToggle\.addEventListener\('click', toggleOrderbookEnvironment\)/);
assert.match(orderbook, /class="filled-orderbooks-heading-row rebalance-heading-row"/);
assert.match(orderbook, /rebalanceUatToggle\.classList\.toggle\('is-uat', orderbookUatMode\)/);

const scope = (environment, rows, testIds) => rows.filter((row) =>
  environment === 'UAT' ? testIds.has(row.user_id) : !testIds.has(row.user_id));
const rows = [{ user_id: 'live' }, { user_id: 'test' }];
const testIds = new Set(['test']);
assert.deepEqual(scope('LIVE', rows, testIds), [{ user_id: 'live' }]);
assert.deepEqual(scope('UAT', rows, testIds), [{ user_id: 'test' }]);

console.log('22 strategy investor-environment assertions passed');
