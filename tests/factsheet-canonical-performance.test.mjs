import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../public/factsheets.html", import.meta.url), "utf8");

assert.match(page, /canonicalReturnSeries\(retRows\)/);
assert.match(page, /canonicalCalendarReturns\(retRows\)/);
assert.match(page, /\.select\('strategy_id,ytd_pct,all_pct,"1d_pct",basket_value,continuity_cash_cents,securities_value_cents,as_of_date'\)/);
assert.match(page, /sym:'CA'/);
assert.match(page, /name:`Cash asset/);
assert.doesNotMatch(page, /sym:'CASH',name:cashAmt/);
assert.match(page, /sparks\[sid\] = canonicalReturnSeries/);

for (const match of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  if (match[1]?.trim()) new Function(match[1]);
}

console.log("factsheet canonical performance tests passed");
