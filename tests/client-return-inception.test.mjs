import assert from 'node:assert/strict';
import fs from 'node:fs';

const publisher = fs.readFileSync(new URL('../api/_client-returns-publish.js', import.meta.url), 'utf8');

assert.match(publisher, /created_at,Fill_date/);
assert.match(publisher, /isGenuineNewAllocation/);
assert.match(publisher, /String\(row\.Fill_date \|\| row\.created_at/);
assert.match(publisher, /status \|\| ''\) === 'posted'/);
assert.match(publisher, /!txById\.get\(row\.transaction_id\)\?\.reversed/);
assert.match(publisher, /twr = 0/);
assert.match(publisher, /chainFactor = 1/);
assert.match(publisher, /mode = 'new-allocation-inception'/);
assert.match(publisher, /reason: 'no trusted return seed'/);

console.log('client return inception: 9/9 green');
