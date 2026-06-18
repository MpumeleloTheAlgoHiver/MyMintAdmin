/**
 * api/strategies-sync.js
 * Calculates and writes 1d_pct to strategies_returns_c for all active strategies.
 *
 * Formula:
 *   strategy_1d_pct = Σ(current_price_cents × shares × holding_1d_pct) / Σ(current_price_cents × shares)
 *
 * Source data: stock_intraday_c (latest row per security)
 * Target:      strategies_returns_c — PATCHes the latest as_of_date row per strategy
 *
 * Triggered by:
 *   1. POST /api/strategies/sync-daily-returns  (manual / webhook)
 *   2. Hourly scheduler in server.js (during JSE market hours)
 */

const SB_URL = () => process.env.SUPABASE_URL;
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

const sbGet = async (path) => {
  if (!SB_URL() || !SB_KEY()) throw new Error('Supabase credentials not configured');
  const res = await fetch(`${SB_URL()}${path}`, {
    headers: {
      'apikey': SB_KEY(),
      'Authorization': `Bearer ${SB_KEY()}`,
      'Accept': 'application/json'
    }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || data?.error || `Supabase GET error ${res.status}`);
  return data || [];
};

const sbPatch = async (path, body) => {
  if (!SB_URL() || !SB_KEY()) throw new Error('Supabase credentials not configured');
  const res = await fetch(`${SB_URL()}${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SB_KEY(),
      'Authorization': `Bearer ${SB_KEY()}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || data?.error || `Supabase PATCH error ${res.status}`);
  }
};

const buildTextInFilter = (values) =>
  values.map(v => `%22${encodeURIComponent(String(v))}%22`).join(',');

const buildUuidInFilter = (values) =>
  values.map(v => encodeURIComponent(String(v))).join(',');

const syncStrategyDailyReturns = async () => {
  if (!SB_URL() || !SB_KEY()) throw new Error('Supabase credentials not configured');

  const startMs = Date.now();

  // ── 1. Fetch all active strategies with their holdings ──────────────────────
  const strategies = await sbGet(
    '/rest/v1/strategies_c?select=id,name,holdings&status=eq.active&limit=500'
  );

  if (!strategies.length) {
    return { updated: 0, skipped: 0, total: 0, message: 'No active strategies found' };
  }

  // ── 2. Collect all unique ticker symbols across holdings ─────────────────────
  const allSymbols = new Set();
  strategies.forEach(s => {
    (Array.isArray(s.holdings) ? s.holdings : []).forEach(h => {
      const sym = h.ticker || h.symbol || (typeof h === 'string' ? h : '');
      if (sym) allSymbols.add(sym);
    });
  });

  if (!allSymbols.size) {
    return { updated: 0, skipped: strategies.length, total: strategies.length, message: 'No holdings found in any strategy' };
  }

  // ── 3. Resolve symbol → security_id from securities_c ───────────────────────
  const symbolArr = [...allSymbols];
  const CHUNK = 50;
  const symbolToId = {};

  for (let i = 0; i < symbolArr.length; i += CHUNK) {
    const batch = symbolArr.slice(i, i + CHUNK);
    const rows = await sbGet(
      `/rest/v1/securities_c?select=id,symbol&symbol=in.(${buildTextInFilter(batch)})&limit=200`
    );
    rows.forEach(r => { symbolToId[r.symbol] = r.id; });
  }

  const secIds = [...new Set(Object.values(symbolToId))];
  if (!secIds.length) {
    return { updated: 0, skipped: strategies.length, total: strategies.length, message: 'No security IDs resolved from symbols' };
  }

  // ── 4. Fetch latest intraday row per security from stock_intraday_c ──────────
  // Fetch with high limit ordered desc by timestamp, then deduplicate in JS
  const intradayMap = {};

  for (let i = 0; i < secIds.length; i += CHUNK) {
    const batch = secIds.slice(i, i + CHUNK);
    const rows = await sbGet(
      `/rest/v1/stock_intraday_c?select=security_id,current_price,1d_pct,timestamp&security_id=in.(${buildUuidInFilter(batch)})&order=timestamp.desc&limit=500`
    );
    // Keep only the first (most recent) row per security
    rows.forEach(r => {
      if (!intradayMap[r.security_id]) intradayMap[r.security_id] = r;
    });
  }

  // ── 5. Find the latest as_of_date in strategies_returns_c ───────────────────
  const latestDateRows = await sbGet(
    '/rest/v1/strategies_returns_c?select=as_of_date&order=as_of_date.desc&limit=1'
  );
  const latestDate = latestDateRows[0]?.as_of_date;
  if (!latestDate) {
    return { updated: 0, skipped: strategies.length, total: strategies.length, message: 'No existing rows found in strategies_returns_c — cannot PATCH' };
  }

  // ── 6. Calculate weighted 1d_pct per strategy and PATCH ─────────────────────
  let updated = 0;
  let skipped = 0;
  const details = [];

  for (const strategy of strategies) {
    const holdings = Array.isArray(strategy.holdings) ? strategy.holdings : [];
    if (!holdings.length) {
      skipped++;
      details.push({ id: strategy.id, name: strategy.name, reason: 'no_holdings' });
      continue;
    }

    let wSum = 0;
    let wTotal = 0;
    let resolved = 0;

    holdings.forEach(h => {
      const sym = h.ticker || h.symbol || (typeof h === 'string' ? h : '');
      const secId = symbolToId[sym];
      const iv = secId ? intradayMap[secId] : null;
      if (!iv) return;

      const cp  = iv.current_price != null ? Number(iv.current_price) : null;
      const pct = iv['1d_pct']     != null ? Number(iv['1d_pct'])     : null;
      const qty = Number(h.shares || h.quantity) || 0;

      if (cp != null && pct != null && qty > 0) {
        const w = cp * qty;
        wSum   += w * pct;
        wTotal += w;
        resolved++;
      }
    });

    if (wTotal === 0) {
      skipped++;
      details.push({ id: strategy.id, name: strategy.name, reason: 'no_intraday_data', resolved });
      continue;
    }

    const daily1dPct = wSum / wTotal;

    try {
      await sbPatch(
        `/rest/v1/strategies_returns_c?strategy_id=eq.${encodeURIComponent(strategy.id)}&as_of_date=eq.${encodeURIComponent(latestDate)}`,
        { '1d_pct': daily1dPct }
      );
      updated++;
      details.push({ id: strategy.id, name: strategy.name, daily1dPct: +daily1dPct.toFixed(4), resolved, latestDate });
    } catch (err) {
      skipped++;
      details.push({ id: strategy.id, name: strategy.name, reason: 'patch_failed', error: err.message });
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`[StrategySync] Done in ${elapsed}s — updated: ${updated}, skipped: ${skipped}/${strategies.length}, date: ${latestDate}`);

  return { updated, skipped, total: strategies.length, latestDate, elapsed: `${elapsed}s`, details };
};

module.exports = { syncStrategyDailyReturns };
