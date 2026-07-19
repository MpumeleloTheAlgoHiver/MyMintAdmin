import assert from 'node:assert/strict';
import fs from 'node:fs';

const publisher = fs.readFileSync(new URL('../api/_client-returns-publish.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../sql/client_return_publication_guard.sql', import.meta.url), 'utf8');
const effective = fs.readFileSync(new URL('../sql/effective_return_views_v2.sql', import.meta.url), 'utf8');
const cron = fs.readFileSync(new URL('../api/orderbook/cron-daily.js', import.meta.url), 'utf8');

// Cash changes are flows, not market performance: hold prior cash constant.
const previous = { securities: 50000, cash: 10000, performance: 60000, chain: 1.05 };
const currentSecurities = 51000;
const currentCash = 25000;
const daily = (currentSecurities + previous.cash) / previous.performance - 1;
assert.equal(Number((daily * 100).toFixed(6)), 1.666667);
assert.equal(Number(((previous.chain * (1 + daily) - 1) * 100).toFixed(6)), 6.75);
assert.notEqual(currentCash, previous.cash, 'fixture must prove cash changed');

assert.match(publisher, /securitiesCents \+ previousCash/);
assert.match(publisher, /composition changed without a settled rebalance boundary/);
assert.match(publisher, /includeTestUsers/);
assert.match(publisher, /is_test=eq\.true/);
assert.match(publisher, /status=eq\.test/);
assert.match(publisher, /applyClientEodReturns|publishClientEodReturns/);
assert.match(migration, /performance_nav_cents = securities_value_cents \+ residual_cash_cents \+ unused_reserve_cents/);
assert.match(migration, /complete_nav_cents = performance_nav_cents - accrued_liability_cents/);
assert.match(migration, /Client rebalance boundary did not preserve the return chain/);
assert.match(effective, /GUARDED_CLIENT_PUBLICATION/);
assert.match(cron, /CLIENT_RETURNS_PUBLISH_APPLY/);

console.log('client return publication checks passed');
