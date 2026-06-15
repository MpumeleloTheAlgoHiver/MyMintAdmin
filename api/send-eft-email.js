const fs = require('fs');
const path = require('path');
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

const handleAddWallet = async (req, res, token) => {
  let body;
  try {
    body = (req.body && typeof req.body === 'object') ? req.body : await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: 'body-parse: ' + e.message });
  }

  const { user_id, amount, account_type, wallet_status = 'active' } = body || {};

  if (!user_id) return sendJson(res, 400, { error: 'Missing user_id' });
  if (!amount || Number(amount) <= 0) return sendJson(res, 400, { error: 'Invalid amount' });

  const numericAmount = Number(amount);

  // Child accounts live in family_members, not wallets — inserting into wallets
  // would violate fk_user since family member IDs aren't in auth.users/profiles.
  if (account_type === 'child') {
    try {
      const members = await fetchSupabaseJson(
        `/rest/v1/family_members?id=eq.${encodeURIComponent(user_id)}&select=id,available_balance,primary_user_id&limit=1`
      );
      if (!Array.isArray(members) || members.length === 0) {
        return sendJson(res, 404, { error: 'Child account not found' });
      }
      const member = members[0];
      // available_balance is stored in cents — convert the Rand amount before adding.
      const amountCents = Math.round(numericAmount * 100);
      const newBalance = Number(member.available_balance || 0) + amountCents;
      const nowIso = new Date().toISOString();
      await requestSupabaseJson(`/rest/v1/family_members?id=eq.${encodeURIComponent(user_id)}`, {
        method: 'PATCH',
        useServiceRoleAuth: true,
        body: { available_balance: newBalance, updated_at: nowIso },
      });
      // Insert into transactions table (user_id = parent, family_member_id = child).
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
      `/rest/v1/wallets?user_id=eq.${encodeURIComponent(user_id)}&status=eq.${encodeURIComponent(wallet_status)}&limit=1`
    );
  } catch (e) {
    return sendJson(res, 500, { error: 'wallet-fetch: ' + e.message });
  }

  let walletId;
  let newWalletBalance;
  try {
    if (existing && existing.length > 0) {
      const wallet = existing[0];
      walletId = wallet.id;
      if (wallet_status === 'test') {
        newWalletBalance = Number(wallet.balance || 0) + numericAmount;
        await requestSupabaseJson(`/rest/v1/wallets?id=eq.${encodeURIComponent(wallet.id)}`, {
          method: 'PATCH',
          useServiceRoleAuth: true,
          body: { balance: newWalletBalance, updated_at: new Date().toISOString() },
        });
      } else {
        newWalletBalance = Number(wallet.balance || 0); // No immediate update for active wallets
      }
    } else {
      if (wallet_status === 'test') {
        newWalletBalance = numericAmount;
      } else {
        newWalletBalance = 0; // Active wallets start at 0 until approved
      }
      const created = await requestSupabaseJson('/rest/v1/wallets', {
        method: 'POST',
        useServiceRoleAuth: true,
        body: { user_id, balance: newWalletBalance, currency: 'ZAR', status: wallet_status },
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

  if (walletId) {
    try {
      const txnStatus = wallet_status === 'test' ? 'approved' : 'pending';
      await requestSupabaseJson('/rest/v1/wallet_transactions', {
        method: 'POST',
        useServiceRoleAuth: true,
        body: { wallet_id: walletId, user_id, amount: numericAmount, transaction_type: 'manual', status: txnStatus },
      });
    } catch (e) {
      console.error('wallet_transactions insert failed:', e.message);
    }
  }

  return sendJson(res, 200, { success: true, amountAdded: numericAmount, newBalance: newWalletBalance, walletId, pending: wallet_status === 'active' });
};

const handleApproveDeposit = async (req, res, user) => {
  if (user.id !== '766494d0-048c-4156-b706-7ad7050508bd') {
    return sendJson(res, 403, { error: 'Unauthorized to approve deposits' });
  }

  let body;
  try {
    body = (req.body && typeof req.body === 'object') ? req.body : await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: 'body-parse: ' + e.message });
  }

  const { transaction_id } = body;
  if (!transaction_id) return sendJson(res, 400, { error: 'Missing transaction_id' });

  try {
    // Fetch transaction
    const txns = await fetchSupabaseJson(`/rest/v1/wallet_transactions?id=eq.${encodeURIComponent(transaction_id)}&limit=1`);
    if (!txns || txns.length === 0) return sendJson(res, 404, { error: 'Transaction not found' });
    const txn = txns[0];
    if (txn.status !== 'pending') return sendJson(res, 400, { error: 'Transaction is not pending' });

    // Fetch wallet
    const wallets = await fetchSupabaseJson(`/rest/v1/wallets?id=eq.${encodeURIComponent(txn.wallet_id)}&limit=1`);
    if (!wallets || wallets.length === 0) return sendJson(res, 404, { error: 'Wallet not found' });
    const wallet = wallets[0];

    // Update wallet balance
    const newBalance = Number(wallet.balance || 0) + Number(txn.amount);
    await requestSupabaseJson(`/rest/v1/wallets?id=eq.${encodeURIComponent(wallet.id)}`, {
      method: 'PATCH',
      useServiceRoleAuth: true,
      body: { balance: newBalance, updated_at: new Date().toISOString() },
    });

    // Mark transaction as approved
    await requestSupabaseJson(`/rest/v1/wallet_transactions?id=eq.${encodeURIComponent(txn.id)}`, {
      method: 'PATCH',
      useServiceRoleAuth: true,
      body: { status: 'approved' },
    });

    return sendJson(res, 200, { success: true, newBalance });
  } catch (e) {
    return sendJson(res, 500, { error: 'approval-failed: ' + e.message });
  }
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
    const user = await fetchSupabaseJson('/auth/v1/user', token, false);

    let action = (req.query && req.query.action);
    if (!action && (req.url || '').includes('action=add-wallet')) action = 'add-wallet';
    if (!action && (req.url || '').includes('action=approve-deposit')) action = 'approve-deposit';

    if (action === 'add-wallet') {
      return handleAddWallet(req, res, token);
    }
    if (action === 'approve-deposit') {
      return handleApproveDeposit(req, res, user);
    }

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

    sendJson(res, 200, { ok: true, message: 'Email sent successfully' });
  } catch (error) {
    await logEmail({
      emailType: 'eft',
      recipient: req?.body?.to || 'unknown',
      status: 'failed',
      triggerSource: 'manual',
      errorMessage: error?.message
    }).catch(() => {});
    sendJson(res, 500, {
      error: 'Could not send EFT email',
      details: error?.message || 'Unknown error'
    });
  }
};
