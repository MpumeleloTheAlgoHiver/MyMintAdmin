---
name: Rebalance owner scope
description: Durable ownership and cash-allocation rules for mixed parent and family-member strategy rebalances
---

All-owner rebalances must treat `(user_id, family_member_id)` as the owner identity. A single user can legitimately have both parent-owned and family-member-owned holdings, and those balances, allocations, pending-order swaps, and rebalance events must never merge.

**Why:** User-only maps and a single family-member value per batch caused parent/child holdings to be omitted or assigned to the wrong owner when one strategy contained both scopes.

**How to apply:** Use an explicit All owners sentinel only for loading/filtering. Once holdings are loaded, preserve each row's family member and write that value on every sell, buy, liquidation, wallet-only, residual, reserve, and pending-order operation. Keep explicit parent-only and child-only scopes for targeted corrections.