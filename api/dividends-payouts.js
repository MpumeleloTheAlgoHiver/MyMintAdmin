'use strict';

const { getPayouts } = require('./dividends-db');

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

/**
 * GET /api/dividends/payouts?run_id=N[&limit=1000]
 * Returns the staged payout rows for a given extraction run.
 */
module.exports = async function dividendsPayoutsHandler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }

  const url = new URL(req.url, 'http://x');
  const runId = url.searchParams.get('run_id');
  const rawLimit = Number(url.searchParams.get('limit') || 2000);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 5000) : 2000;

  if (!runId || isNaN(Number(runId))) {
    return sendJson(res, 400, { ok: false, error: 'run_id query param required' });
  }

  try {
    const payouts = await getPayouts(Number(runId), limit);
    return sendJson(res, 200, { ok: true, run_id: Number(runId), payouts });
  } catch (err) {
    console.error('[dividends-payouts]', err.message);
    return sendJson(res, 500, { ok: false, error: err.message });
  }
};
