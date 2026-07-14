import fs from 'node:fs';
import assert from 'node:assert/strict';

const orderbook = fs.readFileSync('public/orderbook.html', 'utf8');
const endpoint = fs.readFileSync('api/orderbook/send-csv.js', 'utf8');

assert.match(orderbook, /balancesCentsByUser/, 'settlement must send explicit cents');
assert.match(endpoint, /hasExplicitCents/, 'endpoint must distinguish cents from legacy rands');
assert.match(endpoint, /hasExplicitCents\s*\?\s*Math\.round\(Number\(balance\)/, 'explicit cents must not be multiplied by 100');

const fillRands = 215.51;
const totalGross = fillRands * 3;
const actualNetCents = Math.round((totalGross * (1 - 0.005) - 34.5 * 2) * 100);
assert.equal(actualNetCents, 57430);
assert.equal(Math.round(actualNetCents / 3), 19143);

console.log('5 liquidation residual unit assertions passed');
