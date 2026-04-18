require('dotenv').config();
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sumsubArchiveHandler = require('./api/sumsub/archive');

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const indexPath = path.join(publicDir, 'index.html');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const resendFrom = process.env.RESEND_FROM || 'Mint Loans <loans@mymint.co.za>';
const orderbookEmailFrom = process.env.ORDERBOOK_EMAIL_FROM;
const orderbookEmailTo = process.env.ORDERBOOK_EMAIL_TO;
const orderbookDailyAmHour = Number(process.env.ORDERBOOK_DAILY_AM_HOUR || 15);
const orderbookDailyAmMinute = Number(process.env.ORDERBOOK_DAILY_AM_MINUTE || 30);
const orderbookEnableIntervalScheduler = String(process.env.ORDERBOOK_ENABLE_INTERVAL_SCHEDULER || '').toLowerCase() === 'true';
let lastDailyOrderbookEmailDateKey = '';

const sendJson = (res, statusCode, body) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const parseBearerToken = (authorizationHeader) => {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') return null;
  if (!authorizationHeader.startsWith('Bearer ')) return null;
  return authorizationHeader.slice('Bearer '.length).trim() || null;
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1024 * 1024) {
      reject(new Error('Payload too large'));
      req.destroy();
    }
  });

  req.on('end', () => {
    try {
      const parsed = body ? JSON.parse(body) : {};
      resolve(parsed);
    } catch (error) {
      reject(new Error('Invalid JSON body'));
    }
  });

  req.on('error', (error) => {
    reject(error);
  });
});

