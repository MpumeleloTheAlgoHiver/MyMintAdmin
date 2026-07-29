import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../public/factsheets.html", import.meta.url), "utf8");

assert.match(page, /canonicalReturnSeries\(retRows\)/);
assert.match(page, /canonicalCalendarReturns\(retRows\)/);
assert.match(page, /\.select\('strategy_id,ytd_pct,all_pct,"1d_pct",basket_value,continuity_cash_cents,securities_value_cents,source_kind,as_of_date'\)/);
assert.match(page, /sym:'CA'/);
assert.match(page, /name:`Cash asset/);
assert.doesNotMatch(page, /sym:'CASH',name:cashAmt/);
assert.match(page, /sparks\[sid\] = canonicalReturnSeries/);
assert.match(page, /100\*\(1\+Number\(row\.ytd_pct\)\/100\)/);
assert.doesNotMatch(page, /value \*= 1 \+ daily \/ 100/);

for (const match of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  if (match[1]?.trim()) new Function(match[1]);
}

console.log("factsheet canonical performance tests passed");
