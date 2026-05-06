const fs = require('fs');
const path = require('path');
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
    // Validate the user's token with Supabase
    await fetchSupabaseJson('/auth/v1/user', token, false);

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

    const attachments = [];
    try {
      const publicDir = path.join(process.cwd(), 'public');
      const bannerPath = path.join(publicDir, 'images', 'Mailer Funds put.avif');
      if (fs.existsSync(bannerPath)) {
        attachments.push({
          filename: 'banner.avif',
          content: fs.readFileSync(bannerPath).toString('base64'),
          cid: 'banner'
        });
      }
      const logoPath = path.join(publicDir, 'icon.png');
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: 'logo.png',
          content: fs.readFileSync(logoPath).toString('base64'),
          cid: 'logo'
        });
      }
    } catch (e) {
      console.error('[EFT Email] Error reading attachments:', e);
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
        html: html,
        attachments: attachments
      })
    });

    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }

    if (!response.ok) {
      const message = payload?.message || payload?.error || `Resend request failed with ${response.status}`;
      throw new Error(message);
    }

    if (walletId) {
      await requestSupabaseJson(`/rest/v1/wallets?id=eq.${encodeURIComponent(walletId)}`, {
        method: 'PATCH',
        useServiceRoleAuth: true,
        body: { mailer: 'sent' }
      });
    }

    sendJson(res, 200, { ok: true, message: 'Email sent successfully' });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Could not send EFT email',
      details: error?.message || 'Unknown error'
    });
  }
};
