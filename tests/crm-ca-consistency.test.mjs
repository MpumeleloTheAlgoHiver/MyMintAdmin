import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../public/dashboard.html");
const investors = read("../public/investors.html");
const strategies = read("../public/strategies.html");
const legacyFactsheet = read("../public/factsheet.html");
const orderbook = read("../public/orderbook.html");

const checkInlineScripts = (html) => {
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (match[1]?.trim()) new Function(match[1]);
  }
};

assert.match(dashboard, /continuity_cash_cents/);
assert.match(dashboard, /symbol: "CA"/);
assert.match(dashboard, /code: 'CA', name: 'Cash asset'/);
assert.match(dashboard, /curves: canonicalCurve/);
assert.match(dashboard, /Canonical performance history unavailable/);
assert.doesNotMatch(dashboard, /const now = new Date\(\); const soy/);
assert.doesNotMatch(dashboard, /const cashAmount = minInvestment \? minInvestment \* 0\.08/);

assert.match(investors, />CA<\/span>CA<\/td>/);
assert.match(investors, /bySector\.CA = Number\(i\.residualCash\)/);
assert.match(strategies, /href="\/factsheets\.html\?id=\$\{strategy\.id\}"/);
assert.match(legacyFactsheet, /location\.replace\('\/factsheets\.html' \+ location\.search\)/);
assert.match(orderbook, /strategyResidualCashByOwner = new Map\(\)/);
assert.match(orderbook, /action=rebalance-load-residuals/);
assert.match(orderbook, /familyMemberId: '__all__'/);
assert.match(orderbook, /isCashAsset: true/);
assert.match(orderbook, /instrumentName: 'Cash asset'/);
assert.match(orderbook, /ticker: 'CA'/);
assert.match(orderbook, /ownerFirstKey\.forEach/, 'CA must be assigned once per strategy owner, not once per purchase bucket');
assert.doesNotMatch(orderbook, /strategyHoldings:[^\n]*isCashAsset/, 'CA must remain synthetic rather than being persisted as a model holding');
checkInlineScripts(dashboard);
checkInlineScripts(investors);
checkInlineScripts(orderbook);

console.log("CRM CA consistency tests passed");
