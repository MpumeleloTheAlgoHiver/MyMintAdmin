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
  } catch (err) { }
};

async function sendViaResend({ to, subject, html, metadata = {} }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('Email service not configured');

  const fromEmail = 'investors@mymint.co.za';

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

async function getSecuritiesData() {
  const secs = await supabaseRequest('/rest/v1/securities_c?select=symbol,name,logo_url&limit=1000');
  const map = {};
  (secs || []).forEach(s => {
    if (s.symbol) {
      map[s.symbol.toUpperCase()] = s;
      map[s.symbol.toUpperCase().replace(/\.JO$/, '')] = s;
    }
  });
  return map;
}

function buildEmailHtml(profile, payouts, securitiesMap) {
  const name = profile.first_name || 'Valued Client';
  let rowsHtml = '';

  let totalCash = 0;

  payouts.forEach(p => {
    let symbol = (p.security_code || '').toUpperCase();
    const sec = securitiesMap[symbol] || securitiesMap[symbol.replace(/\.JO$/, '')] || {};
    const logo = sec.logo_url || 'https://app.mymint.co.za/icon.png';
    const secName = sec.name ? `${sec.name} (${symbol.replace(/\.JO$/, '')})` : symbol.replace(/\.JO$/, '');
    const amount = Number(p.net_cash) || 0;
    totalCash += amount;
    
    rowsHtml += `
          <tr>
            <td class="label">
              <div style="display:flex;align-items:center;">
                <img src="${logo}" alt="${symbol}" style="width:20px;height:20px;border-radius:50%;margin-right:8px;vertical-align:middle;">
                ${secName}
              </div>
            </td>
            <td class="num r pos">${formatMoney(amount)}</td>
          </tr>
    `;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MINT Baskets | Dividend Payout</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
    background-color: #ECEAF2;
    color: #1A1622;
    -webkit-font-smoothing: antialiased;
    line-height: 1.6;
  }
  .wrapper { max-width: 620px; margin: 0 auto; background: #ffffff; }

  /* HEADER */
  .header { background: #31005E; padding: 44px 44px 38px; }
  .header-logo {
    font-size: 11px; letter-spacing: 4px; color: #DDC357;
    font-weight: 600; text-transform: uppercase; margin-bottom: 26px;
  }
  .header h1 {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 33px; color: #ffffff; font-weight: 400;
    line-height: 1.15; letter-spacing: -0.3px; margin-bottom: 14px;
  }
  .header-sub { font-size: 14px; color: rgba(255,255,255,0.62); font-weight: 300; }
  .header-meta {
    margin-top: 24px; padding-top: 18px;
    border-top: 1px solid rgba(255,255,255,0.14);
    font-size: 11px; letter-spacing: 2px; color: #DDC357;
    text-transform: uppercase; font-weight: 500;
  }

  /* BODY */
  .body { padding: 40px 44px 8px; }
  .lead {
    font-size: 16px; line-height: 1.7; color: #2C2738;
    font-weight: 300; margin-bottom: 36px;
  }
  .lead strong { font-weight: 600; color: #1A1622; }

  /* SECTION */
  .section { margin-bottom: 38px; }
  .eyebrow {
    font-size: 10px; letter-spacing: 3px; text-transform: uppercase;
    color: #5C3BCF; font-weight: 600; margin-bottom: 10px;
  }
  .section h2 {
    font-family: 'DM Serif Display', Georgia, serif;
    font-size: 23px; font-weight: 400; color: #31005E;
    letter-spacing: -0.2px; margin-bottom: 16px;
  }
  .section p { font-size: 15px; line-height: 1.72; color: #3A3448; margin-bottom: 14px; font-weight: 300; }
  .section p strong { font-weight: 600; color: #1A1622; }

  /* SNAPSHOT TABLE */
  .snap { width: 100%; border-collapse: collapse; margin: 22px 0 4px; }
  .snap th {
    text-align: left; font-size: 10px; letter-spacing: 1.5px;
    text-transform: uppercase; color: #8A8398; font-weight: 600;
    padding: 0 0 10px; border-bottom: 1px solid #E4E0EC;
  }
  .snap th.r, .snap td.r { text-align: right; padding-right: 22px; }
  .snap td {
    padding: 13px 0; border-bottom: 1px solid #F0EDF5;
    font-size: 14px; color: #2C2738; font-weight: 400;
  }
  .snap td.label { font-weight: 500; color: #1A1622; width: 32%; }
  .snap td.num { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 500; white-space: nowrap; }
  .snap td.neg { color: #B0506A; }
  .snap td.pos { color: #2F7D63; }
  .snap td.ctx { font-size: 12px; color: #8A8398; font-weight: 300; }

  /* CLOSE */
  .close { padding: 36px 44px 8px; }
  .close p { font-size: 15px; line-height: 1.7; color: #3A3448; margin-bottom: 14px; font-weight: 300; }
  .close a { color: #5C3BCF; text-decoration: none; font-weight: 500; }
  .sign { margin-top: 22px; font-size: 15px; }
  .sign .name { font-weight: 600; color: #1A1622; }
  .sign .meta { font-size: 13px; color: #8A8398; font-weight: 300; }

  /* FOOTER */
  .footer { padding: 30px 44px 36px; border-top: 1px solid #EEEBF3; }
  .footer-brand { font-size: 13px; letter-spacing: 3px; color: #31005E; font-weight: 700; margin-bottom: 8px; }
  .footer-line { font-size: 11px; color: #9A93A8; font-weight: 300; line-height: 1.7; }
  .disclaimer { font-size: 10.5px; color: #B4AEC0; margin-top: 16px; line-height: 1.6; font-weight: 300; }
</style>
</head>
<body>
<div class="wrapper">

  <!-- HEADER -->
  <div class="header">
    <div class="header-logo">MINT Platforms</div>
    <h1>Your investments are paying you</h1>
    <p class="header-sub">We have successfully processed dividend payouts for your portfolio.</p>
    <div class="header-meta">MINT BASKETS &middot; INVESTOR STATEMENT &middot; ${new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()}</div>
  </div>

  <!-- BODY -->
  <div class="body">

    <p class="lead">Hi ${name},<br><br>When you invested with MINT, you became a shareholder in real companies. And shareholders get paid.<br><br>Since you started investing, the companies in your basket have shared their profits with you:</p>

    <!-- TABLE -->
    <div class="section">
      <h2>COMPANY DIVIDENDS EARNED</h2>
      <table class="snap">
        <thead>
          <tr>
            <th>COMPANY</th>
            <th class="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr>
            <td class="label" style="padding-top:20px; font-weight:700;">Total earned since investing</td>
            <td class="num r pos" style="padding-top:20px; font-size: 16px; font-weight:800; color:#31005E;">${formatMoney(totalCash)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- CLOSE -->
  <div class="close">
    <p>Every cent has been credited to your MINT account. No forms, no waiting, no admin. That’s what ownership looks like: your money working while you live your life.<br><br>And this is just the beginning. The more you invest, the bigger your slice of the profits next time these companies pay out.</p>
    <a href="https://app.mymint.co.za">Grow my portfolio &rarr;</a>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-brand">MINT PLATFORMS</div>
    <div class="footer-line">FSP 55118 &nbsp;|&nbsp; NCRCP22892 &nbsp;|&nbsp; Reg. 2024/644796/07</div>
    <div class="footer-line">3 Gwen Lane, Sandown, Sandton, Johannesburg</div>
    <div class="footer-line">support@mymint.co.za &nbsp;|&nbsp; www.mymint.co.za</div>
    <div class="disclaimer">
      This communication is an automated notification and does not constitute investment advice.
    </div>
  </div>

</div>
</body>
</html>`;
}

module.exports = async function dividendsEmailHandler(req, res) {
  try {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const url = new URL(req.url, 'http://x');
    const runId = url.searchParams.get('run_id') || req.body?.run_id;
    const clientCode = url.searchParams.get('client_code') || req.body?.client_code;

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
    const profilesData = await supabaseRequest('/rest/v1/profiles?select=id,computershare_number,email,first_name&computershare_number=in.(' + clientCodes.map(c => `"${c}"`).join(',') + ')');
    const profileMap = {};
    (profilesData || []).forEach(p => {
      if (p.computershare_number) profileMap[p.computershare_number] = p;
    });

    // 4. Fetch logos
    const securitiesMap = await getSecuritiesData();

    // 5. Fetch sent_client_codes
    let sentCodes = [];
    try {
      const runData = await supabaseRequest(`/rest/v1/dividend_runs?select=sent_client_codes&id=eq.${Number(runId)}`);
      if (runData && runData[0] && runData[0].sent_client_codes) {
        sentCodes = runData[0].sent_client_codes;
      }
    } catch (e) {
      // column might not exist yet, ignore
    }

    async function appendSentClientCodes(codesArray) {
      if (!codesArray || !codesArray.length) return;
      const newSent = Array.from(new Set([...sentCodes, ...codesArray]));
      try {
        await supabaseRequest(`/rest/v1/dividend_runs?id=eq.${Number(runId)}`, {
          method: 'PATCH',
          body: { sent_client_codes: newSent }
        });
      } catch (e) {
        console.error('Failed to update sent_client_codes', e.message);
      }
    }

    // ── GET: Preview Email ──────────────────────────────────────────────
    if (req.method === 'GET') {
      const allClients = clientCodes.map(c => {
        const p = profileMap[c];
        return {
          client_code: c,
          first_name: p ? p.first_name : 'Unknown',
          email: p ? p.email : null,
          has_profile: !!p,
          has_sent: sentCodes.includes(c)
        };
      });

      // Specific client HTML preview
      if (clientCode) {
        if (!profileMap[clientCode]) {
          return sendJson(res, 400, { ok: false, error: 'Profile not found for this code' });
        }
        const profile = profileMap[clientCode];
        const userPayouts = grouped[clientCode];
        const html = buildEmailHtml(profile, userPayouts, securitiesMap);
        return sendJson(res, 200, { ok: true, html, profile, count: userPayouts.length, allClients });
      }

      // Default: Find the first mapped profile to use for preview, but return allClients
      const previewCode = clientCodes.find(c => profileMap[c]);
      if (!previewCode) {
        return sendJson(res, 400, { ok: false, error: 'Could not match any Client Code to a profile. Ensure client codes exist in the Mint database.', allClients });
      }

      const profile = profileMap[previewCode];
      const userPayouts = grouped[previewCode];
      const html = buildEmailHtml(profile, userPayouts, securitiesMap);

      return sendJson(res, 200, { ok: true, html, profile, count: userPayouts.length, allClients, previewCode });
    }

    // ── POST: Send Emails ─────────────────────────────────────────────
    if (req.method === 'POST') {
      let { testEmail, sendAll } = req.body || {};

      if (testEmail) {
        // Send a single test email
        const targetCode = clientCode || clientCodes.find(c => profileMap[c]);
        const profile = targetCode ? profileMap[targetCode] : { first_name: 'Test', email: testEmail };
        const userPayouts = targetCode ? grouped[targetCode] : payouts.slice(0, 3);

        const html = buildEmailHtml(profile, userPayouts, securitiesMap);
        await sendViaResend({ to: testEmail, subject: 'Your investments are paying you', html });
        return sendJson(res, 200, { ok: true, message: 'Test email sent successfully' });
      }

      if (clientCode && !sendAll) {
        // Send to specific user
        const profile = profileMap[clientCode];
        if (!profile || !profile.email) return sendJson(res, 400, { ok: false, error: 'No email found for this client code' });
        if (sentCodes.includes(clientCode)) return sendJson(res, 400, { ok: false, error: 'Email already sent to this user for this run' });

        const userPayouts = grouped[clientCode];
        const html = buildEmailHtml(profile, userPayouts, securitiesMap);
        try {
          await sendViaResend({ to: profile.email, subject: 'Your investments are paying you', html });
          await appendSentClientCodes([clientCode]);
          await writeAudit({
            action: 'send_dividend_emails_single',
            target_email: profile.email,
            target_member_id: clientCode,
            actor_email: auth.user.email,
            actor_user_id: auth.user.id,
            details: { run_id: runId, client_code: clientCode }
          });
          return sendJson(res, 200, { ok: true, message: 'Email sent successfully' });
        } catch (e) {
          return sendJson(res, 500, { ok: false, error: e.message });
        }
      }

      if (sendAll) {
        // Send to all matched profiles that haven't received it yet
        let sent = 0;
        let failed = 0;
        let newlySentCodes = [];

        for (const code of clientCodes) {
          if (sentCodes.includes(code)) continue; // skip already sent

          const profile = profileMap[code];
          if (!profile || !profile.email) {
            failed++;
            continue;
          }

          const userPayouts = grouped[code];
          const html = buildEmailHtml(profile, userPayouts, securitiesMap);

          try {
            await sendViaResend({ to: profile.email, subject: 'Your investments are paying you', html });
            sent++;
            newlySentCodes.push(code);
          } catch (e) {
            failed++;
          }
        }

        if (newlySentCodes.length > 0) {
          await appendSentClientCodes(newlySentCodes);
        }

        await writeAudit({
          action: 'send_dividend_emails_bulk',
          target_email: auth.user.email,
          target_member_id: null,
          actor_email: auth.user.email,
          actor_user_id: auth.user.id,
          details: { run_id: runId, sent, failed, newlySentCodes }
        });

        return sendJson(res, 200, { ok: true, sent, failed, newlySentCodes });
      }

      return sendJson(res, 400, { ok: false, error: 'Invalid payload' });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  } catch (err) {
    console.error('[dividends-email]', err.message);
    return sendJson(res, 500, { ok: false, error: err.message });
  }
};
