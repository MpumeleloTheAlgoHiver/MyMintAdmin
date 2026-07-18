import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/investors.html', import.meta.url), 'utf8');

assert.match(
  html,
  /const key = `\$\{uid\}:\$\{fmId\}:\$\{row\.strategy_id \|\| ''\}`;/,
  'investor cards must be grouped by owner and strategy'
);

assert.match(
  html,
  /const key = `\$\{h\.user_id\}:\$\{h\.family_member_id \|\| ''\}:\$\{h\.strategy_id \|\| ''\}`;/,
  'execution reserve must be scoped to the selected strategy'
);

assert.match(
  html,
  /const key = `\$\{r\.user_id\}:\$\{r\.family_member_id \|\| ''\}:\$\{r\.strategy_id \|\| ''\}`;/,
  'return history must be scoped to the selected owner and strategy'
);

assert.match(
  html,
  /function spreadsheetRows\(i\)[\s\S]*?return \(i\.holdings \|\| \[\]\)\.map/,
  'spreadsheet rows must come from the selected strategy card holdings'
);

assert.match(
  html,
  /\$\{safeName\}-\$\{safeStrategy\}-/,
  'download filename should identify the selected strategy'
);

assert.match(
  html,
  /const investorKey = `\$\{ownerKey\}:\$\{u\.strategyId \|\| ''\}`;/,
  'card selection identity must include the strategy'
);

assert.match(
  html,
  /const prev = currentInvestor\?\.investorKey;[\s\S]*?i\.investorKey === prev/,
  'realtime refresh must restore the exact selected basket'
);

console.log('investor strategy separation: 7/7 green');
