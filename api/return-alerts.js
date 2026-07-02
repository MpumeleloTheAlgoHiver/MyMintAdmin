/**
 * api/return-alerts.js
 * POST /api/return-alerts/notify
 *
 * Called by the dashboard when securities breach the -4% alert threshold.
 * Sends a single digest email to the configured alert recipients.
 * Requires a valid admin bearer token.
 *
 * Body: { alerts: [{ symbol, name, change, strategies }], dateKey: "YYYY-MM-DD" }
 */

const { logEmail } = require('./_email-logger');

const ALERT_RECIPIENTS = [
  'tsie.masilo@mymint.co.za',
  'lonwabo@mymint.co.za',
  'mufaro.ncube@mymint.co.za',
  'mpumelelo@mymint.co.za'
];

const getSupabaseCreds = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase credentials not configured');
  return { supabaseUrl, serviceRoleKey };
};

const verifyToken = async (token) => {
  const { supabaseUrl, serviceRoleKey } = getSupabaseCreds();
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return res.json();
};

const buildAlertHtml = (alerts, dateKey) => {
  const now = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'full', timeStyle: 'short' });

  const rows = alerts.map(a => {
    const sym = String(a.symbol || '').replace('.JO', '');
    const chg = Number(a.change);
    const chgStr = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    const stratLabel = Array.isArray(a.strategies) && a.strategies.length
      ? a.strategies.slice(0, 3).join(', ') + (a.strategies.length > 3 ? ` +${a.strategies.length - 3} more` : '')
      : '—';
    return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #fef2f2;">
          <span style="font-size:13px;font-weight:700;color:#0f172a;">${sym}</span>
          ${a.name && a.name !== sym ? `<br><span style="font-size:11px;color:#64748b;">${a.name}</span>` : ''}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #fef2f2;text-align:center;">
          <span style="display:inline-block;background:#fee2e2;color:#dc2626;font-size:12px;font-weight:800;padding:3px 10px;border-radius:6px;">${chgStr}</span>
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #fef2f2;font-size:11px;color:#64748b;">${stratLabel}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${alerts.length} strategy asset${alerts.length !== 1 ? 's' : ''} breached the -4% daily threshold.</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f4f4f7">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(15,23,42,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#991b1b 0%,#dc2626 100%);padding:28px 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <div style="display:inline-block;width:36px;height:36px;background:#ffffff;border-radius:10px;text-align:center;line-height:36px;font-weight:700;color:#dc2626;font-size:18px;">M</div>
                  </td>
                  <td style="vertical-align:middle;padding-left:12px;">
                    <div style="color:#ffffff;font-weight:600;font-size:15px;">Mint CRM</div>
                    <div style="color:rgba(255,255,255,0.75);font-size:12px;font-weight:500;">Returns Alert</div>
                  </td>
                </tr>
              </table>
              <h1 style="margin:20px 0 4px 0;color:#ffffff;font-size:22px;line-height:1.2;font-weight:700;">
                ⚠️ ${alerts.length} Asset${alerts.length !== 1 ? 's' : ''} Below −4% Threshold
              </h1>
              <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">${now}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <p style="margin:0 0 16px 0;font-size:14px;color:#475569;line-height:1.6;">
                The following strategy assets have breached the <strong style="color:#dc2626;">−4% daily change threshold</strong> and require your attention:
              </p>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-radius:10px;overflow:hidden;border:1px solid #fecaca;">
                <tr style="background:#fff7f7;">
                  <th style="padding:9px 14px;text-align:left;font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #fecaca;">Security</th>
                  <th style="padding:9px 14px;text-align:center;font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #fecaca;">1D Change</th>
                  <th style="padding:9px 14px;text-align:left;font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #fecaca;">Strategies</th>
                </tr>
                ${rows}
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" bgcolor="#0f172a" style="border-radius:10px;">
                    <a href="https://mint-crm.replit.app/dashboard.html" target="_blank" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:10px;background:#0f172a;">View Dashboard</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:14px 32px 20px 32px;border-top:1px solid #f0f0f3;color:#94a3b8;font-size:11px;line-height:1.55;">
              Automated alert from Mint CRM — Returns Insight panel. Threshold: daily change ≤ −4%.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

module.exports = async (req, res) => {
  const sendJson = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  if (req.method !== 'POST') return sendJson(405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return sendJson(401, { error: 'Missing token' });

  try {
    const user = await verifyToken(token);
    if (!user) return sendJson(401, { error: 'Invalid token' });
  } catch (err) {
    return sendJson(500, { error: 'Auth check failed: ' + err.message });
  }

  const { alerts, dateKey } = req.body || {};
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return sendJson(400, { error: 'alerts array is required and must not be empty' });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.ORDERBOOK_EMAIL_FROM || 'noreply@mymint.co.za';
  if (!resendApiKey) return sendJson(500, { error: 'RESEND_API_KEY not configured' });

  const subject = `⚠️ Mint Alert: ${alerts.length} Asset${alerts.length !== 1 ? 's' : ''} Below −4% (${dateKey || new Date().toISOString().slice(0, 10)})`;
  const html = buildAlertHtml(alerts, dateKey);

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: ALERT_RECIPIENTS, subject, html })
    });
    const payload = await resp.json().catch(() => ({}));
    const ok = resp.ok && !payload.error;

    await logEmail({
      emailType: 'return_alert',
      recipient: ALERT_RECIPIENTS.join(', '),
      subject,
      resendId: payload.id || null,
      status: ok ? 'sent' : 'failed',
      triggerSource: 'dashboard-alert',
      metadata: { alertCount: alerts.length, dateKey, symbols: alerts.map(a => a.symbol) },
      errorMessage: ok ? null : (payload.message || payload.error || `HTTP ${resp.status}`)
    });

    if (!ok) {
      console.error('[ReturnAlerts] Resend error:', payload.message || payload.error);
      return sendJson(500, { error: payload.message || payload.error || 'Resend error' });
    }

    console.log(`[ReturnAlerts] Alert email sent for ${alerts.length} asset(s) on ${dateKey}`);
    return sendJson(200, { ok: true, id: payload.id, recipients: ALERT_RECIPIENTS.length });
  } catch (err) {
    console.error('[ReturnAlerts] Failed to send alert:', err.message);
    return sendJson(500, { error: err.message });
  }
};
