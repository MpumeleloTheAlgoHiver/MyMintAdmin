const { sendJson, fetchSupabaseJson, requestSupabaseJson } = require('./_orderbook');
const { logEmail } = require('./_email-logger');

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

// ── Add to Wallet ─────────────────────────────────────────────────────────────
const handleAddWallet = async (req, res) => {
  let body;
  try {
    body = (req.body && typeof req.body === 'object') ? req.body : await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: 'body-parse: ' + e.message });
  }

  const { user_id, amount, account_type } = body || {};

  if (!user_id) return sendJson(res, 400, { error: 'Missing user_id' });
  if (!amount || Number(amount) <= 0) return sendJson(res, 400, { error: 'Invalid amount' });

  const numericAmount = Number(amount);

  // Child accounts live in family_members — fk_user would be violated in wallets
  if (account_type === 'child') {
    try {
      const members = await fetchSupabaseJson(
        `/rest/v1/family_members?id=eq.${encodeURIComponent(user_id)}&select=id,available_balance,primary_user_id&limit=1`
      );
      if (!Array.isArray(members) || members.length === 0) {
        return sendJson(res, 404, { error: 'Child account not found' });
      }
      const member = members[0];
      const amountCents = Math.round(numericAmount * 100);
      const newBalance = Number(member.available_balance || 0) + amountCents;
      const nowIso = new Date().toISOString();
      await requestSupabaseJson(`/rest/v1/family_members?id=eq.${encodeURIComponent(user_id)}`, {
        method: 'PATCH',
        useServiceRoleAuth: true,
        body: { available_balance: newBalance, updated_at: nowIso },
      });
      const parentUserId = member.primary_user_id;
      if (parentUserId) {
        try {
          await requestSupabaseJson('/rest/v1/transactions', {
            method: 'POST',
            useServiceRoleAuth: true,
            body: {
              user_id: parentUserId,
              family_member_id: user_id,
              amount: amountCents,
              direction: 'credit',
              status: 'posted',
              name: 'Top Up',
              description: 'Wallet top up',
              currency: 'ZAR',
              transaction_date: nowIso,
            },
          });
        } catch (txnErr) {
          console.error('Child transaction insert failed:', txnErr.message);
        }
      }
    } catch (e) {
      return sendJson(res, 500, { error: 'child-wallet-upsert: ' + e.message });
    }
    return sendJson(res, 200, { success: true });
  }

  let existing;
  try {
    existing = await fetchSupabaseJson(
      `/rest/v1/wallets?user_id=eq.${encodeURIComponent(user_id)}&limit=1`
    );
  } catch (e) {
    return sendJson(res, 500, { error: 'wallet-fetch: ' + e.message });
  }

  let walletId;
  try {
    if (existing && existing.length > 0) {
      const wallet = existing[0];
      walletId = wallet.id;
      const currentBalance = Number(wallet.balance || 0);
      const newBalance = currentBalance + numericAmount;
      // Reset mailer to null so the "Send Notice" button reactivates for the new top-up
      await requestSupabaseJson(`/rest/v1/wallets?id=eq.${encodeURIComponent(walletId)}`, {
        method: 'PATCH',
        useServiceRoleAuth: true,
        body: { balance: newBalance, mailer: null, updated_at: new Date().toISOString() },
      });
    } else {
      const created = await requestSupabaseJson('/rest/v1/wallets', {
        method: 'POST',
        useServiceRoleAuth: true,
        body: { user_id, balance: numericAmount, currency: 'ZAR' },
        extraHeaders: { Prefer: 'return=representation' },
      });
      if (Array.isArray(created) && created[0]) {
        walletId = created[0].id;
      } else if (created) {
        walletId = created.id;
      }
    }
  } catch (e) {
    return sendJson(res, 500, { error: 'wallet-upsert: ' + e.message });
  }

  return sendJson(res, 200, { success: true, wallet_id: walletId, amount: numericAmount });
};

