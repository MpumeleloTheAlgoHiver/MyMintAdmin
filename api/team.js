const {
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
} = require('./_team');

const normEmail = (e) => String(e || '').trim().toLowerCase();

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const action = url.searchParams.get('action') || req.body?.action;

    // ME — current user's role + page access
    if (action === 'me') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const result = await requireAuth(req, res);
      if (!result) return;
      const { user, member } = result;
      return sendJson(res, 200, {
        ok: true,
        email: user.email,
        full_name: member.full_name || null,
        role: member.role,
        page_access: member.page_access || [],
        id: member.id
      });
    }

    // LIST — admin only
    if (action === 'list') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const result = await requireAdmin(req, res);
      if (!result) return;
      const data = await supabaseRequest(
        '/rest/v1/admin_team?select=id,user_id,email,full_name,role,page_access,status,invited_by,created_at,updated_at&order=created_at.asc'
      );
      return sendJson(res, 200, { ok: true, members: data });
    }

    // INVITE — admin only. Stores token, returns signup link, tries to email it.
    if (action === 'invite') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const result = await requireAdmin(req, res);
      if (!result) return;
      const email = normEmail(req.body?.email);
      const full_name = (req.body?.full_name || '').trim() || null;
      const role = req.body?.role === 'admin' ? 'admin' : 'staff';
      const page_access = role === 'admin' ? [] : (Array.isArray(req.body?.page_access) ? req.body.page_access : []);

      if (!email) return sendJson(res, 400, { error: 'Email is required' });
      if (!isAllowedDomain(email)) {
        return sendJson(res, 400, { error: `Only ${ALLOWED_DOMAIN} email addresses can be invited` });
      }

      const existing = await supabaseRequest(`/rest/v1/admin_team?email=eq.${encodeURIComponent(email)}`);
      const invite_token = newInviteToken();
      const invite_token_expires_at = new Date(Date.now() + INVITE_TTL_MS).toISOString();
      const baseUrl = baseUrlFromReq(req);
      const signupLink = `${baseUrl}/signup.html?email=${encodeURIComponent(email)}&token=${invite_token}`;

      let member;
      if (existing && existing.length > 0) {
        const current = existing[0];
        if (current.status === 'active') {
          return sendJson(res, 400, { error: 'User is already an active team member' });
        }
        // Re-issue the invite for a pending row
        const [updated] = await supabaseRequest(`/rest/v1/admin_team?id=eq.${current.id}`, {
          method: 'PATCH',
          extraHeaders: { 'Prefer': 'return=representation' },
          body: { full_name, role, page_access, invite_token, invite_token_expires_at, invited_by: result.user.id, updated_at: new Date().toISOString() }
        });
        member = updated;
      } else {
        const [created] = await supabaseRequest('/rest/v1/admin_team', {
          method: 'POST',
          body: {
            email,
            full_name,
            role,
            page_access,
            status: 'pending',
            invited_by: result.user.id,
            invite_token,
            invite_token_expires_at
          }
        });
        member = created;
      }

      const emailRes = await sendInviteEmail({
        toEmail: email,
        toName: full_name,
        inviterEmail: result.user.email,
        signupLink
      });

      return sendJson(res, 200, {
        ok: true,
        member,
        signupLink,
        emailSent: !emailRes.skipped,
        emailReason: emailRes.reason || null
      });
    }

    // VERIFY-INVITE — public endpoint used by /signup.html to validate the token before showing the form.
    if (action === 'verify-invite') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const email = normEmail(url.searchParams.get('email'));
      const token = url.searchParams.get('token') || '';
      if (!email || !token) return sendJson(res, 400, { error: 'Missing email or token' });

      const rows = await supabaseRequest(`/rest/v1/admin_team?email=eq.${encodeURIComponent(email)}&limit=1`);
      const member = rows && rows[0];
      if (!member) return sendJson(res, 404, { error: 'Invitation not found' });
      if (member.status === 'active') return sendJson(res, 400, { error: 'This account is already active. Please sign in.' });
      if (!member.invite_token || member.invite_token !== token) return sendJson(res, 400, { error: 'Invalid invitation link' });
      if (member.invite_token_expires_at && new Date(member.invite_token_expires_at).getTime() < Date.now()) {
        return sendJson(res, 400, { error: 'This invitation has expired. Ask an admin to resend it.' });
      }
      return sendJson(res, 200, { ok: true, email: member.email, full_name: member.full_name, role: member.role });
    }

    // SIGNUP — public endpoint used by /signup.html to finish account creation.
    if (action === 'signup') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const email = normEmail(req.body?.email);
      const token = req.body?.token || '';
      const password = req.body?.password || '';
      const full_name = (req.body?.full_name || '').trim() || null;

      if (!email || !token) return sendJson(res, 400, { error: 'Missing email or token' });
      if (!isAllowedDomain(email)) return sendJson(res, 400, { error: `Only ${ALLOWED_DOMAIN} email addresses can sign up` });
      if (!password || password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters' });

      const rows = await supabaseRequest(`/rest/v1/admin_team?email=eq.${encodeURIComponent(email)}&limit=1`);
      const member = rows && rows[0];
      if (!member) return sendJson(res, 404, { error: 'Invitation not found' });
      if (member.status === 'active') return sendJson(res, 400, { error: 'This account is already active. Please sign in.' });
      if (!member.invite_token || member.invite_token !== token) return sendJson(res, 400, { error: 'Invalid invitation link' });
      if (member.invite_token_expires_at && new Date(member.invite_token_expires_at).getTime() < Date.now()) {
        return sendJson(res, 400, { error: 'This invitation has expired. Ask an admin to resend it.' });
      }

      // Create the Supabase auth user
      const created = await createAuthUser(email, password, full_name || member.full_name);
      const newUserId = created?.id || created?.user?.id;

      // Mark the team row active and clear the invite token
      const [updated] = await supabaseRequest(`/rest/v1/admin_team?id=eq.${member.id}`, {
        method: 'PATCH',
        extraHeaders: { 'Prefer': 'return=representation' },
        body: {
          status: 'active',
          user_id: newUserId || null,
          full_name: full_name || member.full_name,
          invite_token: null,
          invite_token_expires_at: null,
          updated_at: new Date().toISOString()
        }
      });

      const baseUrl = baseUrlFromReq(req);
      const dashboardLink = `${baseUrl}/signin.html`;
      await sendWelcomeEmail({ toEmail: email, toName: full_name, dashboardLink });

      return sendJson(res, 200, { ok: true, member: updated });
    }

    // FORGOT-PASSWORD — public. Generates a recovery link and emails it.
    if (action === 'forgot-password') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const email = normEmail(req.body?.email);
      if (!email) return sendJson(res, 400, { error: 'Email is required' });

      // Always respond OK to prevent email enumeration, but only email known team members.
      const rows = await supabaseRequest(`/rest/v1/admin_team?email=eq.${encodeURIComponent(email)}&limit=1`);
      const member = rows && rows[0];
      if (member && member.status === 'active') {
        try {
          const baseUrl = baseUrlFromReq(req);
          const link = await generateAuthLink('recovery', email, `${baseUrl}/reset-password.html`);
          if (link) await sendResetEmail({ toEmail: email, resetLink: link });
        } catch (err) {
          console.error('[Forgot] Failed:', err.message);
        }
      }
      return sendJson(res, 200, { ok: true });
    }

    // UPDATE — admin only
    if (action === 'update') {
      if (req.method !== 'PUT' && req.method !== 'POST' && req.method !== 'PATCH') {
        return sendJson(res, 405, { error: 'Method not allowed' });
      }
      const result = await requireAdmin(req, res);
      if (!result) return;
      const { id, role, page_access } = req.body || {};
      if (!id) return sendJson(res, 400, { error: 'id is required' });
      const safeRole = role === 'admin' ? 'admin' : 'staff';
      const [updated] = await supabaseRequest(`/rest/v1/admin_team?id=eq.${id}`, {
        method: 'PATCH',
        extraHeaders: { 'Prefer': 'return=representation' },
        body: {
          role: safeRole,
          page_access: safeRole === 'admin' ? [] : (Array.isArray(page_access) ? page_access : []),
          updated_at: new Date().toISOString()
        }
      });
      return sendJson(res, 200, { ok: true, member: updated });
    }

    // REMOVE — admin only
    if (action === 'remove') {
      if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
      const result = await requireAdmin(req, res);
      if (!result) return;
      const id = req.body?.id || url.searchParams.get('id');
      if (!id) return sendJson(res, 400, { error: 'id is required' });
      if (String(id) === String(result.member.id)) return sendJson(res, 400, { error: 'Cannot remove yourself' });
      await supabaseRequest(`/rest/v1/admin_team?id=eq.${id}`, { method: 'DELETE' });
      return sendJson(res, 200, { ok: true });
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[Team API]', err);
    sendJson(res, 500, { error: err.message });
  }
};
