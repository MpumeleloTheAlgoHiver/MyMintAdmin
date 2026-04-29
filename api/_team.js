const crypto = require('crypto');

const ALLOWED_DOMAIN = '@mymint.co.za';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const sendJson = (res, statusCode, body) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

const getSupabaseCreds = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase credentials not configured');
  return { supabaseUrl, serviceRoleKey };
};

const isAllowedDomain = (email) =>
  typeof email === 'string' && email.toLowerCase().endsWith(ALLOWED_DOMAIN);

const verifyToken = async (token) => {
  const { supabaseUrl, serviceRoleKey } = getSupabaseCreds();
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${token}`
    }
  });
  if (!res.ok) return null;
  return res.json();
};

const getTeamMember = async (email) => {
  const { supabaseUrl, serviceRoleKey } = getSupabaseCreds();
  const res = await fetch(
    `${supabaseUrl}/rest/v1/admin_team?email=eq.${encodeURIComponent(email)}&limit=1`,
    {
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Accept': 'application/json'
      }
    }
  );
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

const requireAuth = async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) { sendJson(res, 401, { error: 'Missing token' }); return null; }

  const user = await verifyToken(token);
  if (!user) { sendJson(res, 401, { error: 'Invalid token' }); return null; }

  const member = await getTeamMember(user.email);
  if (!member) { sendJson(res, 403, { error: 'Not a team member' }); return null; }
  if (member.status === 'pending') { sendJson(res, 403, { error: 'Your invite has not been accepted yet' }); return null; }

  return { user, member };
};

const requireAdmin = async (req, res) => {
  const result = await requireAuth(req, res);
  if (!result) return null;
  if (result.member.role !== 'admin') {
    sendJson(res, 403, { error: 'Admin access required' });
    return null;
  }
  return result;
};

const supabaseRequest = async (path, options = {}) => {
  const { supabaseUrl, serviceRoleKey } = getSupabaseCreds();
  const { method = 'GET', body = null, extraHeaders = {} } = options;
  const res = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Accept': 'application/json',
      'Prefer': 'return=representation',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok) throw new Error(payload?.message || payload?.error || `Supabase error ${res.status}`);
  return payload;
};

// Create a confirmed Supabase auth user with a chosen password.
const createAuthUser = async (email, password, full_name) => {
  const { supabaseUrl, serviceRoleKey } = getSupabaseCreds();
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: full_name ? { full_name } : {}
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || data.message || data.error || `Failed to create user (${res.status})`);
  return data;
};

// Generate a recovery / signup link via the admin endpoint (no email sent).
const generateAuthLink = async (type, email, redirectTo) => {
  const { supabaseUrl, serviceRoleKey } = getSupabaseCreds();
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ type, email, ...(redirectTo ? { redirect_to: redirectTo } : {}) })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || data.message || data.error || `Failed to generate link (${res.status})`);
  return data?.action_link || data?.properties?.action_link || null;
};

const newInviteToken = () => crypto.randomBytes(24).toString('base64url');

const baseUrlFromReq = (req) => {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers['host'];
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  if (host) return `${proto}://${host}`;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return 'https://my-mint-admin.vercel.app';
};

const sendResendEmail = async ({ to, subject, html, text }) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not set — skipping send to', to);
    return { skipped: true, reason: 'RESEND_API_KEY missing' };
  }
  const fromEmail = process.env.ORDERBOOK_EMAIL_FROM || 'admin@mintinvestments.co.za';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: [to], subject, text, html })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[Email] Resend error:', data?.message || data?.error || res.status);
      return { skipped: true, reason: data?.message || `Resend error ${res.status}` };
    }
    console.log('[Email] Sent:', data.id, 'to', to);
    return { skipped: false, id: data.id };
  } catch (err) {
    console.error('[Email] Send failed:', err.message);
    return { skipped: true, reason: err.message };
  }
};

const sendInviteEmail = async ({ toEmail, toName, inviterEmail, signupLink }) => {
  return sendResendEmail({
    to: toEmail,
    subject: 'You have been invited to Mint Admin',
    text: `Hi ${toName || toEmail},\n\nYou have been invited to the Mint Admin Portal by ${inviterEmail}.\nFinish creating your account here: ${signupLink}\n\nThis invite link expires in 7 days.`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1c1c1e;">
        <h2 style="color:#1c1c1e;">You have been invited to Mint Admin</h2>
        <p>Hi ${toName || toEmail},</p>
        <p><strong>${inviterEmail}</strong> has invited you to join the Mint Admin Portal. Click the button below to set your password and finish creating your account.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${signupLink}" style="display:inline-block;padding:12px 22px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;">Accept Invitation</a>
        </p>
        <p style="font-size:12px;color:#8e8e93;">Or copy this link into your browser:<br><a href="${signupLink}">${signupLink}</a></p>
        <p style="font-size:12px;color:#8e8e93;">This invite expires in 7 days. Use the email address it was sent to when signing up.</p>
      </div>
    `
  });
};

const sendWelcomeEmail = async ({ toEmail, toName, dashboardLink }) => {
  return sendResendEmail({
    to: toEmail,
    subject: 'Welcome to Mint Admin',
    text: `Hi ${toName || toEmail},\n\nYour Mint Admin account is ready. Sign in here: ${dashboardLink}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1c1c1e;">
        <h2 style="color:#1c1c1e;">Welcome to Mint Admin</h2>
        <p>Hi ${toName || toEmail},</p>
        <p>Your account has been created and is ready to use. You can now sign in to the admin portal.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${dashboardLink}" style="display:inline-block;padding:12px 22px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;">Open Admin Portal</a>
        </p>
        <p style="font-size:12px;color:#8e8e93;">If you did not expect this email, please ignore it.</p>
      </div>
    `
  });
};

const sendResetEmail = async ({ toEmail, resetLink }) => {
  return sendResendEmail({
    to: toEmail,
    subject: 'Reset your Mint Admin password',
    text: `Reset your password using this link (valid for 1 hour): ${resetLink}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1c1c1e;">
        <h2 style="color:#1c1c1e;">Reset your password</h2>
        <p>Click the button below to choose a new password. This link is valid for 1 hour.</p>
        <p style="text-align:center;margin:28px 0;">
          <a href="${resetLink}" style="display:inline-block;padding:12px 22px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;">Reset Password</a>
        </p>
        <p style="font-size:12px;color:#8e8e93;">If you didn't request this, you can ignore this email.</p>
      </div>
    `
  });
};

module.exports = {
  ALLOWED_DOMAIN,
  INVITE_TTL_MS,
  sendJson,
  isAllowedDomain,
  requireAuth,
  requireAdmin,
  supabaseRequest,
  createAuthUser,
  generateAuthLink,
  newInviteToken,
  baseUrlFromReq,
  sendInviteEmail,
  sendWelcomeEmail,
  sendResetEmail
};
