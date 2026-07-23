---
name: Strategy child-friendly marker
description: The Mint app uses the strategies_c is_kid_strategy flag to include strategies on child dashboards
---

The child-friendly strategy status is represented by `strategies_c.is_kid_strategy`. The admin dashboard’s Strategy Details modal should read and write this field when enabling child dashboard visibility.

**Why:** MyGrowthFund is already registered in the Mint app with this marker set to true, confirming the cross-app contract.

**How to apply:** Keep the field name `is_kid_strategy` unchanged in strategy queries and updates; do not introduce a parallel child-friendly flag.