'use strict';

const { importCodes, getCodes, getCategories } = require('./alliance-news-db');

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

/**
 * /api/alliance-news
 *   GET  ?category=X&region=Y&search=Z  — query codes
 *   GET  ?action=categories             — list distinct categories
 *   POST ?action=import[&force=1]       — (re)seed from Excel
 */
module.exports = async function allianceNewsHandler(req, res) {
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || '';

  try {
    if (req.method === 'POST' && action === 'import') {
      // Require admin bearer token (Supabase service role checked via team permissions)
      const auth = req.headers['authorization'] || '';
      if (!auth.startsWith('Bearer ') || !auth.slice(7).trim()) {
        return sendJson(res, 401, { ok: false, error: 'Authorization required' });
      }
      const { requirePermission } = require('./_team');
      if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
      const force = url.searchParams.get('force') === '1';
      const result = await importCodes(force);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === 'GET' && action === 'categories') {
      const cats = await getCategories();
      return sendJson(res, 200, { ok: true, categories: cats });
    }

    if (req.method === 'GET') {
      const codes = await getCodes({
        category: url.searchParams.get('category') || undefined,
        region:   url.searchParams.get('region')   || undefined,
        search:   url.searchParams.get('search')   || undefined,
        limit:    url.searchParams.get('limit')    ? Number(url.searchParams.get('limit')) : undefined,
      });
      return sendJson(res, 200, { ok: true, codes, count: codes.length });
    }

    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[alliance-news]', err.message);
    sendJson(res, 500, { ok: false, error: err.message });
  }
};
