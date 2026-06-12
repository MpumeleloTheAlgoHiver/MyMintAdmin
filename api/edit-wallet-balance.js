const { sendJson, fetchSupabaseJson, requestSupabaseJson } = require('./_orderbook');

const parseBearerToken = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.split(' ')[1];
};

const readJsonBody = (req) => {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    return sendJson(res, 401, { error: 'Missing Authorization bearer token' });
  }

  try {
    await fetchSupabaseJson('/auth/v1/user', token, false);
    
    let body;
    try {
      body = (req.body && typeof req.body === 'object') ? req.body : await readJsonBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: 'body-parse: ' + e.message });
    }

    const { wallet_id, new_balance } = body;

    if (!wallet_id || typeof new_balance !== 'number' || new_balance < 0) {
      return sendJson(res, 400, { error: 'Invalid wallet_id or new_balance (must be >= 0)' });
    }

    // Fetch current wallet
    const wallets = await fetchSupabaseJson(`/rest/v1/wallets?id=eq.${encodeURIComponent(wallet_id)}&select=id,user_id,balance`, token, true);
    
    if (!Array.isArray(wallets) || wallets.length === 0) {
      return sendJson(res, 404, { error: 'Wallet not found' });
    }

    const wallet = wallets[0];
    const oldBalance = Number(wallet.balance);
    const diff = new_balance - oldBalance;

    // Record adjustment transaction (only if there's a difference)
    if (diff !== 0) {
      // The DB trigger 'process_wallet_transaction' will automatically update the wallets.balance
      await requestSupabaseJson('/rest/v1/wallet_transactions', {
        method: 'POST',
        useServiceRoleAuth: true,
        body: {
          wallet_id: wallet.id,
          user_id: wallet.user_id,
          amount: diff,
          transaction_type: 'adjustment',
          reference: `Admin adjustment: ${oldBalance} → ${new_balance}`,
          created_at: new Date().toISOString()
        }
      });
    }

    return sendJson(res, 200, {
      ok: true,
      wallet_id: wallet.id,
      old_balance: oldBalance,
      new_balance,
      adjustment: diff
    });
  } catch (error) {
    console.error('Edit wallet balance error:', error);
    return sendJson(res, 500, {
      error: 'Could not edit wallet balance',
      details: error?.message || 'Unknown error'
    });
  }
};