const sendOrderbookCsvEmail = async ({ subject, csvContent, fileName }) => {
  if (!resendApiKey || !orderbookEmailFrom || !orderbookEmailTo) {
    throw new Error('Email service not configured. Set RESEND_API_KEY, ORDERBOOK_EMAIL_FROM, ORDERBOOK_EMAIL_TO');
  }

  const safeFileName = String(fileName || 'order-book.csv');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: orderbookEmailFrom,
      to: [orderbookEmailTo],
      subject: subject || 'Order Book CSV',
      text: 'Attached is the latest order book CSV.',
      attachments: [
        {
          filename: safeFileName,
          content: Buffer.from(String(csvContent || ''), 'utf8').toString('base64')
        }
      ]
    })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || `Resend request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload;
};

/* ─── Loan Approval / Rejection emails (Resend) ─────────────────────── */
const sendApprovalEmail = async ({ toEmail, firstName, amount, interestRate, tenureMonths, bankName, accountNumber }) => {
  if (!resendApiKey) {
    console.warn('[Email] RESEND_API_KEY not set — skipping approval email');
    return;
  }

  const rateDisplay   = interestRate  != null ? `${(Number(interestRate) * 100).toFixed(0)}%`  : 'as agreed';
  const tenureDisplay = tenureMonths  != null ? `${tenureMonths} month${tenureMonths !== 1 ? 's' : ''}` : 'as agreed';
  const amountDisplay = amount        != null ? `R ${Number(amount).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'as per your application';
  const bankDisplay   = (bankName && accountNumber) ? `${bankName} (****${String(accountNumber).slice(-4)})` : 'your linked account';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Loan Approved – Mint</title>
</head>
<body style="margin:0;padding:0;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fa;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#6d28d9 0%,#7c3aed 100%);padding:36px 40px;text-align:center;">
            <p style="margin:0 0 8px;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">✓ Loan Approved</p>
            <p style="margin:0;font-size:15px;color:#ede9fe;">Your application has been reviewed and approved.</p>
          </td>
        </tr>

        <!-- Greeting -->
        <tr>
          <td style="padding:32px 40px 0;">
            <p style="margin:0;font-size:16px;color:#1e293b;">Hi <strong>${firstName || 'there'}</strong>,</p>
            <p style="margin:12px 0 0;font-size:15px;color:#475569;line-height:1.6;">Great news! Your Mint loan application has been <strong style="color:#6d28d9;">approved</strong>. Here's a summary of your loan terms and where your funds will be sent.</p>
          </td>
        </tr>

        <!-- Loan term cards -->
        <tr>
          <td style="padding:24px 40px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="33%" style="padding-right:8px;">
                  <div style="background:#f5f3ff;border-radius:12px;padding:16px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#7c3aed;">Loan Amount</p>
                    <p style="margin:0;font-size:20px;font-weight:800;color:#4c1d95;">${amountDisplay}</p>
                  </div>
                </td>
                <td width="33%" style="padding:0 4px;">
                  <div style="background:#f8fafc;border-radius:12px;padding:16px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Interest Rate</p>
                    <p style="margin:0;font-size:20px;font-weight:800;color:#0f172a;">${rateDisplay}</p>
                  </div>
                </td>
                <td width="33%" style="padding-left:8px;">
                  <div style="background:#f8fafc;border-radius:12px;padding:16px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Tenure</p>
                    <p style="margin:0;font-size:20px;font-weight:800;color:#0f172a;">${tenureDisplay}</p>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Payout destination -->
        <tr>
          <td style="padding:20px 40px 0;">
            <div style="border:1.5px solid #e2e8f0;border-radius:12px;padding:20px;">
              <p style="margin:0 0 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;">💳 Payout Destination</p>
              <p style="margin:0;font-size:15px;color:#1e293b;">Funds will be sent to <strong>${bankDisplay}</strong> within 1–2 business days.</p>
            </div>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:28px 40px;text-align:center;">
            <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">You will receive your funds shortly. If you have any questions, reply to this email or contact support.</p>
            <a href="https://mymint.co.za" style="display:inline-block;background:#6d28d9;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:12px;">Open Mint App</a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-radius:0 0 20px 20px;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">Mint Financial Services &bull; This is an automated message, please do not reply directly.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: resendFrom,
      to: [toEmail],
      subject: `✓ Your Mint loan of ${amountDisplay} has been approved`,
      html
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Resend error ${res.status}`);
  }
  return res.json();
};

const sendRejectionEmail = async ({ toEmail, firstName, reason }) => {
  if (!resendApiKey) {
    console.warn('[Email] RESEND_API_KEY not set — skipping rejection email');
    return;
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Loan Application Update – Mint</title></head>
<body style="margin:0;padding:0;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fa;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:#0f172a;padding:36px 40px;text-align:center;">
          <p style="margin:0 0 8px;font-size:24px;font-weight:800;color:#ffffff;">Loan Application Update</p>
          <p style="margin:0;font-size:14px;color:#94a3b8;">We have reviewed your application.</p>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="margin:0 0 12px;font-size:16px;color:#1e293b;">Hi <strong>${firstName || 'there'}</strong>,</p>
          <p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6;">Thank you for applying with Mint. After reviewing your application, we were unfortunately unable to approve it at this time.</p>
          ${reason ? `<div style="background:#fef2f2;border-left:3px solid #ef4444;border-radius:8px;padding:16px;margin-bottom:16px;"><p style="margin:0;font-size:14px;color:#991b1b;"><strong>Reason:</strong> ${reason}</p></div>` : ''}
          <p style="margin:0;font-size:15px;color:#475569;line-height:1.6;">You are welcome to apply again in the future. If you believe this decision was made in error, please contact our support team.</p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center;border-radius:0 0 20px 20px;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Mint Financial Services &bull; Automated notification.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: resendFrom,
      to: [toEmail],
      subject: 'Update on your Mint loan application',
      html
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Resend error ${res.status}`);
  }
  return res.json();
};

const toOrderbookCsvContent = (rows) => {
  const normalizeCsv = (value) => {
    const base = String(value ?? '');
    return `"${base.replace(/"/g, '""')}"`;
  };

  const header = ['Line', 'Instrument Name', 'Ticker', 'ISIN', 'Side', 'Total Quantity', 'Order Type', 'Settlement Account', 'Broker Ref'];
  const csvLines = [header.map(normalizeCsv).join(',')];

  rows.forEach((row) => {
    csvLines.push([
      row.line,
      row.instrumentName,
      row.ticker,
      row.isin,
      row.side,
      row.totalQuantity,
      row.orderType,
      row.settlementAccount,
      row.brokerRef
    ].map(normalizeCsv).join(','));
  });

  return csvLines.join('\n');
};

