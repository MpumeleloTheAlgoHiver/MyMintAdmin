const crypto = require('crypto');
const { logEmail } = require('./_email-logger');

const DASHBOARD_URL = 'https://app.mymint.co.za';
const F = "Inter,Segoe UI,Arial,sans-serif";

const getSupabaseCreds = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase credentials not configured');
  return { supabaseUrl, serviceRoleKey };
};

const sbGet = async (path) => {
  const { supabaseUrl, serviceRoleKey } = getSupabaseCreds();
  const res = await fetch(`${supabaseUrl}${path}`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Accept': 'application/json'
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Supabase error ${res.status}`);
  return data;
};

const sbPost = async (path, body, method = 'POST') => {
  const { supabaseUrl, serviceRoleKey } = getSupabaseCreds();
  const res = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || data.error || `Supabase error ${res.status}`);
  }
};

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

// ── Date helpers ──────────────────────────────────────────────────────────────

function getSASTDateStr() {
  const now = new Date();
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return `${sast.getUTCFullYear()}-${String(sast.getUTCMonth() + 1).padStart(2, '0')}-${String(sast.getUTCDate()).padStart(2, '0')}`;
}

function getTodayUTCStart() {
  const now = new Date();
  const sastNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const todayStart = new Date(Date.UTC(sastNow.getUTCFullYear(), sastNow.getUTCMonth(), sastNow.getUTCDate()));
  return new Date(todayStart.getTime() - 2 * 60 * 60 * 1000).toISOString();
}

// ── Duplicate guard ───────────────────────────────────────────────────────────

async function checkAlreadySentToday() {
  const todayStr = getSASTDateStr();
  try {
    const rows = await sbGet(`/rest/v1/mint_mornings_log?select=id&send_date=eq.${todayStr}&limit=1`);
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    if (String(err.message).includes('42P01') || String(err.message).includes('does not exist')) {
      return false;
    }
    console.error('[MintMornings] Error checking send log:', err.message);
    return false;
  }
}

async function markSentToday(articleCount, userCount) {
  const todayStr = getSASTDateStr();
  try {
    await sbPost('/rest/v1/mint_mornings_log', {
      send_date: todayStr,
      articles_sent: articleCount,
      users_sent: userCount,
      sent_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[MintMornings] Error writing send log:', err.message);
  }
}

// ── Fetch today's articles ────────────────────────────────────────────────────

async function fetchTodaysArticles() {
  const startUTC = getTodayUTCStart();
  const rows = await sbGet(
    `/rest/v1/News_articles?select=*&content_types=cs.%7BALLBRF%7D&published_at=gte.${encodeURIComponent(startUTC)}&order=published_at.desc&limit=5`
  );
  return Array.isArray(rows) ? rows : [];
}

// ── Fetch all confirmed users ─────────────────────────────────────────────────

async function getAllConfirmedUsers() {
  const { supabaseUrl, serviceRoleKey } = getSupabaseCreds();
  const all = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || data.message || `Failed to list users (${res.status})`);
    const users = data.users || [];
    all.push(...users);
    if (users.length < perPage) break;
    page++;
    if (page > 25) break;
  }

  return all.filter(u => u.email_confirmed_at && u.email);
}

// ── Email HTML builder ────────────────────────────────────────────────────────

function parseArticleSections(bodyText) {
  if (!bodyText) return { intro: '', sections: [] };
  const parts = bodyText.split(/----------/);
  const intro = (parts[0] || '').trim();
  const sections = [];
  for (let i = 1; i < parts.length; i++) {
    const chunk = (parts[i] || '').trim();
    if (!chunk) continue;
    if (/^[A-Z][A-Z0-9 &\/\-,'.]+$/m.test(chunk.split('\n')[0])) {
      sections.push({ name: chunk.split('\n')[0].trim(), content: '' });
    } else if (sections.length > 0) {
      sections[sections.length - 1].content += (sections[sections.length - 1].content ? '\n' : '') + chunk;
    }
  }
  return { intro, sections };
}

function textToHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
}

function titleCase(str) {
  return str.charAt(0) + str.slice(1).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function buildMintMorningsHtml(articles) {
  const marketSections = ['MARKETS'];
  const calendarSections = ['COMPANY CALENDAR', 'ECONOMIC CALENDAR'];
  const skipSections = [...marketSections, ...calendarSections, 'TOP HEADLINES'];

  const heroArticle = articles[0];
  const heroBody = heroArticle.body_text || heroArticle.body || '';
  const heroSource = heroArticle.source || 'Alliance News South Africa';
  const heroAuthor = heroArticle.author || '';
  const parsed = parseArticleSections(heroBody);

  // Top headlines box
  const topHeadlines = parsed.sections.find(s => s.name === 'TOP HEADLINES');
  let topHeadlinesBox = '';
  if (topHeadlines && topHeadlines.content) {
    const items = topHeadlines.content
      .split('\n')
      .filter(l => l.trim())
      .map(l => `<li style="margin-bottom:6px;font-family:${F};font-size:14px;line-height:20px;color:#4B5166;">${textToHtml(l.trim())}</li>`)
      .join('');
    topHeadlinesBox = `
      <tr>
        <td style="padding:0 20px 18px 20px;border-top:1px solid #F0F1F6;">
          <div style="margin-top:14px;font-family:${F};font-size:18px;line-height:24px;color:#121526;font-weight:800;">Top headlines</div>
          <ul style="margin:8px 0 0 0;padding-left:20px;">${items}</ul>
        </td>
      </tr>`;
  }

  // Market open card
  const artMarkets = parsed.sections.filter(s => marketSections.includes(s.name));
  const artCalendars = parsed.sections.filter(s => calendarSections.includes(s.name));
  const artNewsSections = parsed.sections.filter(s => !skipSections.includes(s.name));

  let artMarketsBox = artMarkets.length
    ? `<div style="margin-top:12px;font-family:${F};font-size:14px;line-height:20px;color:#4B5166;">${artMarkets.map(s => textToHtml(s.content)).join('<br/><br/>')}</div>`
    : '';

  let artCalendarBox = artCalendars.length
    ? artCalendars.map(s => `
      <div style="margin-top:14px;">
        <div style="font-family:${F};font-size:14px;font-weight:700;color:#121526;">${titleCase(s.name)}</div>
        <div style="margin-top:4px;font-family:${F};font-size:13px;line-height:19px;color:#7B8194;">${textToHtml(s.content)}</div>
      </div>`).join('')
    : '';

  let marketOpenCard = '';
  if (artMarketsBox || artCalendarBox) {
    marketOpenCard = `
      <tr>
        <td style="padding:16px 24px 0 24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFFFFF;border-radius:26px;box-shadow:0 14px 38px rgba(28,22,58,0.08);overflow:hidden;">
            <tr>
              <td style="padding:18px 20px;">
                <div style="font-family:${F};font-size:18px;line-height:24px;color:#121526;font-weight:800;">Before the market open</div>
                <div style="margin-top:6px;font-family:${F};font-size:13px;line-height:18px;color:#7B8194;">Key levels and overnight moves</div>
                ${artMarketsBox}
                ${artCalendarBox}
                <div style="margin-top:16px;">
                  <a href="${DASHBOARD_URL}" style="background:#6D28FF;border-radius:14px;color:#FFFFFF;display:inline-block;font-family:${F};font-size:14px;font-weight:700;line-height:16px;padding:12px 16px;text-decoration:none;">Read more on Mint</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  // News section cards from hero article
  let newsCards = artNewsSections.map(section => `
    <tr>
      <td style="padding:16px 24px 0 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFFFFF;border-radius:26px;box-shadow:0 14px 38px rgba(28,22,58,0.08);overflow:hidden;">
          <tr>
            <td style="padding:18px 20px;">
              <div style="font-family:${F};font-size:18px;line-height:24px;color:#121526;font-weight:800;">${titleCase(section.name)}</div>
              <div style="margin-top:10px;font-family:${F};font-size:14px;line-height:20px;color:#4B5166;">${textToHtml(section.content)}</div>
              <div style="margin-top:14px;">
                <a href="${DASHBOARD_URL}" style="background:#6D28FF;border-radius:14px;color:#FFFFFF;display:inline-block;font-family:${F};font-size:14px;font-weight:700;line-height:16px;padding:12px 16px;text-decoration:none;">Read more on Mint</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  // Rest of articles
  const restArticleCards = articles.slice(1).map(article => {
    const body = article.body_text || article.body || '';
    const source = article.source || 'Alliance News South Africa';
    const author = article.author || '';
    const artParsed = parseArticleSections(body);
    const artNews2 = artParsed.sections.filter(s => !skipSections.includes(s.name));
    const artMarkets2 = artParsed.sections.filter(s => marketSections.includes(s.name));
    const artCalendars2 = artParsed.sections.filter(s => calendarSections.includes(s.name));

    let cards = `
      <tr>
        <td style="padding:16px 24px 0 24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFFFFF;border-radius:26px;box-shadow:0 14px 38px rgba(28,22,58,0.10);overflow:hidden;">
            <tr>
              <td style="padding:20px 20px 14px 20px;">
                <div style="font-family:${F};font-size:12px;color:#7B8194;">${textToHtml(source)}, formatted for Mint</div>
                <div style="margin-top:10px;font-family:${F};font-size:22px;line-height:28px;color:#121526;font-weight:800;">${textToHtml(article.title)}</div>
                <div style="margin-top:10px;font-family:${F};font-size:14px;line-height:20px;color:#4B5166;">${textToHtml(artParsed.intro)}</div>
                ${author ? `<div style="margin-top:14px;font-family:${F};font-size:13px;color:#7B8194;">By ${textToHtml(author)}</div>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>`;

    if (artMarkets2.length || artCalendars2.length) {
      const box2 = artMarkets2.length ? `<div style="margin-top:12px;font-family:${F};font-size:14px;line-height:20px;color:#4B5166;">${artMarkets2.map(s => textToHtml(s.content)).join('<br/><br/>')}</div>` : '';
      const cal2 = artCalendars2.map(s => `<div style="margin-top:14px;"><div style="font-family:${F};font-size:14px;font-weight:700;color:#121526;">${titleCase(s.name)}</div><div style="margin-top:4px;font-family:${F};font-size:13px;line-height:19px;color:#7B8194;">${textToHtml(s.content)}</div></div>`).join('');
      cards += `
        <tr>
          <td style="padding:16px 24px 0 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFFFFF;border-radius:26px;box-shadow:0 14px 38px rgba(28,22,58,0.08);overflow:hidden;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-family:${F};font-size:18px;line-height:24px;color:#121526;font-weight:800;">Before the market open</div>
                  <div style="margin-top:6px;font-family:${F};font-size:13px;color:#7B8194;">Key levels and overnight moves</div>
                  ${box2}${cal2}
                  <div style="margin-top:16px;"><a href="${DASHBOARD_URL}" style="background:#6D28FF;border-radius:14px;color:#FFFFFF;display:inline-block;font-family:${F};font-size:14px;font-weight:700;line-height:16px;padding:12px 16px;text-decoration:none;">Read more on Mint</a></div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    }

    artNews2.forEach(section => {
      cards += `
        <tr>
          <td style="padding:16px 24px 0 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFFFFF;border-radius:26px;box-shadow:0 14px 38px rgba(28,22,58,0.08);overflow:hidden;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-family:${F};font-size:18px;line-height:24px;color:#121526;font-weight:800;">${titleCase(section.name)}</div>
                  <div style="margin-top:10px;font-family:${F};font-size:14px;line-height:20px;color:#4B5166;">${textToHtml(section.content)}</div>
                  <div style="margin-top:14px;"><a href="${DASHBOARD_URL}" style="background:#6D28FF;border-radius:14px;color:#FFFFFF;display:inline-block;font-family:${F};font-size:14px;font-weight:700;line-height:16px;padding:12px 16px;text-decoration:none;">Read more on Mint</a></div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    });

    return cards;
  }).join('\n');

  const todayFormatted = new Date().toLocaleDateString('en-ZA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>Mint Mornings</title>
<style>
@media (max-width:620px){
.container{width:100%!important;}
.px{padding-left:16px!important;padding-right:16px!important;}
.card{border-radius:20px!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:#F6F7FB;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
Johannesburg market preview, SA news, global headlines — ${todayFormatted}.
</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F6F7FB;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">

<!-- Header -->
<tr>
<td class="px" style="padding:6px 24px 14px 24px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr>
<td align="left">
<table role="presentation" cellspacing="0" cellpadding="0" border="0">
<tr>
  <td style="vertical-align:middle;">
    <div style="display:inline-block;width:32px;height:32px;background:linear-gradient(135deg,#31005e,#7c3aed);border-radius:8px;text-align:center;line-height:32px;font-weight:800;color:#ffffff;font-size:16px;font-family:${F};">M</div>
  </td>
  <td style="vertical-align:middle;padding-left:10px;">
    <div style="font-family:${F};font-size:14px;font-weight:700;color:#121526;letter-spacing:-0.2px;">Mint Mornings</div>
    <div style="font-family:${F};font-size:11px;color:#7B8194;">${todayFormatted}</div>
  </td>
</tr>
</table>
</td>
<td align="right">
<span style="font-family:${F};font-size:12px;color:#7B8194;">Market Brief</span>
</td>
</tr>
</table>
</td>
</tr>

<!-- Hero article -->
<tr>
<td class="px" style="padding:0 24px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="card" style="background:#FFFFFF;border-radius:26px;box-shadow:0 14px 38px rgba(28,22,58,0.10);overflow:hidden;">
<tr>
<td style="padding:20px 20px 14px 20px;">
<div style="font-family:${F};font-size:12px;color:#7B8194;">${textToHtml(heroSource)}, formatted for Mint</div>
<div style="margin-top:10px;font-family:${F};font-size:26px;line-height:32px;color:#121526;font-weight:800;">${textToHtml(heroArticle.title)}</div>
<div style="margin-top:10px;font-family:${F};font-size:14px;line-height:20px;color:#4B5166;">${textToHtml(parsed.intro)}</div>
${heroAuthor ? `<div style="margin-top:14px;font-family:${F};font-size:13px;color:#7B8194;">By ${textToHtml(heroAuthor)}</div>` : ''}
</td>
</tr>
${topHeadlinesBox}
</table>
</td>
</tr>

${marketOpenCard}
${newsCards}
${restArticleCards}

<!-- Footer -->
<tr>
<td class="px" style="padding:18px 24px 28px 24px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr>
<td style="padding:16px 18px;background:#FFFFFF;border:1px solid #F0F1F6;border-radius:22px;">
<div style="font-family:${F};font-size:11px;line-height:17px;color:#7B8194;">
MINT (Pty) Ltd is an authorised Financial Services Provider (FSP 55118) regulated by the Financial Sector Conduct Authority. All investment activity carries risk including the possible loss of capital. Nothing in this email constitutes personalised financial advice.
<br/><br/>
News content sourced from Alliance News South Africa. Copyright &copy; ${new Date().getFullYear()} Alliance News Ltd. All rights reserved.
</div>
<div style="margin-top:12px;font-family:${F};font-size:11px;color:#7B8194;">
You're receiving this as a Mint user. &nbsp;<a href="${DASHBOARD_URL}" style="color:#6D28FF;text-decoration:none;font-weight:700;">Open Mint</a>
</div>
</td>
</tr>
</table>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>`;
}

// ── Send to all users ─────────────────────────────────────────────────────────

async function sendToAllUsers(articles, testEmail = null) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.MINT_MORNINGS_FROM || 'MINT Mornings <mornings@mymint.co.za>';

  if (!resendApiKey) throw new Error('RESEND_API_KEY not configured');

  const html = buildMintMorningsHtml(articles);
  const subject = `Mint Mornings — ${articles[0].title}`;

  // Test mode: send to single address only
  if (testEmail) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddress, to: [testEmail], subject: `[TEST] ${subject}`, html })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.message || payload.error || `Resend error ${res.status}`);
    return { sent: 1, failed: 0, test: true };
  }

  const confirmedUsers = await getAllConfirmedUsers();
  console.log(`[MintMornings] Sending to ${confirmedUsers.length} confirmed user(s)...`);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < confirmedUsers.length; i++) {
    const user = confirmedUsers[i];
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromAddress, to: [user.email], subject, html })
      });
      const payload = await res.json().catch(() => ({}));
      const errMsg = payload.message || payload.error || null;
      if (!res.ok || payload.error) {
        console.error(`[MintMornings] Failed for ${user.email}:`, errMsg);
        await logEmail({ emailType: 'mint_mornings', recipient: user.email, subject, status: 'failed', triggerSource: testEmail ? 'manual' : 'scheduler', errorMessage: errMsg });
        failed++;
      } else {
        await logEmail({ emailType: 'mint_mornings', recipient: user.email, subject, resendId: payload.id || null, status: 'sent', triggerSource: testEmail ? 'manual' : 'scheduler' });
        sent++;
      }
    } catch (err) {
      console.error(`[MintMornings] Error for ${user.email}:`, err.message);
      await logEmail({ emailType: 'mint_mornings', recipient: user.email, subject: subject || null, status: 'failed', triggerSource: 'scheduler', errorMessage: err.message });
      failed++;
    }
    if (i < confirmedUsers.length - 1) {
      await new Promise(r => setTimeout(r, 600));
    }
  }

  console.log(`[MintMornings] Done: ${sent} sent, ${failed} failed.`);
  return { sent, failed };
}

// ── HTTP Handler ──────────────────────────────────────────────────────────────

// ── Return Alerts (merged from api/return-alerts.js) ─────────────────────────
// Kept in this file to stay under Vercel Hobby's 12-function limit. Reached at
// POST /api/return-alerts/notify via a vercel.json rewrite → ?action=return-alerts.
// Called by the dashboard when securities breach the −4% daily threshold.
const RETURN_ALERT_RECIPIENTS = [
  'tsie.masilo@mymint.co.za',
  'lonwabo@mymint.co.za',
  'mufaro.ncube@mymint.co.za',
  'mpumelelo@mymint.co.za',
  'Juan.vanwyk@mymint.co.za'
];

const verifyReturnAlertToken = async (token) => {
  const { supabaseUrl, serviceRoleKey } = getSupabaseCreds();
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) return null;
  return res.json();
};

const buildReturnAlertHtml = (alerts, dateKey) => {
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
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <p style="margin:0 0 16px 0;font-size:14px;color:#475569;line-height:1.6;">
                The following strategy assets have breached the <strong style="color:#dc2626;">−4% daily change threshold</strong> and require your attention:
              </p>
            </td>
          </tr>
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
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" bgcolor="#0f172a" style="border-radius:10px;">
                    <a href="https://app.mymint.co.za/dashboard.html" target="_blank" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:10px;background:#0f172a;">View Dashboard</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
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

const handleReturnAlertsNotify = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return sendJson(res, 401, { error: 'Missing token' });

  try {
    const user = await verifyReturnAlertToken(token);
    if (!user) return sendJson(res, 401, { error: 'Invalid token' });
  } catch (err) {
    return sendJson(res, 500, { error: 'Auth check failed: ' + err.message });
  }

  const { alerts, dateKey } = req.body || {};
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return sendJson(res, 400, { error: 'alerts array is required and must not be empty' });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.ORDERBOOK_EMAIL_FROM || 'noreply@mymint.co.za';
  if (!resendApiKey) return sendJson(res, 500, { error: 'RESEND_API_KEY not configured' });

  const subject = `⚠️ Mint Alert: ${alerts.length} Asset${alerts.length !== 1 ? 's' : ''} Below −4% (${dateKey || new Date().toISOString().slice(0, 10)})`;
  const html = buildReturnAlertHtml(alerts, dateKey);

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: RETURN_ALERT_RECIPIENTS, subject, html })
    });
    const payload = await resp.json().catch(() => ({}));
    const ok = resp.ok && !payload.error;

    await logEmail({
      emailType: 'return_alert',
      recipient: RETURN_ALERT_RECIPIENTS.join(', '),
      subject,
      resendId: payload.id || null,
      status: ok ? 'sent' : 'failed',
      triggerSource: 'dashboard-alert',
      metadata: { alertCount: alerts.length, dateKey, symbols: alerts.map(a => a.symbol) },
      errorMessage: ok ? null : (payload.message || payload.error || `HTTP ${resp.status}`)
    });

    if (!ok) {
      console.error('[ReturnAlerts] Resend error:', payload.message || payload.error);
      return sendJson(res, 500, { error: payload.message || payload.error || 'Resend error' });
    }
    console.log(`[ReturnAlerts] Alert email sent for ${alerts.length} asset(s) on ${dateKey}`);
    return sendJson(res, 200, { ok: true, id: payload.id, recipients: RETURN_ALERT_RECIPIENTS.length });
  } catch (err) {
    console.error('[ReturnAlerts] Failed to send alert:', err.message);
    return sendJson(res, 500, { error: err.message });
  }
};

// ── Spike Alerts (≥+13% daily change) ───────────────────────────────────────
// POST /api/spike-alerts/notify — called by the dashboard when any strategy
// asset spikes +13% or more in a single day. Uses the same recipient list as
// return alerts so the same team is always notified.

const buildSpikeAlertHtml = (alerts, dateKey) => {
  const now = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'full', timeStyle: 'short' });
  const rows = alerts.map(a => {
    const sym = String(a.symbol || '').replace('.JO', '');
    const chg = Number(a.change);
    const chgStr = '+' + chg.toFixed(2) + '%';
    const stratLabel = Array.isArray(a.strategies) && a.strategies.length
      ? a.strategies.slice(0, 3).join(', ') + (a.strategies.length > 3 ? ` +${a.strategies.length - 3} more` : '')
      : '—';
    return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #dcfce7;">
          <span style="font-size:13px;font-weight:700;color:#0f172a;">${sym}</span>
          ${a.name && a.name !== sym ? `<br><span style="font-size:11px;color:#64748b;">${a.name}</span>` : ''}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #dcfce7;text-align:center;">
          <span style="display:inline-block;background:#dcfce7;color:#16a34a;font-size:12px;font-weight:800;padding:3px 10px;border-radius:6px;">${chgStr}</span>
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #dcfce7;font-size:11px;color:#64748b;">${stratLabel}</td>
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
  <span style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${alerts.length} strategy asset${alerts.length !== 1 ? 's' : ''} spiked above the +13% daily threshold.</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f4f4f7">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px rgba(15,23,42,0.06);">
          <tr>
            <td style="background:linear-gradient(135deg,#14532d 0%,#16a34a 100%);padding:28px 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <div style="display:inline-block;width:36px;height:36px;background:#ffffff;border-radius:10px;text-align:center;line-height:36px;font-weight:700;color:#16a34a;font-size:18px;">M</div>
                  </td>
                  <td style="vertical-align:middle;padding-left:12px;">
                    <div style="color:#ffffff;font-weight:600;font-size:15px;">Mint CRM</div>
                    <div style="color:rgba(255,255,255,0.75);font-size:12px;font-weight:500;">Spike Alert</div>
                  </td>
                </tr>
              </table>
              <h1 style="margin:20px 0 4px 0;color:#ffffff;font-size:22px;line-height:1.2;font-weight:700;">
                🚀 ${alerts.length} Asset${alerts.length !== 1 ? 's' : ''} Spiked Above +13%
              </h1>
              <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">${now}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <p style="margin:0 0 16px 0;font-size:14px;color:#475569;line-height:1.6;">
                The following strategy assets have exceeded the <strong style="color:#16a34a;">+13% daily spike threshold</strong> and may require your attention:
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-radius:10px;overflow:hidden;border:1px solid #bbf7d0;">
                <tr style="background:#f0fdf4;">
                  <th style="padding:9px 14px;text-align:left;font-size:11px;font-weight:700;color:#14532d;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #bbf7d0;">Security</th>
                  <th style="padding:9px 14px;text-align:center;font-size:11px;font-weight:700;color:#14532d;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #bbf7d0;">1D Change</th>
                  <th style="padding:9px 14px;text-align:left;font-size:11px;font-weight:700;color:#14532d;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #bbf7d0;">Strategies</th>
                </tr>
                ${rows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" bgcolor="#0f172a" style="border-radius:10px;">
                    <a href="https://app.mymint.co.za/dashboard.html" target="_blank" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:10px;background:#0f172a;">View Dashboard</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 32px 20px 32px;border-top:1px solid #f0f0f3;color:#94a3b8;font-size:11px;line-height:1.55;">
              Automated alert from Mint CRM — Returns Insight panel. Threshold: daily change ≥ +13%.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const handleSpikeAlertsNotify = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return sendJson(res, 401, { error: 'Missing token' });

  try {
    const user = await verifyReturnAlertToken(token);
    if (!user) return sendJson(res, 401, { error: 'Invalid token' });
  } catch (err) {
    return sendJson(res, 500, { error: 'Auth check failed: ' + err.message });
  }

  const { alerts, dateKey } = req.body || {};
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return sendJson(res, 400, { error: 'alerts array is required and must not be empty' });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.ORDERBOOK_EMAIL_FROM || 'noreply@mymint.co.za';
  if (!resendApiKey) return sendJson(res, 500, { error: 'RESEND_API_KEY not configured' });

  const subject = `🚀 Mint Spike Alert: ${alerts.length} Asset${alerts.length !== 1 ? 's' : ''} Above +13% (${dateKey || new Date().toISOString().slice(0, 10)})`;
  const html = buildSpikeAlertHtml(alerts, dateKey);

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: RETURN_ALERT_RECIPIENTS, subject, html })
    });
    const payload = await resp.json().catch(() => ({}));
    const ok = resp.ok && !payload.error;

    await logEmail({
      emailType: 'spike_alert',
      recipient: RETURN_ALERT_RECIPIENTS.join(', '),
      subject,
      resendId: payload.id || null,
      status: ok ? 'sent' : 'failed',
      triggerSource: 'dashboard-spike-alert',
      metadata: { alertCount: alerts.length, dateKey, symbols: alerts.map(a => a.symbol) },
      errorMessage: ok ? null : (payload.message || payload.error || `HTTP ${resp.status}`)
    });

    if (!ok) {
      console.error('[SpikeAlerts] Resend error:', payload.message || payload.error);
      return sendJson(res, 500, { error: payload.message || payload.error || 'Resend error' });
    }
    console.log(`[SpikeAlerts] Spike alert email sent for ${alerts.length} asset(s) on ${dateKey}`);
    return sendJson(res, 200, { ok: true, id: payload.id, recipients: RETURN_ALERT_RECIPIENTS.length });
  } catch (err) {
    console.error('[SpikeAlerts] Failed to send alert:', err.message);
    return sendJson(res, 500, { error: err.message });
  }
};

module.exports = async (req, res) => {
  // Merged endpoint: POST /api/return-alerts/notify → ?action=return-alerts (rewrite).
  if (new URL(req.url, 'http://x').searchParams.get('action') === 'return-alerts') {
    return handleReturnAlertsNotify(req, res);
  }
  // POST /api/spike-alerts/notify → ?action=spike-alerts (rewrite).
  if (new URL(req.url, 'http://x').searchParams.get('action') === 'spike-alerts') {
    return handleSpikeAlertsNotify(req, res);
  }
  if (req.method === 'GET' && new URL(req.url, 'http://x').searchParams.get('action') === 'status') {
    try {
      const todayStr = getSASTDateStr();
      let lastSend = null;
      try {
        const rows = await sbGet('/rest/v1/mint_mornings_log?select=*&order=send_date.desc&limit=1');
        lastSend = Array.isArray(rows) && rows.length ? rows[0] : null;
      } catch {}
      const alreadySentToday = lastSend && lastSend.send_date === todayStr;
      return sendJson(res, 200, { ok: true, today: todayStr, alreadySentToday, lastSend });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method === 'GET' && new URL(req.url, 'http://x').searchParams.get('action') === 'preview') {
    try {
      const articles = await fetchTodaysArticles();
      if (articles.length === 0) {
        return sendJson(res, 200, { html: null, articleCount: 0, message: 'No ALLBRF articles available for today.' });
      }
      const html = buildMintMorningsHtml(articles);
      return sendJson(res, 200, { html, articleCount: articles.length, title: articles[0].title });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const url = new URL(req.url, 'http://x');
  const force = url.searchParams.get('force') === 'true';
  const testEmail = url.searchParams.get('test') || null;

  try {
    if (!testEmail && !force) {
      const alreadySent = await checkAlreadySentToday();
      if (alreadySent) {
        return sendJson(res, 200, { ok: false, message: 'Already sent today. Use ?force=true to override.' });
      }
    }

    const articles = await fetchTodaysArticles();
    if (articles.length === 0) {
      return sendJson(res, 200, { ok: false, message: 'No ALLBRF articles found for today.' });
    }

    console.log(`[MintMornings] Found ${articles.length} article(s). ${testEmail ? `Test mode → ${testEmail}` : 'Full send.'}`);
    const result = await sendToAllUsers(articles, testEmail);

    if (!testEmail) {
      await markSentToday(articles.length, result.sent);
    }

    return sendJson(res, 200, {
      ok: true,
      articles: articles.length,
      sent: result.sent,
      failed: result.failed,
      test: !!testEmail
    });
  } catch (err) {
    console.error('[MintMornings] Error:', err.message);
    return sendJson(res, 500, { error: err.message });
  }
};

// Exposed for server.js's local /api/return-alerts/notify route.
module.exports.handleReturnAlertsNotify = handleReturnAlertsNotify;
module.exports.handleSpikeAlertsNotify = handleSpikeAlertsNotify;

// ── Standalone trigger (used by server.js scheduler) ─────────────────────────
module.exports.runMintMornings = async () => {
  try {
    const alreadySent = await checkAlreadySentToday();
    if (alreadySent) {
      console.log('[MintMornings] Already sent today — skipping');
      return;
    }
    const articles = await fetchTodaysArticles();
    if (articles.length === 0) {
      console.log('[MintMornings] No articles today — skipping');
      return;
    }
    console.log(`[MintMornings] Scheduler: found ${articles.length} article(s), sending...`);
    const result = await sendToAllUsers(articles);
    await markSentToday(articles.length, result.sent);
    console.log(`[MintMornings] Scheduler complete: ${result.sent} sent, ${result.failed} failed.`);
  } catch (err) {
    console.error('[MintMornings] Scheduler error:', err.message);
  }
};
