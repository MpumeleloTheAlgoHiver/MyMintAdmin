import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../sql/strategy_return_publication_guard.sql', import.meta.url), 'utf8');

assert.match(sql, /complete_value_cents\s*=\s*securities_value_cents\s*\+\s*continuity_cash_cents/);
assert.match(sql, /covered_holdings\s*=\s*expected_holdings/);
assert.match(sql, /Price freshness failed/);
assert.match(sql, /Composition changed without a boundary bridge/);
assert.match(sql, /YTD does not reconcile to chain factor/);
assert.match(sql, /Source repair run is not approved/);
assert.match(sql, /jsonb_array_length\(p_holdings_snapshot\)\s*<>\s*p_expected_holdings/);

console.log('strategy return publication guard: 7/7 green');