// ── Send EFT Email ────────────────────────────────────────────────────────────
const handleSendEftEmail = async (req, res) => {
  const body = typeof req.body === 'object' ? req.body : await readJsonBody(req);
  const { to, subject, html, walletId } = body;

  if (!to || !html) {
    return sendJson(res, 400, { error: 'Missing to or html payload' });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const orderbookEmailFrom = process.env.ORDERBOOK_EMAIL_FROM;

  if (!resendApiKey || !orderbookEmailFrom) {
    return sendJson(res, 500, { error: 'Email service not configured. Set RESEND_API_KEY and ORDERBOOK_EMAIL_FROM' });
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: orderbookEmailFrom,
      to: [to],
      subject: subject || 'Funds Allocated - Mint',
      html: html
    })
  });

  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }

  if (!response.ok) {
    const message = payload?.message || payload?.error || `Resend request failed with ${response.status}`;
    throw new Error(message);
  }

  const resendId = payload?.id || null;
  await logEmail({
    emailType: 'eft',
    recipient: to,
    subject: subject || 'Funds Allocated - Mint',
    resendId,
    status: 'sent',
    triggerSource: 'manual',
    metadata: walletId ? { wallet_id: walletId } : null
  });

  if (walletId) {
    await requestSupabaseJson(`/rest/v1/wallets?id=eq.${encodeURIComponent(walletId)}`, {
      method: 'PATCH',
      useServiceRoleAuth: true,
      body: { mailer: 'sent' }
    });
  }

  return sendJson(res, 200, { ok: true, message: 'Email sent successfully' });
};

// ── Edit Wallet Balance ───────────────────────────────────────────────────────
const handleEditBalance = async (req, res, token) => {
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

  const wallets = await fetchSupabaseJson(`/rest/v1/wallets?id=eq.${encodeURIComponent(wallet_id)}&select=id,user_id,balance`, token, true);

  if (!Array.isArray(wallets) || wallets.length === 0) {
    return sendJson(res, 404, { error: 'Wallet not found' });
  }

  const wallet = wallets[0];
  const oldBalance = Number(wallet.balance);
  const diff = new_balance - oldBalance;

  if (diff !== 0) {
    await requestSupabaseJson(`/rest/v1/wallets?id=eq.${encodeURIComponent(wallet_id)}`, {
      method: 'PATCH',
      useServiceRoleAuth: true,
      body: { balance: new_balance, updated_at: new Date().toISOString() }
    });
  }

  return sendJson(res, 200, {
    ok: true,
    wallet_id: wallet.id,
    old_balance: oldBalance,
    new_balance,
    adjustment: diff
  });
};

// ── Latest Wallet Transaction ─────────────────────────────────────────────────
const handleLatestTransaction = async (req, res) => {
  let wallet_id;
  if (req.query && req.query.wallet_id) {
    wallet_id = req.query.wallet_id;
  } else {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      wallet_id = url.searchParams.get('wallet_id');
    } catch (e) {}
  }

  if (!wallet_id) {
    return sendJson(res, 400, { error: 'Missing wallet_id' });
  }

  const txns = await fetchSupabaseJson(
    `/rest/v1/wallet_transactions?wallet_id=eq.${encodeURIComponent(wallet_id)}&select=amount&order=created_at.desc&limit=1`,
    null,
    true
  );

  if (txns && txns.length > 0) {
    return sendJson(res, 200, { ok: true, amount: txns[0].amount });
  }

  return sendJson(res, 200, { ok: true, amount: null });
};

// ── Router ────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    return sendJson(res, 401, { error: 'Missing Authorization bearer token' });
  }

  const urlStr = req.url || '';

  const isAddWallet = urlStr.includes('/api/add-wallet')
    || urlStr.includes('action=add-wallet')
    || (req.query && req.query.action === 'add-wallet');
  const isEditBalance = urlStr.includes('/api/edit-wallet-balance')
    || (req.query && req.query.action === 'edit-balance');
  const isLatestTxn = urlStr.includes('/api/latest-wallet-transaction')
    || (req.query && req.query.action === 'latest-transaction');

  try {
    await fetchSupabaseJson('/auth/v1/user', token, false);

    if (isLatestTxn) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      return await handleLatestTransaction(req, res);
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (isAddWallet) return await handleAddWallet(req, res);
    if (isEditBalance) return await handleEditBalance(req, res, token);
    return await handleSendEftEmail(req, res);
  } catch (error) {
    if (!res.headersSent) {
      await logEmail({
        emailType: 'eft',
        recipient: req?.body?.to || 'unknown',
        status: 'failed',
        triggerSource: 'manual',
        errorMessage: error?.message
      }).catch(() => {});
      sendJson(res, 500, {
        error: 'Wallet API error',
        details: error?.message || 'Unknown error'
      });
    }
  }
};