const buildDailySnapshotRows = (holdings, securitiesRows) => {
  const securitiesMap = {};
  securitiesRows.forEach((security) => {
    securitiesMap[security.id] = security;
  });

  return (holdings || []).map((row, index) => {
    const security = securitiesMap[row.security_id] || {};
    const quantityValue = Number(row.quantity);
    const isQuantityNumeric = Number.isFinite(quantityValue);

    return {
      line: index + 1,
      instrumentName: security.name || '-',
      ticker: security.symbol ?? '-',
      isin: security.isin ?? security.ISIN ?? security.isin_code ?? security.isincode ?? '-',
      side: isQuantityNumeric ? (quantityValue < 0 ? 'SELL' : 'BUY') : '-',
      totalQuantity: isQuantityNumeric
        ? quantityValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })
        : (row.quantity ?? '-'),
      orderType: 'Market',
      settlementAccount: '',
      brokerRef: ''
    };
  });
};

const sendDailyOrderbookSnapshotEmail = async () => {
  const holdings = await fetchSupabaseJson(
    '/rest/v1/stock_holdings?select=id,user_id,security_id,quantity,avg_fill,market_value,unrealized_pnl,as_of_date,created_at,updated_at,%22Status%22,%22Fill_date%22,%22Exit_date%22,avg_exit&order=updated_at.desc',
    null
  );

  const securityIds = [...new Set((holdings || []).map((row) => row.security_id).filter(Boolean))];
  const securitiesRows = securityIds.length ? await loadSecuritiesByIds(securityIds, null) : [];
  const rows = buildDailySnapshotRows(holdings || [], securitiesRows || []);
  const now = new Date();
  const dateLabel = now.toLocaleString();

  await sendOrderbookCsvEmail({
    subject: `Daily Order Book - ${dateLabel}`,
    csvContent: toOrderbookCsvContent(rows),
    fileName: `daily-orderbook-${now.toISOString().slice(0, 10)}.csv`
  });
};

