/* ============================================================================
 * Rebalance rules — dry tests (no DB, no network, no deps)
 * ----------------------------------------------------------------------------
 * Run:  node tests/rebalance-rules.test.mjs
 *
 * Two layers:
 *   A. LOGIC   — pure re-implementations of the rebalance rules, asserted
 *                against the before/after scenarios in
 *                docs/REBALANCE_HARDENING.md. Catches math regressions.
 *   B. STRUCTURAL — greps the real CRM files to confirm the implemented
 *                behaviour is still present (nothing silently removed).
 * ==========================================================================*/
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? "  → " + detail : ""}`); }
}
function section(t) { results.push(`\n▸ ${t}`); }

/* ── Rules under test (mirror the implementation) ─────────────────────────── */

// Focus 1 — leg split on a rebalance sell (settlement).
// Prices in CENTS (matches avg_fill/avg_exit convention).
function settleSell({ origQty, soldQty, origAvgFillCents, fillCents }) {
  const closedQty = Math.min(soldQty, origQty);
  const remaining = Math.max(0, origQty - soldQty);
  const closedLeg = {
    is_active: false, trade_side: "BUY", quantity: closedQty,
    avg_fill: origAvgFillCents, avg_exit: fillCents,
  };
  const remainderLeg = remaining > 0 ? {
    is_active: true, trade_side: "BUY", quantity: remaining,
    avg_fill: origAvgFillCents, // ORIGINAL entry preserved
  } : null;
  return { closedLeg, remainderLeg, closedQty, remaining };
}
// App's realised-P&L formula (strategyValuation.js): Σ (avg_exit − avg_fill) × qty
// over is_active=false rows where fill, exit and qty are all non-zero.
function realisedCents(closedRows) {
  return closedRows
    .filter((r) => r.is_active === false && r.avg_fill && r.avg_exit && r.quantity)
    .reduce((s, r) => s + (r.avg_exit - r.avg_fill) * r.quantity, 0);
}

// Focus 2 — eligibility gate + sellability guard.
const isEligibleByDate = (fillDate, effectiveDate) => {
  const fd = fillDate ? String(fillDate).slice(0, 10) : null;
  return !fd || fd <= effectiveDate;
};
const oversold = (rows) => rows.filter((m) => m.soldQty > m.heldQty || m.remaining < 0);

/* ── A. LOGIC TESTS ───────────────────────────────────────────────────────── */

section("Focus 1 — partial sell (Xolie: 30 ABG @ R750, sell 12 @ R820)");
{
  const origAvgFillCents = 75000, fillCents = 82000;
  const { closedLeg, remainderLeg, remaining } =
    settleSell({ origQty: 30, soldQty: 12, origAvgFillCents, fillCents });

  // The SELL audit row the code also writes carries avg_fill==avg_exit==fill → 0 P&L.
  const auditRow = { is_active: false, quantity: 12, avg_fill: fillCents, avg_exit: fillCents };

  check("remainder leg exists with 18 shares", remainderLeg && remainderLeg.quantity === 18);
  check("remainder keeps ORIGINAL entry price (R750)", remainderLeg.avg_fill === 75000);
  check("closed sub-leg holds the sold 12 shares", closedLeg.quantity === 12);
  check("AFTER: realised P&L = R840", realisedCents([closedLeg, auditRow]) === 84000,
        `${realisedCents([closedLeg, auditRow])} cents`);

  // BEFORE (bug): quantity reduced in place, no closed sub-leg → only the audit row exists.
  const beforeRealised = realisedCents([auditRow]);
  check("BEFORE: realised P&L was R0 (the bug we fixed)", beforeRealised === 0,
        `${beforeRealised} cents`);
}

section("Focus 1 — full exit (sell all 30) is unchanged");
{
  const { remainderLeg, closedLeg } =
    settleSell({ origQty: 30, soldQty: 30, origAvgFillCents: 75000, fillCents: 82000 });
  check("no remainder leg on full exit", remainderLeg === null);
  check("closed leg carries all 30 shares", closedLeg.quantity === 30);
  check("full-exit realised P&L = R2100", realisedCents([closedLeg]) === 210000,
        `${realisedCents([closedLeg])} cents`);
}

section("Focus 1 — oversell is clamped (soldQty > held)");
{
  const { closedQty, remaining } =
    settleSell({ origQty: 10, soldQty: 25, origAvgFillCents: 75000, fillCents: 82000 });
  check("closedQty clamps to held (10, not 25)", closedQty === 10);
  check("remaining never negative", remaining === 0);
}

section("Focus 2 — effective-date eligibility (rebalance 16 Mar)");
{
  const eff = "2026-03-16";
  check("Xolie (bought 1 Feb) IS eligible", isEligibleByDate("2026-02-01", eff) === true);
  check("Lindi (bought 20 Mar) is NOT eligible", isEligibleByDate("2026-03-20", eff) === false);
  check("same-day (16 Mar) IS eligible (<=)", isEligibleByDate("2026-03-16", eff) === true);
  check("legacy null Fill_date IS eligible (kept)", isEligibleByDate(null, eff) === true);
  check("timestamp form is date-truncated", isEligibleByDate("2026-03-16T09:30:00Z", eff) === true);
}

section("Focus 2 — Can_Execute sellability guard");
{
  const ok = [{ soldQty: 12, heldQty: 30, remaining: 18 }];
  const bad = [{ soldQty: 40, heldQty: 30, remaining: -10 }];
  check("valid sale passes the guard", oversold(ok).length === 0);
  check("oversell is blocked", oversold(bad).length === 1);
}

/* ── B. STRUCTURAL TESTS (guard the real code) ────────────────────────────── */

section("Structural — orderbook.html (leg split present)");
{
  const ob = read("public/orderbook.html");
  check("select fetches original entry fields for reissue",
        /select\('id, quantity, avg_fill, expected_fill:"Expected_fill", fill_date:"Fill_date", transaction_id'\)/.test(ob));
  check("remainder leg reissued with ORIGINAL avg_fill",
        /avg_fill: activePos\.avg_fill/.test(ob));
  check("remainder tagged REBALANCE_PARTIAL_REMAINDER",
        /REBALANCE_PARTIAL_REMAINDER/.test(ob));
  check("no destructive 'quantity: remaining' in-place reduce remains",
        !/quantity: remaining,\s*\n\s*updated_at: nowIso,\s*\n\s*\}\)\.eq\('id', activePos\.id\)/.test(ob));
}

section("Structural — dashboard.html (eligibility + guard + effective_date)");
{
  const db = read("public/dashboard.html");
  check("rebEffectiveDate state exists", /let rebEffectiveDate =/.test(db));
  check("effective-date UI input exists", /id="rebEffectiveDateInput"/.test(db));
  check("buy-side date gate present", /if \(fillDate && fillDate > rebEffectiveDate\) return;/.test(db));
  check("sell-side eligibility helper present", /isEligibleByDate/.test(db));
  check("Can_Execute sellability guard present", /Cannot execute: sell quantity exceeds held quantity/.test(db));
  const effInserts = (db.match(/effective_date: effectiveDateStr/g) || []).length;
  check("effective_date stamped on all 3 batch inserts", effInserts === 3, `found ${effInserts}`);
}

section("Structural — migration file exists");
{
  check("sql/rebalance_effective_date.sql present",
        fs.existsSync(path.join(ROOT, "sql/rebalance_effective_date.sql")));
}

/* ── #9 Funding reconciliation — pure mirror of rebReconcileSwitch (dashboard.html):
   money in must equal money out on a rebalance switch, to the cent. */
function rebReconcileSwitch({ grossProceeds, sellFees, buyGrossCost, buyFees, residualParked, walletIn = 0, toleranceCents = 1 }) {
  const cashIn  = Number(grossProceeds || 0) + Number(walletIn || 0);
  const cashOut = Number(sellFees || 0) + Number(buyGrossCost || 0) + Number(buyFees || 0) + Number(residualParked || 0);
  const diffCents = Math.round((cashIn - cashOut) * 100);
  return { ok: Math.abs(diffCents) <= toleranceCents, diffCents, cashIn, cashOut };
}

section("Focus #9 — funding reconciliation (FSR→NED switch)");
{
  // Balanced, no fees: sell 8 FSR @ R407.05 → buy 55 NED @ R58.58, R34.50 residual.
  const a = rebReconcileSwitch({ grossProceeds: 3256.40, sellFees: 0, buyGrossCost: 3221.90, buyFees: 0, residualParked: 34.50 });
  check("balanced switch reconciles (diff 0)", a.ok && a.diffCents === 0, `diff ${a.diffCents}`);

  // Balanced WITH fees.
  const b = rebReconcileSwitch({ grossProceeds: 3256.40, sellFees: 8.00, buyGrossCost: 3180.00, buyFees: 5.00, residualParked: 63.40 });
  check("balanced switch with fees reconciles", b.ok && b.diffCents === 0, `diff ${b.diffCents}`);

  // Overspend: bought 56 shares (R3,280.48) but residual clamped to 0 — the bug
  // the max(0,…) guard hides. Must FAIL with a negative gap.
  const c = rebReconcileSwitch({ grossProceeds: 3256.40, sellFees: 0, buyGrossCost: 3280.48, buyFees: 0, residualParked: 0 });
  check("overspend is caught (blocked)", !c.ok && c.diffCents < 0, `diff ${c.diffCents}`);

  // Save ≠ verify: bought 54 shares (R3,162.32) but residual still stored as the
  // intended R34.50 → R59.58 floats unaccounted. Must FAIL.
  const d = rebReconcileSwitch({ grossProceeds: 3256.40, sellFees: 0, buyGrossCost: 3162.32, buyFees: 0, residualParked: 34.50 });
  check("stale/wrong residual is caught (R59.58 gap)", !d.ok && d.diffCents === 5958, `diff ${d.diffCents}`);

  // Wallet-funded top-up buy (no sale): R500 wallet → R480 shares + R5 fee + R15 residual.
  const e = rebReconcileSwitch({ grossProceeds: 0, sellFees: 0, buyGrossCost: 480, buyFees: 5, residualParked: 15, walletIn: 500 });
  check("wallet-funded buy reconciles", e.ok && e.diffCents === 0, `diff ${e.diffCents}`);

  // Tolerance: a 1-cent rounding gap passes, 2 cents fails.
  const f1 = rebReconcileSwitch({ grossProceeds: 100.00, buyGrossCost: 99.99, residualParked: 0 });
  const f2 = rebReconcileSwitch({ grossProceeds: 100.00, buyGrossCost: 99.98, residualParked: 0 });
  check("1-cent rounding gap tolerated", f1.ok, `diff ${f1.diffCents}`);
  check("2-cent gap rejected", !f2.ok, `diff ${f2.diffCents}`);
}

section("Structural — dashboard.html (#9 reconciliation wired + hard-blocks)");
{
  const db = read("public/dashboard.html");
  check("rebReconcileSwitch helper defined", /function rebReconcileSwitch\(/.test(db));
  check("execute-time reconciliation called", /rebReconcileSwitch\(\{[\s\S]*?residualParked:/.test(db));
  check("failure hard-blocks the rebalance", /Funding reconciliation failed/.test(db));
  check("uses atomic sell terms (grossProceeds)", /grossProceeds:\s*Number\(sellExecData\.grossProceeds/.test(db));
}

/* ── Report ───────────────────────────────────────────────────────────────── */
console.log(results.join("\n"));
console.log(`\n${"=".repeat(48)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log("=".repeat(48));
process.exit(fail ? 1 : 0);
