'use strict';

const { getPayouts } = require('./_dividends-db');
const { requireAuth, supabaseRequest, sendJson } = require('./_team');
const fetch = require('node-fetch'); // or use native fetch if available

// Simple helper to log email, using the same pattern as _team.js
const writeAudit = async (entry) => {
  try {
    await supabaseRequest('/rest/v1/admin_team_audit', {
      method: 'POST',
      extraHeaders: { 'Prefer': 'return=minimal' },
      body: entry
    });
  } catch (err) {}
};

async function sendViaResend({ to, subject, html, metadata = {} }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Email service not configured');
  
  const fromEmail = process.env.ORDERBOOK_EMAIL_FROM || 'noreply@mymint.co.za';

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail, to: [to], subject, html })
  });
  const payload = await resp.json().catch(() => ({}));
  const ok = resp.ok && !payload.error;
  
  if (!ok) throw new Error(payload.message || payload.error || `Resend error ${resp.status}`);
  return payload;
}

function findClientCode(raw_row) {
  const keys = Object.keys(raw_row);
  const codeKey = keys.find(k => /client.*code/i.test(k)) || keys.find(k => /client/i.test(k));
  return codeKey ? String(raw_row[codeKey]).trim() : null;
}

function formatMoney(amount) {
  const num = Number(amount);
  if (isNaN(num)) return 'R 0.00';
  return 'R ' + num.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function getSecuritiesLogos() {
  const secs = await supabaseRequest('/rest/v1/securities_c?select=symbol,logo_url&limit=1000');
  const map = {};
  (secs || []).forEach(s => {
    if (s.symbol && s.logo_url) map[s.symbol.toUpperCase()] = s.logo_url;
  });
  return map;
}

function buildEmailHtml(profile, payouts, logosMap) {
  const name = profile.first_name || 'Valued Client';
  let rowsHtml = '';
  
  let totalCash = 0;

  payouts.forEach(p => {
    const symbol = (p.security_code || '').toUpperCase();
    const logo = logosMap[symbol] || 'https://app.mymint.co.za/icon.png';
    const amount = Number(p.net_cash) || 0;
    totalCash += amount;
    
    rowsHtml += `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e8e4f3;">
          <img src="${logo}" alt="${symbol}" style="width: 24px; height: 24px; border-radius: 50%; vertical-align: middle; margin-right: 8px;">
          <strong style="color: #0f172a; font-size: 14px;">${symbol}</strong>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e8e4f3; text-align: right; color: #059669; font-weight: 600; font-size: 14px;">
          ${formatMoney(amount)}
        </td>
      </tr>
    `;
  });

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Dividend Notification</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #F5F4F9; padding: 40px 20px; margin: 0;">
    <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(80,38,157,0.07);">
      <div style="background: #7c3aed; padding: 32px 24px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Dividend Payout Processed</h1>
      </div>
      <div style="padding: 32px 24px;">
        <p style="color: #475569; font-size: 16px; line-height: 1.5; margin-top: 0;">Hi ${name},</p>
        <p style="color: #475569; font-size: 16px; line-height: 1.5;">We have successfully processed dividend payouts for your portfolio. The following amounts have been allocated to your Mint account.</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 24px 0; background: #f8f7ff; border-radius: 12px; overflow: hidden;">
          <thead>
            <tr>
              <th style="padding: 12px; text-align: left; background: #ede9fe; color: #5b21b6; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Asset</th>
              <th style="padding: 12px; text-align: right; background: #ede9fe; color: #5b21b6; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Net Payout</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td style="padding: 16px 12px; font-weight: 700; color: #0f172a; border-top: 2px solid #e8e4f3;">Total Net Cash</td>
              <td style="padding: 16px 12px; text-align: right; font-weight: 700; color: #059669; border-top: 2px solid #e8e4f3;">${formatMoney(totalCash)}</td>
            </tr>
          </tfoot>
        </table>

        <p style="color: #475569; font-size: 16px; line-height: 1.5; margin-bottom: 0;">You can view these transactions in your Mint app under the Wallet section.</p>
      </div>
      <div style="background: #faf8ff; padding: 24px; text-align: center; border-top: 1px solid #e8e4f3;">
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} Mint. All rights reserved.</p>
      </div>
    </div>
  </body>
  </html>
  `;
}

module.exports = async function dividendsEmailHandler(req, res) {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const url = new URL(req.url, 'http://x');
    const runId = url.searchParams.get('run_id') || req.body?.run_id;
    if (!runId) return sendJson(res, 400, { ok: false, error: 'run_id is required' });

    // 1. Fetch payouts
    const payouts = await getPayouts(Number(runId), 5000);
    if (!payouts || !payouts.length) {
      return sendJson(res, 404, { ok: false, error: 'No payouts found for this run' });
    }

    // 2. Group by Client Code
    const grouped = {};
    payouts.forEach(p => {
      const code = findClientCode(p.raw_row);
      if (code) {
        if (!grouped[code]) grouped[code] = [];
        grouped[code].push(p);
      }
    });

    const clientCodes = Object.keys(grouped);
    if (clientCodes.length === 0) {
      return sendJson(res, 400, { ok: false, error: 'Could not find Client Code in any row' });
    }

    // 3. Fetch profiles
    const profilesData = await supabaseRequest('/rest/v1/profiles?select=id,mint_number,email,first_name&mint_number=in.(' + clientCodes.map(c => `"${c}"`).join(',') + ')');
    const profileMap = {};
    (profilesData || []).forEach(p => {
      if (p.mint_number) profileMap[p.mint_number] = p;
    });

    // 4. Fetch logos
    const logosMap = await getSecuritiesLogos();

    // ── GET: Preview Email ──────────────────────────────────────────────
    if (req.method === 'GET') {
      // Find the first mapped profile to use for preview
      const previewCode = clientCodes.find(c => profileMap[c]);
      if (!previewCode) {
         return sendJson(res, 400, { ok: false, error: 'Could not match any Client Code to a profile. Ensure client codes exist in the Mint database.' });
      }
      
      const profile = profileMap[previewCode];
      const userPayouts = grouped[previewCode];
      const html = buildEmailHtml(profile, userPayouts, logosMap);
      
      return sendJson(res, 200, { ok: true, html, profile, count: userPayouts.length });
    }

    // ── POST: Send Emails ─────────────────────────────────────────────
    if (req.method === 'POST') {
      let { testEmail, sendAll } = req.body || {};
      
      // Since it's sent via multipart or JSON, let's parse JSON properly if not parsed
      if (req.body == null && req.headers['content-type'] === 'application/json') {
          // If body not parsed, wait, usually body is parsed by `requireAuth` or similar? No, only `sendJson` is provided. We might need to manually parse json body.
          // In team.js req.body is already passed through, let's see. In Vercel, req.body is parsed.
      }

      if (testEmail) {
        // Send a single test email
        const previewCode = clientCodes.find(c => profileMap[c]);
        const profile = previewCode ? profileMap[previewCode] : { first_name: 'Test', email: testEmail };
        const userPayouts = previewCode ? grouped[previewCode] : payouts.slice(0, 3);
        
        const html = buildEmailHtml(profile, userPayouts, logosMap);
        await sendViaResend({ to: testEmail, subject: 'Dividend Payout Processed', html });
        return sendJson(res, 200, { ok: true, message: 'Test email sent successfully' });
      }

      if (sendAll) {
        // Send to all matched profiles
        let sent = 0;
        let failed = 0;

        for (const code of clientCodes) {
          const profile = profileMap[code];
          if (!profile || !profile.email) {
            failed++;
            continue;
          }

          const userPayouts = grouped[code];
          const html = buildEmailHtml(profile, userPayouts, logosMap);
          
          try {
            await sendViaResend({ to: profile.email, subject: 'Dividend Payout Processed', html });
            sent++;
          } catch (e) {
            failed++;
          }
        }
        
        await writeAudit({
          action: 'send_dividend_emails',
          target_email: auth.user.email,
          target_member_id: null,
          actor_email: auth.user.email,
          actor_user_id: auth.user.id,
          details: { run_id: runId, sent, failed }
        });

        return sendJson(res, 200, { ok: true, sent, failed });
      }

      return sendJson(res, 400, { ok: false, error: 'Invalid payload' });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  } catch (err) {
    console.error('[dividends-email]', err.message);
    return sendJson(res, 500, { ok: false, error: err.message });
  }
};
