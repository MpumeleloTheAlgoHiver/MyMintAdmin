import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('sql/strategy_investor_environment.sql', 'utf8');
const dashboard = fs.readFileSync('public/dashboard.html', 'utf8');

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

const scope = (environment, rows, testIds) => rows.filter((row) =>
  environment === 'UAT' ? testIds.has(row.user_id) : !testIds.has(row.user_id));
const rows = [{ user_id: 'live' }, { user_id: 'test' }];
const testIds = new Set(['test']);
assert.deepEqual(scope('LIVE', rows, testIds), [{ user_id: 'live' }]);
assert.deepEqual(scope('UAT', rows, testIds), [{ user_id: 'test' }]);

console.log('12 strategy investor-environment assertions passed');
