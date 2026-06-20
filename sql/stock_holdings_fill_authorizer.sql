-- Track WHO authorized an avg_fill (and when), so the orderbook can show
-- accountability next to each filled price. Stamped server-side by
-- /api/orderbook/update-price (used by both the broker-fills Excel upload and
-- the manual pencil), from the authenticated admin's token — never client input.
ALTER TABLE public.stock_holdings_c
  ADD COLUMN IF NOT EXISTS fill_set_by text,
  ADD COLUMN IF NOT EXISTS fill_set_at timestamptz;
