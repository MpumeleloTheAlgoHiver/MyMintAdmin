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

const sendInviteEmail = async (toEmail, toName, inviterEmail) => {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.ORDERBOOK_EMAIL_FROM || 'admin@mintinvestments.co.za';
  
  if (!resendApiKey) {
    console.error('[Email] Cannot send invite: RESEND_API_KEY is not configured');
    throw new Error('Email service not configured (RESEND_API_KEY missing)');
  }

  const baseUrl = process.env.APP_BASE_URL || 'https://my-mint-admin.vercel.app';
  console.log(`[Email] Sending invite to ${toEmail} from ${fromEmail} via ${baseUrl}`);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: 'You have been invited to Mint Admin',
        text: `Hi ${toName || toEmail},\n\nYou have been invited to the Mint Admin Portal by ${inviterEmail}.\n\nAccess your dashboard here: ${baseUrl}\n\nUse the email address this was sent to when logging in.`,
        html: `
          <p>Hi ${toName || toEmail},</p>
          <p>You have been invited to the Mint Admin Portal by ${inviterEmail}.</p>
          <p><a href="${baseUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 10px 20px; background-color: #7c3aed; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Click here to access your dashboard</a></p>
          <p>Or copy and paste this link: <a href="${baseUrl}">${baseUrl}</a></p>
          <p>Use the email address this was sent to when logging in.</p>
        `
      })
    });

    const data = await res.json().catch(() => ({}));
    
    if (!res.ok) {
      console.error('[Email] Resend API error:', data.message || data.error || `Status ${res.status}`);
      throw new Error(data.message || data.error || `Resend error ${res.status}`);
    }

    console.log('[Email] Invite sent successfully:', data.id);
    return data;
  } catch (err) {
    console.error('[Email] Failed to send invite email:', err.message);
    throw err;
  }
};

module.exports = { sendJson, requireAuth, requireAdmin, supabaseRequest, sendInviteEmail };
