import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/investors.html', import.meta.url), 'utf8');
assert.match(html, /const investorHistoryKey = \(i\) => `\$\{i\.userId\}:\$\{i\.familyMemberId \|\| ''\}:\$\{i\.strategyId \|\| ''\}`/);
assert.match(html, /const historyKey = investorHistoryKey\(i\)/);
assert.match(html, /stratNavMap\[investorHistoryKey\(i\)\]/);
assert.match(html, /stratMetricsMap\[investorHistoryKey\(i\)\]/);
assert.doesNotMatch(html, /stratNavMap\[`\$\{i\.userId\}:\$\{i\.strategyId/);
assert.doesNotMatch(html, /stratMetricsMap\[`\$\{i\.userId\}:\$\{i\.strategyId/);
assert.match(html, /Verified return history/);
assert.match(html, /if\(repairPreview\.repair_key\)/);
assert.doesNotMatch(html, /Repair preview .*\$\{repairPreview\.repair_key\}.*\$\{repairPreview\.client_rows\}/);
console.log('investor history and trust banner: 9/9 green');
