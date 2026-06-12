const { sendJson, fetchSupabaseJson, requestSupabaseJson } = require('./_orderbook');

const parseBearerToken = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.split(' ')[1];
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    return sendJson(res, 401, { error: 'Missing Authorization bearer token' });
  }

  const wallet_id = req.query.wallet_id;
  if (!wallet_id) {
    return sendJson(res, 400, { error: 'Missing wallet_id' });
  }

  try {
    // Verify user is authenticated
    await fetchSupabaseJson('/auth/v1/user', token, false);
    
    // Fetch latest transaction using service role key
    const txns = await fetchSupabaseJson(
      `/rest/v1/wallet_transactions?wallet_id=eq.${encodeURIComponent(wallet_id)}&select=amount&order=created_at.desc&limit=1`,
      null, // Don't use user token
      true  // Use service role auth
    );

    if (txns && txns.length > 0) {
      return sendJson(res, 200, { ok: true, amount: txns[0].amount });
    }

    return sendJson(res, 200, { ok: true, amount: null });
  } catch (error) {
    console.error('Fetch latest transaction error:', error);
    return sendJson(res, 500, {
      error: 'Could not fetch latest transaction',
      details: error?.message || 'Unknown error'
    });
  }
};
