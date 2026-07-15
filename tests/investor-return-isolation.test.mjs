import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('../api/investors/data.js', import.meta.url), 'utf8');

assert.doesNotMatch(
  api,
  /investedByUser|latestRowByUser/,
  'the API must not combine holdings or latest return rows by user alone'
);

assert.doesNotMatch(
  api,
  /r\.inception_pct\s*=|r\.inception_pnl\s*=/,
  'the Investors API must not rewrite the stored return spine in memory'
);

assert.match(
  api,
  /historical percentages remain exactly as stored/,
  'the immutable return-spine contract should be documented beside the response'
);

console.log('investor return isolation: 3/3 green');
