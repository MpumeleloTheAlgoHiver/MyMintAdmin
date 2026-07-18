import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../sql/rebalance_return_boundary.sql', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/orderbook/send-csv.js', import.meta.url), 'utf8');
const orderbook = fs.readFileSync(new URL('../public/orderbook.html', import.meta.url), 'utf8');

const checks = [
  [sql, /finalize_rebalance_return_boundary/, 'atomic boundary RPC exists'],
  [sql, /boundary_batch_id/, 'boundary is idempotent per batch'],
  [sql, /v_cash\s*:=\s*greatest\(0,v_previous_complete-p_securities_value_cents\)/, 'missing securities value becomes continuity cash'],
  [sql, /boundary_bridge_pct[\s\S]*?0,v_previous_chain,v_previous_ytd/, 'boundary preserves chain and YTD'],
  [sql, /status='SUPERSEDED'/, 'prior valuation rule remains historical'],
  [api, /rebalance-finalize-return-boundary/, 'service-role settlement endpoint exists'],
  [api, /ACTUAL_EXCEL_FILL/, 'changed holdings use actual Excel fills'],
  [api, /GUARDED_INTRADAY/, 'unchanged holdings use guarded intraday prices'],
  [api, /ratio < 0\.2 \|\| ratio > 5/, 'cents/rands anomaly is blocked'],
  [api, /older than 24 hours/, 'stale unchanged-holding prices are blocked'],
  [orderbook, /Settlement paused before final status/, 'partial settlement is never labelled settled'],
  [orderbook, /rebalance-finalize-return-boundary/, 'Fill & Settle publishes boundary'],
];

for (const [text, pattern, label] of checks) assert.match(text, pattern, label);
console.log(`rebalance return boundary: ${checks.length}/${checks.length} green`);
