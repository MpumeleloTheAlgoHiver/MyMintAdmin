// Rebalance-aware EOD return publisher (Stage 1).
//
// Each trading day this publishes EVERY active strategy through the guarded RPC
// `publish_guarded_strategy_return`, chaining from the strategy's own prior
// publication (its repaired/correct series). A strategy's value is its COMPLETE
// lot = securities (template × latest price) + continuity cash (from its ACTIVE
// valuation rule, else 0). Because complete value is preserved across a rebalance
// (sold securities become continuity cash), a composition change is NOT seen as a
// spike, and YTD chains through instead of resetting. The RPC's own checks
// (identity, full price coverage, freshness, YTD↔chain reconciliation, boundary
// bridge) reject anything inconsistent, so a bad day simply doesn't publish.
//
// SAFE BY DEFAULT: writes only when RETURNS_PUBLISH_APPLY === '1'. Otherwise it
// runs read-only and returns the plan, so it can be deployed and observed first.

const { requestSupabaseJson } = require('./_orderbook');

const toBase = (s) => String(s || '').split('.')[0].toUpperCase();
const q = (v) => encodeURIComponent(String(v));

async function getLatestPublication(strategyId) {
  const rows = await requestSupabaseJson(
    `/rest/v1/strategy_return_publication_audit_c?select=as_of_date,complete_value_cents,composition_effective_from,chain_factor,ytd_pct&strategy_id=eq.${q(strategyId)}&order=as_of_date.desc&limit=1`,
    { method: 'GET' }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// Seed source when a strategy has no publication yet: promoted repair shadow first
// (the repaired truth), else the legacy nightly, else 0.
async function seedYtd(strategyId) {
  const shadow = await requestSupabaseJson(
    `/rest/v1/strategy_returns_shadow_c?select=ytd_pct,return_repair_runs_c!inner(status)&strategy_id=eq.${q(strategyId)}&return_repair_runs_c.status=eq.PROMOTED&order=as_of_date.desc&limit=1`,
    { method: 'GET' }
  ).catch(() => null);
  if (Array.isArray(shadow) && shadow[0]?.ytd_pct != null) return { ytd: Number(shadow[0].ytd_pct), src: 'promoted-shadow' };
  const legacy = await requestSupabaseJson(
    `/rest/v1/strategies_returns_c?select=ytd_pct&strategy_id=eq.${q(strategyId)}&order=as_of_date.desc&limit=1`,
    { method: 'GET' }
  ).catch(() => null);
  if (Array.isArray(legacy) && legacy[0]?.ytd_pct != null) return { ytd: Number(legacy[0].ytd_pct), src: 'legacy' };
  return { ytd: 0, src: 'zero' };
}

async function publishEodReturns({ asOfDate, apply = false } = {}) {
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);

  const strategies = await requestSupabaseJson(
    '/rest/v1/strategies_c?select=id,name,holdings&status=eq.active', { method: 'GET' }
  );
  if (!Array.isArray(strategies) || !strategies.length) return { ok: true, asOf, note: 'no active strategies', results: [] };

  // Template holdings (base symbol + shares) + full symbol universe.
  const tmpl = {}; const bases = new Set();
  for (const s of strategies) {
    const parsed = (s.holdings || [])
      .map((h) => ({ symbol: toBase(h.symbol || h.ticker), shares: Number(h.shares || h.quantity || 1) }))
      .filter((h) => h.symbol);
    tmpl[s.id] = parsed;
    parsed.forEach((h) => bases.add(h.symbol));
  }
  const symUniverse = [...bases, ...[...bases].map((b) => `${b}.JO`)];

  // Latest intraday price per base symbol (last ~4 days keeps the row set small).
  const since = new Date(Date.now() - 4 * 86400000).toISOString();
  const intraday = await requestSupabaseJson(
    `/rest/v1/stock_intraday_c?select=symbol,current_price,timestamp&symbol=in.(${symUniverse.map(q).join(',')})&timestamp=gte.${q(since)}&order=timestamp.desc`,
    { method: 'GET' }
  ).catch(() => []);
  const price = {}, freshTs = {};
  for (const r of (Array.isArray(intraday) ? intraday : [])) {
    const b = toBase(r.symbol);
    if (!price[b] && Number(r.current_price) > 0) { price[b] = Number(r.current_price); freshTs[b] = r.timestamp; }
  }

  // Active valuation rules (continuity cash + composition effective date).
  const rulesRows = await requestSupabaseJson(
    '/rest/v1/strategy_valuation_rules_c?select=strategy_id,effective_from,continuity_cash_per_lot_cents&status=eq.ACTIVE',
    { method: 'GET' }
  ).catch(() => []);
  const ruleBy = {};
  for (const r of (Array.isArray(rulesRows) ? rulesRows : [])) ruleBy[r.strategy_id] = r;

  const results = [];
  let published = 0, skipped = 0, failed = 0;

  for (const s of strategies) {
    const holds = tmpl[s.id] || [];
    const rule = ruleBy[s.id];
    try {
      if (!holds.length) { results.push({ strategy: s.name, action: 'skip', reason: 'no template holdings' }); skipped++; continue; }

      // Securities value from template × latest price; require FULL coverage.
      let secCents = 0, covered = 0, freshest = null;
      const missing = [];
      for (const h of holds) {
        const p = price[h.symbol];
        if (p > 0) { secCents += h.shares * p; covered++; if (!freshest || freshTs[h.symbol] > freshest) freshest = freshTs[h.symbol]; }
        else missing.push(h.symbol);
      }
      if (covered !== holds.length) { results.push({ strategy: s.name, action: 'skip', reason: `missing price: ${missing.join(',')}` }); skipped++; continue; }

      // Freshness: the RPC rejects prices older than 1 day; skip early to avoid noise.
      if (!freshest || new Date(freshest) < new Date(new Date(asOf).getTime() - 86400000)) {
        results.push({ strategy: s.name, action: 'skip', reason: 'stale prices (non-trading day?)' }); skipped++; continue;
      }

      const contCents = rule ? Number(rule.continuity_cash_per_lot_cents) : 0;
      const completeCents = Math.round(secCents) + Math.round(contCents);
      const prev = await getLatestPublication(s.id);

      // Idempotent: already published for this date.
      if (prev && String(prev.as_of_date) === String(asOf)) { results.push({ strategy: s.name, action: 'skip', reason: 'already published today' }); skipped++; continue; }

      const compEffFrom = rule ? rule.effective_from : (prev ? prev.composition_effective_from : `${asOf.slice(0, 4)}-01-01`);

      let chainFactor, ytd, oneDayPct = null, bridge = null, mode;
      if (prev) {
        oneDayPct = ((completeCents - Number(prev.complete_value_cents)) / Number(prev.complete_value_cents)) * 100;
        chainFactor = Number(prev.chain_factor) * (1 + oneDayPct / 100);
        ytd = (chainFactor - 1) * 100;
        const boundary = String(prev.composition_effective_from) !== String(compEffFrom);
        // A composition boundary should be sealed by settlement; if the daily run
        // still sees one, bridge on the (preserved) complete-value move.
        if (boundary) { bridge = oneDayPct; mode = 'chain+bridge'; } else { mode = 'chain'; }
      } else {
        const seed = await seedYtd(s.id);
        ytd = seed.ytd; chainFactor = 1 + ytd / 100; mode = `seed:${seed.src}`;
      }

      const params = {
        p_strategy_id: s.id, p_as_of_date: asOf, p_source_run_id: null,
        p_securities_value_cents: Math.round(secCents), p_continuity_cash_cents: Math.round(contCents),
        p_complete_value_cents: completeCents, p_covered_holdings: covered, p_expected_holdings: holds.length,
        p_freshest_price_at: freshest, p_composition_effective_from: compEffFrom,
        p_holdings_snapshot: holds.map((h) => ({ symbol: h.symbol, shares: h.shares })),
        p_boundary_bridge_pct: bridge, p_chain_factor: chainFactor, p_ytd_pct: ytd,
        p_checks: { source: 'eod_cron', mode }
      };

      if (apply) {
        await requestSupabaseJson('/rest/v1/rpc/publish_guarded_strategy_return', {
          method: 'POST', body: params, extraHeaders: { Prefer: 'return=representation' }
        });
      }
      results.push({ strategy: s.name, action: apply ? 'published' : 'plan', mode, complete: completeCents, ytd: Number(ytd.toFixed(6)), oneDay: oneDayPct == null ? null : Number(oneDayPct.toFixed(6)) });
      published++;
    } catch (err) {
      results.push({ strategy: s.name, action: 'failed', error: err?.message || 'unknown' });
      failed++;
    }
  }

  return { ok: true, asOf, apply, summary: { published, skipped, failed, total: strategies.length }, results };
}

module.exports = { publishEodReturns };
