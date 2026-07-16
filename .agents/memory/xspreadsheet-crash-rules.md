---
name: x-data-spreadsheet crash rules
description: Rules for using x-data-spreadsheet in investors.html without page-crashing uncaught exceptions, and the formula/formatting approach settled on.
---

## Rules

1. **No `format` in styles.** x-data-spreadsheet's numbro formatter (called from the style's `format` property) runs in rAF and crashes on `Infinity`, `NaN`, or formula error strings. Leave all style objects without a `format` key.

2. **Guard all division with IF().** The formula engine throws non-Error strings (e.g. `"#DIV/0!"`) inside `requestAnimationFrame` callbacks — outside any `try-catch` — crashing the page. Every division must be `=IF(denom=0, 0, …)`. Safe operations (multiply, add, subtract, cell reference) do not crash.

3. **No `x_spreadsheet.format()` registration.** The CDN build of v1.1.9 does not expose a `.format()` static method.

4. **Total row is pre-computed text.** The Total row uses JS-computed numbers (`.toFixed(2)`) in cell `text`, never formula strings. This keeps totals crash-free regardless of what the user edits in the holding rows.

5. **60-second refresh re-initialises the grid.** `doRefresh` → `renderDetail` → `setTimeout(initSpreadsheetGrid, 30)` fires every 60 s when the user is on the Spreadsheet tab. Any crash inside `initSpreadsheetGrid` appears as an uncaught exception every minute.

**Why:** x-data-spreadsheet v1.1.9 (CDN) evaluates formulas and applies number formats inside `requestAnimationFrame` or similar async callbacks. JS `try-catch` cannot intercept errors thrown there.

## Current column layout & formula approach

Columns 0-8 (A-I):
- A (0) Symbol — text
- B (1) Name — text
- C (2) Quantity — raw number input (`.toFixed(4)`)
- D (3) Avg Fill (R) — raw number input (`.toFixed(4)`)
- E (4) Total Avg Fill (R) — **formula** `=C{r}*D{r}`
- F (5) Market Value (R) — raw number input, seeded from live price (`.toFixed(2)`)
- G (6) P&L (R) — **formula** `=F{r}-E{r}`
- H (7) P&L % — **formula** `=IF(E{r}=0,0,(F{r}-E{r})*100/E{r})`
- I (8) Total Value (R) — **formula** `=F{r}`

Cash row: always shown (even when 0), placed at spreadsheet row `holdings.length+1`.
Total row: pre-computed, at spreadsheet row `holdings.length+2`.

**Why formulas for calculated cells:** user expects to click a cell and see the formula in the formula bar (Excel behaviour). Static pre-computed text showed the display value in the formula bar instead.

**Trade-off accepted:** Formula cells show raw numbers (no R prefix). Column headers include "(R)" suffix to indicate the currency unit. Input cells also show raw numbers for formula referencing to work correctly — mixing formatted strings like "R 5.00" with formula references breaks the formula engine.

## How to apply
In `spreadsheetGridData` in `public/investors.html`:
- Use `=` prefix strings in cell `text` only for safe or IF-guarded operations.
- Seed input cells with `.toFixed(N)` raw numbers, never formatted strings, so formula references to them work.
- Styles array: bold/bgcolor/color only, no `format` key ever.
- Keep the Total row as pre-computed `toFixed(2)` strings.
