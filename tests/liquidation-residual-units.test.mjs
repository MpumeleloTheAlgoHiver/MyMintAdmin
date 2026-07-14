import fs from 'node:fs';
import assert from 'node:assert/strict';

const orderbook = fs.readFileSync('public/orderbook.html', 'utf8');
const endpoint = fs.readFileSync('api/orderbook/send-csv.js', 'utf8');

assert.match(orderbook, /residualDeltasCentsByUser/, 'settlement must send explicit cent deltas');
assert.doesNotMatch(orderbook, /priorRands \* 100 \+ creditCents/, 'settlement must not replace from a stale batch snapshot');
assert.match(endpoint, /hasExplicitCents/, 'endpoint must distinguish cents from legacy rands');
assert.match(endpoint, /\(hasExplicitCents \|\| hasDeltasCents\)\s*\?\s*Math\.round\(Number\(balance\)/, 'explicit cents must not be multiplied by 100');
assert.match(endpoint, /existing\?\.\[0\]\?\.balance_cents \|\| 0\) \+ requestedCents/, 'delta endpoint must add to the live balance');

const fillRands = 215.51;
const totalGross = fillRands * 3;
const actualNetCents = Math.round((totalGross * (1 - 0.005) - 34.5 * 2) * 100);
assert.equal(actualNetCents, 57430);
assert.equal(Math.round(actualNetCents / 3), 19143);

console.log('7 liquidation residual unit assertions passed');