const maybeRunDailyOrderbookScheduler = async () => {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentMinuteOfDay = (hours * 60) + minutes;
  const targetMinuteOfDay = (orderbookDailyAmHour * 60) + orderbookDailyAmMinute;
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  if (currentMinuteOfDay < targetMinuteOfDay) {
    return;
  }

  if (lastDailyOrderbookEmailDateKey === dateKey) {
    return;
  }

  lastDailyOrderbookEmailDateKey = dateKey;

  try {
    await sendDailyOrderbookSnapshotEmail();
    console.log(`[OrderbookScheduler] Daily CSV sent for ${dateKey} at ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
  } catch (error) {
    console.error('[OrderbookScheduler] Daily CSV send failed:', error?.message || error);
  }
};

const startDailyOrderbookScheduler = () => {
  setInterval(() => {
    maybeRunDailyOrderbookScheduler();
  }, 30000);

  maybeRunDailyOrderbookScheduler();
};

const fetchSupabaseJson = async (path, token, useServiceRoleAuth = true) => {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase server credentials are not configured');
  }

  const url = `${supabaseUrl}${path}`;
  const authToken = useServiceRoleAuth ? supabaseServiceRoleKey : token;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'apikey': supabaseServiceRoleKey,
      'Authorization': `Bearer ${authToken}`,
      'Accept': 'application/json'
    }
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.message || payload?.error || `Supabase request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
};

const mutateSupabaseJson = async (path, payload, token, method = 'PATCH', useServiceRoleAuth = true) => {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase server credentials are not configured');
  }

  const url = `${supabaseUrl}${path}`;
  const authToken = useServiceRoleAuth ? supabaseServiceRoleKey : token;
  const response = await fetch(url, {
    method,
    headers: {
      'apikey': supabaseServiceRoleKey,
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      'Accept': 'application/json'
    },
    body: payload ? JSON.stringify(payload) : undefined
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `Supabase mutation failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
};

const buildInFilter = (values) => values
  .map((value) => encodeURIComponent(String(value)))
  .join(',');

const loadSecuritiesByIds = async (securityIds, token) => {
  const variants = [
    'id,name,symbol,isin',
    'id,name,symbol,%22ISIN%22',
    'id,name,symbol,isin_code',
    'id,name,symbol,isincode',
    'id,name,symbol'
  ];

  let lastError = null;
  for (const selectClause of variants) {
    try {
      const rows = await fetchSupabaseJson(
        `/rest/v1/securities?select=${selectClause}&id=in.(${buildInFilter(securityIds)})`,
        token
      );
      return rows || [];
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return [];
};

const buildOrderbookRows = (holdings, securitiesRows, profileRows) => {
  const securitiesMap = {};
  const profilesMap = {};

  securitiesRows.forEach((security) => {
    securitiesMap[security.id] = security;
  });

  profileRows.forEach((profile) => {
    profilesMap[profile.id] = profile;
  });

  return holdings.map((row, index) => {
    const security = securitiesMap[row.security_id] || {};
    const profile = profilesMap[row.user_id] || {};
    const instrumentName = security.name || '-';
    const ticker = security.symbol ?? '-';
    const isin = security.isin ?? security.ISIN ?? security.isin_code ?? security.isincode ?? '-';
    const timestamp = row.updated_at || row.created_at || row.as_of_date || null;
    const clientName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || String(row.user_id || 'Unknown client');
    const settlementAccount = profile.email || `${clientName} Main`;
    const settlementAccountOptions = [...new Set([
      settlementAccount,
      `${clientName} Main`,
      `${clientName} Trading`
    ].filter(Boolean))];
    const brokerRef = row.id ? `SH-${String(row.id).slice(0, 8)}` : (row.security_id ? `BR-${row.security_id}` : `BR-${index + 1}`);
    const brokerRefOptions = [...new Set([
      brokerRef,
      `${brokerRef}-A`,
      `${brokerRef}-B`
    ].filter(Boolean))];
    const quantityValue = Number(row.quantity);
    const isQuantityNumeric = Number.isFinite(quantityValue);
    const side = isQuantityNumeric
      ? (quantityValue < 0 ? 'SELL' : 'BUY')
      : '-';
    const statusText = String(row.Status || '').trim();
    const orderType = statusText
      || (row.Exit_date ? 'CLOSED' : (row.Fill_date ? 'FILLED' : 'OPEN'));
    const totalQuantity = isQuantityNumeric
      ? quantityValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })
      : (row.quantity ?? '-');

    return {
      line: index + 1,
      instrumentName,
      ticker,
      isin,
      side,
      totalQuantity,
      orderType,
      settlementAccount,
      settlementAccountOptions,
      brokerRef,
      brokerRefOptions,
      timestamp
    };
  });
};

const getSumsubAuthHeaders = (method, pathWithQuery) => {
  const appToken = process.env.SUMSUB_APP_TOKEN;
  const appSecret = process.env.SUMSUB_APP_SECRET;
  if (!appToken || !appSecret) {
    return null;
  }
  const ts = Math.floor(Date.now() / 1000).toString();
  const signaturePayload = ts + method + pathWithQuery;
  const signature = crypto
    .createHmac('sha256', appSecret)
    .update(signaturePayload)
    .digest('hex');

  return {
    'Accept': 'application/json',
    'X-App-Token': appToken,
    'X-App-Access-Sig': signature,
    'X-App-Access-Ts': ts
  };
};


const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/mandate-data') && req.method === 'GET') {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      sendJson(res, 401, { error: 'Missing Authorization bearer token' });
      return;
    }
    (async () => {
      try {
        await fetchSupabaseJson('/auth/v1/user', token, false);
        const profileId = new URL(req.url, 'http://localhost').searchParams.get('profileId');
        if (!profileId) {
          sendJson(res, 400, { error: 'Missing profileId parameter' });
          return;
        }
        const rows = await fetchSupabaseJson(
          `/rest/v1/user_onboarding?select=sumsub_raw&user_id=eq.${encodeURIComponent(profileId)}&limit=1`,
          token
        );
        const row = Array.isArray(rows) ? rows[0] : null;
        const raw = row?.sumsub_raw;
        const mandateData = (raw && typeof raw === 'object' ? raw : {}).mandate_data || null;
        sendJson(res, 200, { mandate_data: mandateData });
      } catch (err) {
        sendJson(res, 500, { error: err.message || 'Failed to fetch mandate data' });
      }
    })();
    return;
  }

  if (req.url.startsWith('/api/orderbook/send-csv') && req.method === 'POST') {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      sendJson(res, 401, { error: 'Missing Authorization bearer token' });
      return;
    }

    (async () => {
      try {
        await fetchSupabaseJson('/auth/v1/user', token, false);
        const body = await readJsonBody(req);
        await sendOrderbookCsvEmail({
          subject: body?.subject,
          csvContent: body?.csvContent,
          fileName: body?.fileName
        });
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 500, {
          error: 'Could not send orderbook CSV email',
          details: error?.message || 'Unknown error'
        });
      }
    })();

    return;
  }

  if (req.url.startsWith('/api/orderbook')) {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      sendJson(res, 401, { error: 'Missing Authorization bearer token' });
      return;
    }

    (async () => {
      try {
        await fetchSupabaseJson('/auth/v1/user', token, false);

        const holdings = await fetchSupabaseJson(
          '/rest/v1/stock_holdings?select=id,user_id,security_id,quantity,avg_fill,market_value,unrealized_pnl,as_of_date,created_at,updated_at,%22Status%22,%22Fill_date%22,%22Exit_date%22,avg_exit&order=updated_at.desc',
          token
        );

        const securityIds = [...new Set((holdings || []).map((row) => row.security_id).filter(Boolean))];
        const userIds = [...new Set((holdings || []).map((row) => row.user_id).filter(Boolean))];

        const securitiesRows = securityIds.length ? await loadSecuritiesByIds(securityIds, token) : [];
        const profileRows = userIds.length
          ? await fetchSupabaseJson(
            `/rest/v1/profiles?select=id,first_name,last_name,email,phone_number,mint_number&id=in.(${buildInFilter(userIds)})`,
            token
          )
          : [];

        const rows = buildOrderbookRows(holdings || [], securitiesRows || [], profileRows || []);
        sendJson(res, 200, { rows });
      } catch (error) {
        sendJson(res, 500, {
          error: 'Could not load orderbook data',
          details: error?.message || 'Unknown error'
        });
      }
    })();

    return;
  }

  if (req.url.startsWith('/api/sumsub/applicant')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const externalUserId = url.searchParams.get('externalUserId');
    if (!externalUserId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'externalUserId is required' }));
      return;
    }

    const method = 'GET';
    const pathWithQuery = `/resources/applicants/-;externalUserId=${encodeURIComponent(externalUserId)}/one`;
    const headers = getSumsubAuthHeaders(method, pathWithQuery);
    if (!headers) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Sumsub credentials are not configured' }));
      return;
    }

    const options = {
      hostname: 'api.sumsub.com',
      path: pathWithQuery,
      method,
      headers: {
        ...headers
      }
    };

    const sumsubReq = https.request(options, (sumsubRes) => {
      let data = '';
      sumsubRes.on('data', (chunk) => {
        data += chunk;
      });
      sumsubRes.on('end', () => {
        res.writeHead(sumsubRes.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(data);
      });
    });

    sumsubReq.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Sumsub request failed', details: err.message }));
    });

    sumsubReq.end();
    return;
  }

  if (req.url.startsWith('/api/sumsub/metadata')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const applicantId = url.searchParams.get('applicantId');
    if (!applicantId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'applicantId is required' }));
      return;
    }

    const method = 'GET';
    const pathWithQuery = `/resources/applicants/${encodeURIComponent(applicantId)}/metadata/resources`;
    const headers = getSumsubAuthHeaders(method, pathWithQuery);
    if (!headers) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Sumsub credentials are not configured' }));
      return;
    }

    const options = {
      hostname: 'api.sumsub.com',
      path: pathWithQuery,
      method,
      headers
    };

    const sumsubReq = https.request(options, (sumsubRes) => {
      let data = '';
      sumsubRes.on('data', (chunk) => {
        data += chunk;
      });
      sumsubRes.on('end', () => {
        res.writeHead(sumsubRes.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(data);
      });
    });

    sumsubReq.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Sumsub request failed', details: err.message }));
    });

    sumsubReq.end();
    return;
  }

  if (req.url.startsWith('/api/sumsub/image')) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const inspectionId = url.searchParams.get('inspectionId');
    const imageId = url.searchParams.get('imageId');
    if (!inspectionId || !imageId) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'inspectionId and imageId are required' }));
      return;
    }

    const method = 'GET';
    const pathWithQuery = `/resources/inspections/${encodeURIComponent(inspectionId)}/resources/${encodeURIComponent(imageId)}`;
    const headers = getSumsubAuthHeaders(method, pathWithQuery);
    if (!headers) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Sumsub credentials are not configured' }));
      return;
    }

    const options = {
      hostname: 'api.sumsub.com',
      path: pathWithQuery,
      method,
      headers
    };

    const sumsubReq = https.request(options, (sumsubRes) => {
      res.writeHead(sumsubRes.statusCode || 500, {
        'Content-Type': sumsubRes.headers['content-type'] || 'application/octet-stream'
      });
      sumsubRes.pipe(res);
    });

    sumsubReq.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Sumsub request failed', details: err.message }));
    });

    sumsubReq.end();
    return;
  }

  if (req.url.startsWith('/api/sumsub/archive')) {
    (async () => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        req.query = Object.fromEntries(url.searchParams.entries());

        if (req.method === 'POST') {
          req.body = await readJsonBody(req);
        }

        await sumsubArchiveHandler(req, res);
      } catch (error) {
        sendJson(res, 500, {
          error: 'Could not handle sumsub archive request',
          details: error?.message || 'Unknown error'
        });
      }
    })();
    return;
  }

  if (req.url.startsWith('/api/disburse') && req.method === 'POST') {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      sendJson(res, 401, { error: 'Missing Authorization bearer token' });
      return;
    }

    (async () => {
      try {
        // 1. Verify Admin User and Get ID for Audit Logging
        const adminUser = await fetchSupabaseJson('/auth/v1/user', token, false);
        const adminId = adminUser?.id;
        
        const body = await readJsonBody(req);
        const { loanId, bank_acc, amount, idempotency_key } = body;

        if (!loanId || !bank_acc || !amount) {
          sendJson(res, 400, { error: 'Missing required payout details (loanId, bank_acc, amount)' });
          return;
        }

        // 2. "Stale Price" Check: Recalculate LTV before release
        const pledges = await fetchSupabaseJson(`/rest/v1/pbc_collateral_pledges?loan_application_id=eq.${loanId}`, token);
        if (!pledges || pledges.length === 0) {
          sendJson(res, 400, { error: 'No collateral pledges found for this loan' });
          return;
        }

        const symbols = [...new Set(pledges.map(p => p.symbol))];
        const pricesData = await fetchSupabaseJson(`/rest/v1/security_prices?symbol=in.(${symbols.map(s => `%22${s}%22`).join(',')})`, token);
        
        const priceMap = {};
        (pricesData || []).forEach(p => { priceMap[p.symbol] = p.last_price; });

        let currentCollateralValue = 0;
        pledges.forEach(p => {
          const latestPrice = priceMap[p.symbol] || 0;
          currentCollateralValue += parseFloat(p.pledged_quantity) * latestPrice;
        });

        const currentLTV = (parseFloat(amount) / currentCollateralValue) * 100;

        if (currentLTV >= 100) {
          sendJson(res, 400, { 
            error: 'LTV Threshold Exceeded', 
            details: `Current LTV is ${currentLTV.toFixed(2)}% due to market fluctuations. Payout blocked for safety.` 
          });
          return;
        }

        // 3. Integration with South African Gateway (Mock)
        console.log(`[EFT] [Admin:${adminId}] Initiating payout for Loan ${loanId} (LTV: ${currentLTV.toFixed(2)}%) to account ${bank_acc} for amount ZAR ${amount}`);
        const gatewayResponse = { success: true, reference: `MINT-LIQ-${loanId}` };

        if (gatewayResponse.success) {
          // 4. Finalize Database State with Audit Logging
          const updatePayload = { 
            status: 'disbursed', 
            disbursed_at: new Date().toISOString(),
            disbursed_by_admin_id: adminId 
          };

          const result = await mutateSupabaseJson(
            `/rest/v1/loan_application?id=eq.${encodeURIComponent(loanId)}`,
            updatePayload,
            token,
            'PATCH'
          );

          sendJson(res, 200, { 
            ok: true, 
            message: "Funds Released via EFT",
            gateway_ref: gatewayResponse.reference,
            current_ltv: currentLTV,
            data: result 
          });
        } else {
          sendJson(res, 500, { error: 'Payment gateway rejected the EFT request' });
        }
      } catch (error) {
        sendJson(res, 500, {
          error: 'Could not execute EFT disbursement',
          details: error?.message || 'Unknown error'
        });
      }
    })();

    return;
  }

  if (req.url.startsWith('/api/confirm-eft-deposit') && req.method === 'POST') {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      sendJson(res, 401, { error: 'Missing Authorization bearer token' });
      return;
    }

    (async () => {
      try {
        await fetchSupabaseJson('/auth/v1/user', token, false);
        const body = await readJsonBody(req);
        const ref = body?.reference;
        
        if (!ref) {
          sendJson(res, 400, { error: 'Missing reference' });
          return;
        }

        const updatePayload = {
          status: 'completed',
          updated_at: new Date().toISOString()
        };

        const result = await mutateSupabaseJson(
          `/rest/v1/transactions?store_reference=eq.${encodeURIComponent(ref)}&status=eq.pending`,
          updatePayload,
          token,
          'PATCH'
        );

        sendJson(res, 200, { ok: true, data: result });
      } catch (error) {
        sendJson(res, 500, {
          error: 'Could not confirm EFT deposit',
          details: error?.message || 'Unknown error'
        });
      }
    })();

    return;
  }

  // Admin Approval API Routes
  if (req.url.startsWith('/api/admin/approvals') || req.url.startsWith('/api/admin/templates')) {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      sendJson(res, 401, { error: 'Missing Authorization bearer token' });
      return;
    }

    (async () => {
      try {
        const method = req.method;
        const url = req.url;

        // 1. GET /api/admin/templates
        if (url.startsWith('/api/admin/templates') && method === 'GET') {
          const data = await fetchSupabaseJson('/rest/v1/approval_templates?select=*&order=name', token);
          sendJson(res, 200, data);
          return;
        }

        // 2. GET /api/admin/approvals (Pending list)
        if (url === '/api/admin/approvals' && method === 'GET') {
          // Step 1: Fetch approvals with loan and profile data
          const approvals = await fetchSupabaseJson(
            '/rest/v1/admin_approvals?select=*,loan:loan_application_id(id,principal_amount,interest_rate,number_of_months),profile:user_id(first_name,last_name,email,mint_number)&status=eq.pending&order=created_at.desc',
            token
          );

          // Step 2: For each approval, fetch user_onboarding bank details and merge
          const approvalsWithBankDetails = await Promise.all(approvals.map(async (approval) => {
            if (approval.user_id) {
              const onboardingDetails = await fetchSupabaseJson(
                `/rest/v1/user_onboarding?select=bank_name,bank_account_number,bank_branch_code&user_id=eq.${approval.user_id}`,
                token
              );
              // Merge onboarding details into the approval object
              return { ...approval, onboarding: onboardingDetails[0] || null };
            }
            return { ...approval, onboarding: null };
          }));

          sendJson(res, 200, approvalsWithBankDetails);
          return;
        }

        // 3. POST /api/admin/approvals/:id/approve
        if (url.includes('/approve') && method === 'POST') {
          const parts = url.split('/');
          const approvalId = parts[4];
          const body = await readJsonBody(req);

          // terms come from the loan the user already agreed to (passed from front-end)
          // admin_notes is the only thing the admin can add
          const updateResult = await mutateSupabaseJson(
            `/rest/v1/admin_approvals?id=eq.${approvalId}`,
            {
              status: 'approved',
              interest_rate: body.interestRate,       // echoed from loan record
              tenure_months: body.tenureMonths,       // echoed from loan record
              admin_notes: body.adminNotes,
              payout_bank_name: body.payoutBankName,
              payout_account_number: body.payoutAccountNumber,
              payout_branch_code: body.payoutBranchCode,
              payout_account_type: body.payoutAccountType,
              approved_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            token,
            'PATCH'
          );

          // Audit Log
          await mutateSupabaseJson('/rest/v1/approval_audit_log', {
            approval_id: approvalId,
            action: 'approve',
            details: {
              interestRate: body.interestRate,
              tenure: body.tenureMonths,
              payoutTo: body.payoutAccountNumber,
              bank: body.payoutBankName
            }
          }, token, 'POST');

          // Send approval email — fire & forget (don't block the response)
          if (body.toEmail) {
            sendApprovalEmail({
              toEmail:      body.toEmail,
              firstName:    body.firstName,
              amount:       body.amount,
              interestRate: body.interestRate,
              tenureMonths: body.tenureMonths,
              bankName:     body.payoutBankName,
              accountNumber: body.payoutAccountNumber
            }).then(() => console.log(`[Email] Approval email sent to ${body.toEmail}`))
              .catch(err => console.error('[Email] Approval email failed:', err.message));
          }

          sendJson(res, 200, { ok: true, data: updateResult });
          return;
        }

        // 4. POST /api/admin/approvals/:id/reject
        if (url.includes('/reject') && method === 'POST') {
          const parts = url.split('/');
          const approvalId = parts[4];
          const body = await readJsonBody(req);

          const updateResult = await mutateSupabaseJson(
            `/rest/v1/admin_approvals?id=eq.${approvalId}`,
            {
              status: 'rejected',
              rejection_reason: body.reason,
              updated_at: new Date().toISOString()
            },
            token,
            'PATCH'
          );

          // Audit Log
          await mutateSupabaseJson('/rest/v1/approval_audit_log', {
            approval_id: approvalId,
            action: 'reject',
            details: { reason: body.reason }
          }, token, 'POST');

          // Send rejection email — fire & forget
          if (body.toEmail) {
            sendRejectionEmail({
              toEmail:   body.toEmail,
              firstName: body.firstName,
              reason:    body.reason
            }).then(() => console.log(`[Email] Rejection email sent to ${body.toEmail}`))
              .catch(err => console.error('[Email] Rejection email failed:', err.message));
          }

          sendJson(res, 200, { ok: true, data: updateResult });
          return;
        }

        // 5. GET /api/admin/payouts
        if (url === '/api/admin/payouts' && method === 'GET') {
          const data = await fetchSupabaseJson('/rest/v1/admin_approvals?select=*,loan:loan_application_id(*),profile:user_id(first_name,last_name,email,mint_number,bank_name,bank_account_number,bank_account_type,bank_branch_code)&status=eq.approved&order=approved_at.desc', token);
          sendJson(res, 200, data);
          return;
        }

        // 6. POST /api/admin/payouts/:id/confirm
        if (url.includes('/api/admin/payouts') && url.includes('/confirm') && method === 'POST') {
          const parts = url.split('/');
          const approvalId = parts[4];
          
          const updateResult = await mutateSupabaseJson(
            `/rest/v1/admin_approvals?id=eq.${approvalId}`,
            {
              status: 'completed',
              paid_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            token,
            'PATCH'
          );

          // Audit Log
          await mutateSupabaseJson('/rest/v1/approval_audit_log', {
            approval_id: approvalId,
            action: 'pay',
            details: { method: 'EFT' }
          }, token, 'POST');

          sendJson(res, 200, { ok: true, data: updateResult });
          return;
        }

        sendJson(res, 404, { error: 'Admin route not found' });
      } catch (error) {
        console.error('[AdminAPI] Error:', error.message);
        sendJson(res, 500, { error: error.message });
      }
    })();
    return;
  }

  const urlWithoutQuery = req.url.split('?')[0];
  const requestPath = urlWithoutQuery === '/' ? '/index.html' : urlWithoutQuery;
  const safePath = path.normalize(requestPath).replace(/^([/\\])+/, '');
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  if (orderbookEnableIntervalScheduler) {
    startDailyOrderbookScheduler();
  }
});
