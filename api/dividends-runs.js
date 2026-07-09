'use strict';

const { getRuns, getStats, getPayouts } = require('./dividends-db');
const { importCodes, getCodes, getCategories } = require('./alliance-news-db');

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

/**
 * Unified handler for:
 *   GET  /api/dividends/runs                  — recent runs + aggregate stats
 *   GET  /api/dividends/payouts?run_id=N      — staged payout rows for a run
 *   GET  /api/alliance-news                   — query Alliance News codes
 *   GET  /api/alliance-news?action=categories — distinct categories
 *   POST /api/alliance-news?action=import     — (re)seed from Excel (admin-gated)
 */
module.exports = async function dividendsDataHandler(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;

  try {
    /* ── Alliance News ─────────────────────────────────────────────────── */
    if (path.startsWith('/api/alliance-news')) {
      const action = url.searchParams.get('action') || '';

      if (req.method === 'POST' && action === 'import') {
        const auth = req.headers['authorization'] || '';
        if (!auth.startsWith('Bearer ') || !auth.slice(7).trim()) {
          return json(res, 401, { ok: false, error: 'Authorization required' });
        }
        const { requirePermission } = require('./_team');
        if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
        const force = url.searchParams.get('force') === '1';
        const result = await importCodes(force);
        return json(res, 200, { ok: true, ...result });
      }

      if (req.method === 'GET' && action === 'categories') {
        const cats = await getCategories();
        return json(res, 200, { ok: true, categories: cats });
      }

      if (req.method === 'GET') {
        const codes = await getCodes({
          category: url.searchParams.get('category') || undefined,
          region:   url.searchParams.get('region')   || undefined,
          search:   url.searchParams.get('search')   || undefined,
          limit:    url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
        });
        return json(res, 200, { ok: true, codes, count: codes.length });
      }

      return json(res, 405, { ok: false, error: 'Method not allowed' });
    }

    /* ── Dividends: payouts ────────────────────────────────────────────── */
    if (path.startsWith('/api/dividends/payouts')) {
      if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'Method not allowed' });
      const runId  = url.searchParams.get('run_id');
      const rawLim = Number(url.searchParams.get('limit') || 2000);
      const limit  = Number.isFinite(rawLim) && rawLim > 0 ? Math.min(rawLim, 5000) : 2000;
      if (!runId || isNaN(Number(runId))) return json(res, 400, { ok: false, error: 'run_id required' });
      const payouts = await getPayouts(Number(runId), limit);
      return json(res, 200, { ok: true, run_id: Number(runId), payouts });
    }

    /* ── Dividends: runs + stats ───────────────────────────────────────── */
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'Method not allowed' });
    const [runs, stats] = await Promise.all([getRuns(50), getStats()]);
    return json(res, 200, { ok: true, runs, stats });

  } catch (err) {
    console.error('[dividends-data]', err.message);
    return json(res, 500, { ok: false, error: err.message });
  }
};
