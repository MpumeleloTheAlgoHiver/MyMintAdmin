import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('../api/investors/data.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../public/investors.html', import.meta.url), 'utf8');

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

assert.match(
  page,
  /sort\(\(a,b\) => b\.retPct - a\.retPct\)/,
  'Best and Worst Performer must rank the live all-time return shown in each row'
);

assert.doesNotMatch(
  page,
  /BEST PERFORMER[^\n]*csrRetPct|WORST PERFORMER[^\n]*csrRetPct/,
  'KPI labels must not switch back to the legacy stored inception percentage'
);

console.log('investor return isolation: 5/5 green');
