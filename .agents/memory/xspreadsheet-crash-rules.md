---
name: x-data-spreadsheet crash rules
description: Rules for using x-data-spreadsheet in investors.html without crashes, and how the formula bar shows formulas without the library evaluating them.
---

## Rules

1. **No formula strings in cell `text`.** When `text` starts with `=`, x-data-spreadsheet's formula engine evaluates it during `loadData`. The engine throws non-Error strings (e.g. `"#DIV/0!"`) inside `requestAnimationFrame` callbacks — outside any `try-catch` — crashing the page with "Spreadsheet failed to load: TypeError: Cannot read properties of undefined (reading 'render')". Pre-compute all values in JS and use static text.

2. **No `format` in styles.** x-data-spreadsheet's numbro formatter (called from the style's `format` property) also runs inside rAF and crashes on `Infinity`, `NaN`, or formula-error strings. Leave all style objects without a `format` key.

3. **No `x_spreadsheet.format()` registration.** CDN build v1.1.9 does not expose a `.format()` static method.

4. **Total row is always pre-computed text.** The Total row uses JS-computed `.toFixed(2)` strings, never formula strings.

5. **60-second refresh re-initialises the grid.** `doRefresh` → `renderDetail` → `setTimeout(initSpreadsheetGrid, 30)` fires every 60s when the user is on the Spreadsheet tab. Any crash inside `initSpreadsheetGrid` appears as an uncaught exception every minute.

## Formula bar — parallel formula map pattern

To show formulas in the formula bar WITHOUT putting formula strings in cell `text`:

- **`buildFormulaMap(holdingCount)`** — builds `xsFormulaMap`, a plain JS object keyed by `"ri,ci"` (0-based row/col, matching x-data-spreadsheet indexes) mapping to the formula string (e.g. `"=C2*D2"`).
- **`xsFormulaMap`** — global variable populated by `mountSpreadsheetGrid` on every mount via `buildFormulaMap(currentInvestor.holdings.length)`.
- **`xsUpdateFormulaBar`** — checks `xsFormulaMap["ri,ci"]` first; if found, shows the formula string; otherwise shows the cell's raw `text` value.
- **`xsCommitFormulaBar`** — `delete xsFormulaMap["ri,ci"]` before writing the user's edit so subsequent clicks show the edited value, not the stale formula.

The library NEVER evaluates these formula strings. Formula bar display is entirely our own code.

## Column layout & formula map entries

Columns 0-8 (A-I), all cells use pre-computed text:
- A(0) Symbol — text
- B(1) Name — text
- C(2) Quantity — raw number
- D(3) Avg Fill — `fmtRands(avgFill)` (R prefix)
- E(4) Total Avg Fill — `fmtRands(cost)` | map: `=C{r}*D{r}`
- F(5) Market Value — `fmtRands(mktVal)` (seeded from live price)
- G(6) P&L — `fmtRands(pnl)` | map: `=F{r}-E{r}`
- H(7) P&L % — `fmtPct(pnlPct)` | map: `=IF(E{r}=0,0,(F{r}-E{r})*100/E{r})`
- I(8) Total Value — `fmtRands(mktVal)` | map: `=F{r}`

Cash row (always shown, even when 0): `cashRIdx = holdingCount + 1`, Total Value map entry: `=F{cashFRow}`.
Total row: `totalRIdx = holdingCount + 2`, fully pre-computed, no map entries.

**Why:** Formula strings in cell `text` crash the page via the formula engine. The parallel map approach gives Excel-style formula bar display with zero library involvement.
