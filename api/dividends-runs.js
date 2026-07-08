'use strict';

const { getRuns, getStats } = require('./dividends-db');

/**
 * GET /api/dividends/runs  — returns recent runs + aggregate stats
 */
module.exports = async function dividendsRunsHandler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  }

  try {
    const [runs, stats] = await Promise.all([getRuns(50), getStats()]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, runs, stats }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
};
