-- 2026-07-23: rebalance_batch has no family_member_id, so the "one PENDING
-- batch per strategy" guard used by all three commit paths (buy-rebalance,
-- liquidate-to-cash, wallet-only-buy) blocks EVERY owner sharing a strategy,
-- not just the one who actually has a pending batch. Concretely: a parent
-- (Sliziwe) rebalances a strategy -> a PENDING batch is created with no
-- owner scope -> a completely unrelated child (Ncumolwethu) on the SAME
-- strategy is then refused with "a pending rebalance already exists",
-- even though nothing of theirs is actually pending.
--
-- rebalance_event already carries family_member_id (added previously,
-- outside this sql/ folder) per event row. Add the same column to
-- rebalance_batch and backfill it from each batch's own events so existing
-- PENDING batches (e.g. Sliziwe's) get correctly scoped retroactively and
-- stop blocking other owners.

ALTER TABLE rebalance_batch
  ADD COLUMN IF NOT EXISTS family_member_id uuid;

UPDATE rebalance_batch b
SET family_member_id = sub.family_member_id
FROM (
  SELECT DISTINCT ON (batch_id) batch_id, family_member_id
  FROM rebalance_event
  ORDER BY batch_id, created_at
) sub
WHERE b.id = sub.batch_id
  AND b.family_member_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_rebalance_batch_strategy_owner_pending
  ON rebalance_batch (strategy_id, family_member_id, status);
