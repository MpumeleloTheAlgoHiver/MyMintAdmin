---
name: Rebalance owner scope
description: Durable ownership and cash-allocation rules for mixed parent and family-member strategy rebalances
---

All-owner rebalances must treat `(user_id, family_member_id)` as the owner identity. A single user can legitimately have both parent-owned and family-member-owned holdings, and those balances, allocations, pending-order swaps, and rebalance events must never merge.

**Why:** User-only maps and a single family-member value per batch caused parent/child holdings to be omitted or assigned to the wrong owner when one strategy contained both scopes.

**How to apply:** Use an explicit All owners sentinel only for loading/filtering. Once holdings are loaded, preserve each row's family member and write that value on every sell, buy, liquidation, wallet-only, residual, reserve, and pending-order operation. Keep explicit parent-only and child-only scopes for targeted corrections.

Pending rebalance previews are strategy-level: when a strategy has a pending batch, mark every eligible owner in the strategy as pending, even if that owner has no event row for the currently selected instrument. Keep event rows for trade-side labels, not for deciding who is affected.

**Why:** A rebalance changes the strategy composition for all eligible owners; event-only highlighting incorrectly made some family members appear unaffected.

**How to apply:** Build the preview pending set from the loaded strategy owners, preserve composite owner keys, and include zero-position owners in the preview when a pending batch exists.

The Rebalances tab must resolve display names from the same composite owner key: use `family_members` when `family_member_id` is present, and `profiles` only when it is null. Load family-member records from rebalance events as well as holdings because pending events may exist before child holdings are settled.

**Why:** A pending test-strategy batch showed the parent name for child events and duplicated one owner because the UI only loaded family members from current holdings.

**How to apply:** Preserve `family_member_id` through event normalization and use `(user_id, family_member_id)` for client counts and display grouping.