const { sendJson, fetchSupabaseJson, requestSupabaseJson, buildInFilter } = require('../_orderbook');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    return sendJson(res, 401, { error: 'Missing Authorization bearer token' });
  }

  try {
    await fetchSupabaseJson('/auth/v1/user', token, false);

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const ids = Array.isArray(body.ids) ? body.ids.map((value) => String(value || '').trim()).filter(Boolean) : [];
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;

    if (!ids.length) {
      return sendJson(res, 400, { error: 'No ids provided' });
    }

    if (!payload || !Object.keys(payload).length) {
      return sendJson(res, 400, { error: 'No payload provided' });
    }

    const updatedRows = await requestSupabaseJson(
      `/rest/v1/stock_holdings_c?id=in.(${buildInFilter(ids)})&select=id`,
      {
        method: 'PATCH',
        token,
        useServiceRoleAuth: true,
        body: payload,
        extraHeaders: {
          Prefer: 'return=representation'
        }
      }
    );

    const updatedCount = Array.isArray(updatedRows) ? updatedRows.length : 0;
    if (!updatedCount) {
      return sendJson(res, 409, {
        error: 'No rows were updated',
        ids
      });
    }

    return sendJson(res, 200, {
      ok: true,
      updatedCount,
      updatedIds: updatedRows.map((row) => row.id)
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Could not update orderbook price',
      details: error?.message || 'Unknown error'
    });
  }
};