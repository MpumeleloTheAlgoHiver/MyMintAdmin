# Rebalancing — Analysis & Improvement Suggestions

## The Core Problem

When a strategy has both **parent holders** and **child holders** (family members), the "Owner scope" dropdown on the Rebalancing tab forces the admin to pick one group at a time:

- **"Parent only"** (default) — loads only holdings where `family_member_id IS NULL`
- **"Ncumolwethu Damane"** (or any child) — loads only that child's holdings

There is no **"Everyone"** option. The dropdown should not exist as a required gate — the default behaviour should be to rebalance **all holders of the strategy**, parent and children alike.

---

## Root Cause (Code)

### 1. Hard filter at load time (`rebLoadStrategy`, line 9517)

```js
if ((rebSelectedFamilyMemberId || null) !== fmId) return;
```

When `rebSelectedFamilyMemberId` is `null` (the default), this line **silently drops every child row** from `rebRawHoldings`. The admin never sees the children in the rebalance table, so they are not included in the commit.

### 2. Single `familyMemberIdForEvents` applied to all events (line 10951)

```js
const familyMemberIdForEvents = rebSelectedFamilyMemberId || null;
```

Every `rebalance_event` row inserted by the commit gets the **same** `family_member_id`. This works for a single-scope rebalance but is wrong for an "All" scope — each event needs the family_member_id that belongs to that specific holding row.

### 3. Dropdown defaults to "Parent only" with no "All" option

The dropdown is populated at line 9580:

```js
fmSel.innerHTML = '<option value="">Parent only</option>'
  + rebFamilyMembersForStrategy.map(...).join("");
```

There is no option that means "include every owner". Choosing the blank value (`""`) maps to `null`, which means parent-only, not all.

---

## How the Flow Should Work

### Current (broken for mixed strategies)

```
Admin selects strategy
  → Dropdown shows: [Parent only] [Child A] [Child B]
  → Admin must pick ONE scope
  → Only that scope's holdings load
  → Only that scope's events are committed
  → Admin must repeat the whole rebalance for each child separately
```

### Proposed (correct)

```
Admin selects strategy
  → Dropdown shows: [All owners ✓ default] [Parent only] [Child A] [Child B]
  → Default = "All owners"
  → ALL holdings load, grouped by (userId, familyMemberId)
  → Each rebalance_event carries its own correct family_member_id
  → One commit covers everyone — parent and children
  → Scoped options remain available for edge cases (e.g. a child joined late and
    has a different effective date, or only one owner needs a correction)
```

---

## Suggested Changes

### Change 1 — Add "All owners" as the first (default) option

Replace the dropdown's first option from `"Parent only"` to `"All owners"`. Use a sentinel value (e.g. `"__all__"`) so `""` / `null` can no longer be ambiguous between "nothing selected yet" and "parent only".

```
Option value=""        → placeholder (select a scope…)       [remove this]
Option value="__all__" → All owners                           [NEW default]
Option value="__parent_only__" → Parent only                  [explicit, not default]
Option value="<uuid>"  → Child name                           [unchanged]
```

### Change 2 — Remove the scope filter when "All owners" is selected

In `rebLoadStrategy`, when the scope is `__all__`, **skip** the `if (rebSelectedFamilyMemberId !== fmId) return;` line. All rows for the strategy load, each retaining their own `family_member_id`.

```js
// Before (line 9517):
if ((rebSelectedFamilyMemberId || null) !== fmId) return;

// After:
const scopeIsAll = rebSelectedFamilyMemberId === '__all__';
if (!scopeIsAll && (rebSelectedFamilyMemberId || null) !== fmId) return;
```

### Change 3 — Per-row family_member_id in rebalance_event inserts

When scope is "All owners", each entry in `rebRawHoldings` already carries its own `familyMemberId`. The commit loop (`rebPersistCommittedTradeSequence`) must use the per-row value instead of the single `familyMemberIdForEvents`:

```js
// Before (line 10951 area):
const familyMemberIdForEvents = rebSelectedFamilyMemberId || null;
// ... later:
family_member_id: familyMemberIdForEvents,

// After:
const scopeIsAll = rebSelectedFamilyMemberId === '__all__';
// ... inside the per-client loop:
family_member_id: scopeIsAll ? (client.familyMemberId ?? null) : (rebSelectedFamilyMemberId || null),
```

The `familyMemberId` field is already stored on each entry in `rebRawHoldings` (added at line 9561), so this value is available — it just isn't used today.

### Change 4 — Residual / wallet lookups must cover all scopes

`rebLoadWalletBalances` and `rebLoadReserveBalances` are called with `scopedUserIds` but the residual query also filters by `family_member_id`. When "All owners" is active, the residual fetch should **not** restrict by `family_member_id`, or should fetch one row per `(user_id, family_member_id)` pair and then join them to the right owner at render time.

### Change 5 — Settlement (orderbook) requires no changes

The settlement flow reads events from `rebalance_event` by `batch_id` and uses each event's own `family_member_id` to write back to `stock_holdings_c`. Because the fix above puts the correct `family_member_id` on each event at commit time, settlement will work correctly with no changes.

---

## Scope Dropdown — When Is It Still Useful?

Even after adding "All owners" as the default, keeping the scoped options is valuable for:

| Scenario | Scope to use |
|---|---|
| Child joined the strategy after the effective date (parent still qualifies) | Parent only |
| A single child's holding needs a correction after a bad fill | That child specifically |
| Testing a new rebalance path against one owner before rolling out | Any single scope |

The dropdown should **remain visible** but default to "All owners" and carry a clear label so admins understand what they are scoping.

---

## Summary of Files to Touch

| File | Change |
|---|---|
| `public/dashboard.html` (line ~1128) | Replace `<option value="">Parent only</option>` with "All owners" as default + explicit "Parent only" option |
| `public/dashboard.html` (line ~9517) | Skip family_member filter when scope is `__all__` |
| `public/dashboard.html` (line ~9580) | Repopulate dropdown with new sentinel values |
| `public/dashboard.html` (line ~10951) | Use per-row `familyMemberId` when committing in "All" scope |
| `public/dashboard.html` (line ~9088) | Pass correct scope to residual/wallet fetch |

No backend (`server.js`, `api/`) or database changes are needed — the schema already supports per-event `family_member_id`. This is a pure frontend fix.

---

## Risk / Rollback

- **Low risk**: the scoped options still exist; admins can still scope to parent-only or a single child if needed.
- **The only breaking change** is the default: today's default silently excluded children. The new default intentionally includes them. Any existing PENDING batches are unaffected — they were committed under the old scope and settle normally.
- If a bug is found after release, reverting a single `if` line in `rebLoadStrategy` restores the old scoped-only behaviour.
