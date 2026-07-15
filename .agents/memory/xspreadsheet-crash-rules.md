---
name: x-data-spreadsheet crash rules
description: Rules for using x-data-spreadsheet in investors.html without page-crashing uncaught exceptions
---

## Rules

1. **No formula cells.** The formula engine throws non-Error strings (e.g. `"#DIV/0!"`) inside `requestAnimationFrame` callbacks — outside any `try-catch` — crashing the page with "An uncaught exception occured but the error was not an error object." Pre-compute all values in JS and use static text cells only.

2. **No `format` in styles.** x-data-spreadsheet's numbro formatter (called from the style's `format` property) also runs in rAF and crashes on `Infinity`, `NaN`, or formula error strings. Leave all style objects without a `format` key. Apply R prefix and % suffix directly in the cell `text` string instead (e.g. `fmtRands(n)` → `"R 730.85"`, `fmtPct(n)` → `"7.55%"`).

3. **No `x_spreadsheet.format()` registration.** The CDN build of v1.1.9 does not expose a `.format()` static method. Calling it throws immediately: `"x_spreadsheet.format is not a function"`.

4. **60-second refresh re-initialises the grid.** `doRefresh` → `renderDetail` → `setTimeout(initSpreadsheetGrid, 30)` fires every 60 s when the user is on the Spreadsheet tab. Any crash inside `initSpreadsheetGrid` appears as an uncaught exception every minute.

**Why:** x-data-spreadsheet v1.1.9 (CDN) evaluates formulas and applies number formats inside `requestAnimationFrame` or similar async callbacks. JS `try-catch` cannot intercept errors thrown there.

**How to apply:** In `spreadsheetGridData` in `public/investors.html`, always pre-compute cell values in JS before building the rows object. Use `fmtRands(n)` and `fmtPct(n)` helpers for display formatting. Set styles only for bold/bgcolor/color — never include a `format` property.
