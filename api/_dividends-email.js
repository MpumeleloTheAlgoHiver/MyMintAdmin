'use strict';

const { getPayouts } = require('./_dividends-db');
const { requireAuth, supabaseRequest, sendJson } = require('./_team');

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
    
    rowsHtml += \`
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;">
          <div style="display:flex;align-items:center;">
            <img src="\${logo}" alt="\${symbol}" style="width:20px;height:20px;border-radius:50%;margin-right:8px;vertical-align:middle;">
            <strong style="font-size:13px;color:#1e293b;">\${symbol}</strong>
          </div>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-size:14px;font-weight:700;color:#059669;">
          \${formatMoney(amount)}
        </td>
      </tr>
    \`;
  });

  return \`<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f6fa;margin:0;padding:32px 16px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:520px;margin:0 auto;">
  <tr><td style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.07);border:1px solid #ede9fe;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
      <span style="font-size:16px;font-weight:700;color:#0f172a;">Mint</span>
    </div>
    <h2 style="font-size:18px;font-weight:700;color:#1e293b;margin:0 0 8px 0;">Dividend Payout Processed</h2>
    <p style="font-size:14px;color:#64748b;margin:0 0 20px 0;">Hi \${name},<br><br>We have successfully processed dividend payouts for your portfolio. The following amounts have been allocated to your Mint account.</p>
    
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:24px;">
      \${rowsHtml}
      <tr>
        <td style="padding:12px 0 0 0;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;">Total Net Cash</td>
        <td style="padding:12px 0 0 0;font-size:16px;font-weight:800;color:#059669;text-align:right;">\${formatMoney(totalCash)}</td>
      </tr>
    </table>
    
    <p style="font-size:13px;color:#64748b;margin:0 0 20px 0;">You can view these transactions in your Mint app under the Wallet section.</p>
    <a href="https://app.mymint.co.za" style="display:inline-block;background:#7c3aed;color:#fff;font-size:13px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">Open Mint App</a>
    <p style="font-size:11px;color:#94a3b8;margin:24px 0 0 0;">&copy; \${new Date().getFullYear()} MINT (Pty) Ltd. This is an automated notification.</p>
  </td></tr>
</table>
</body></html>\`;
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
