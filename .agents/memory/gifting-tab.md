---
name: Gifting tab architecture
description: How the Gifts tab in orderbook.html is wired to the gifting backend, which tables it queries, and how the two gift sources are combined.
---

# Gifting tab

## Sources
The `/api/gifting` endpoint (api/gifting.js) queries two separate sources and normalises them into one shape:

1. **`gift_authorizations`** (new Mint platform registry-based gifts) — joined with `gift_registry_items`, `gift_events`, `profiles`. These rows have `_source: 'authorization'` and support Fill / Cancel / Approve / Reject actions.
2. **`gift_claims`** (legacy direct gifts) — joined with `profiles`. These rows have `_source: 'claim'` and are read-only in the CRM (no action buttons).

Both tables are queried with the Supabase service-role key, so RLS is bypassed.

## Status lifecycle (gift_authorizations)
AUTHORIZED → PARKED → WORKING → FILLED  
WORKING → PENDING_GIFTER_APPROVAL → FILLED (approve) or CANCELLED (reject)  
Any non-terminal → CANCELLED (admin cancel)

**Why:** The CRM fill action only patches `gift_authorizations`. It does NOT yet write `stock_holdings_c` or debit the wallet — that is the Mint platform settlement worker's responsibility.

## Schema dependency
`gift_authorizations`, `gift_registry_items`, `gift_events` only exist after running `/tmp/mint-platform/supabase-gift-registry-schema.sql` in the Supabase dashboard. The endpoint handles missing tables gracefully (catches the error, falls back to empty array).

## Tab location
Gifts tab is the 5th tab in `public/orderbook.html` (after Strate BIR). The `setActiveTab` function handles `'gifts'`. Click listener calls `window.loadGifts()` on first open. Red badge appears on the tab button when `needs_approval > 0`.

## API route
`server.js` routes `/api/gifting` → `api/gifting.js` inside an async IIFE (same pattern as other orderbook routes). Auth: verifies bearer token via Supabase `/auth/v1/user` endpoint (no specific permission required — any valid admin session).
