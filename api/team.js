const {
  ALLOWED_DOMAIN,
  INVITE_TTL_MS,
  sendJson,
  isAllowedDomain,
  requireAuth,
  requireAdmin,
  supabaseRequest,
  createAuthUser,
  listAuthUsers,
  generateAuthLink,
  newInviteToken,
  baseUrlFromReq,
  inviteUserViaSupabase,
  recoverPasswordViaSupabase
} = require('./_team');

const normEmail = (e) => String(e || '').trim().toLowerCase();

// Best-effort audit log writer. Failures must NOT break the underlying action.
const writeAudit = async (entry) => {
  try {
    await supabaseRequest('/rest/v1/admin_team_audit', {
      method: 'POST',
      extraHeaders: { 'Prefer': 'return=minimal' },
      body: entry
    });
  } catch (err) {
    console.error('[Audit] insert failed:', err.message);
  }
};

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
      // Enrich with last_sign_in_at from Supabase Auth (best-effort).
      let signInByEmail = {};
      let signInByUserId = {};
      try {
        const users = await listAuthUsers();
        users.forEach(u => {
          if (u.email) signInByEmail[String(u.email).toLowerCase()] = u.last_sign_in_at || null;
          if (u.id) signInByUserId[u.id] = u.last_sign_in_at || null;
        });
      } catch (err) {
        console.warn('[team] listAuthUsers failed:', err.message);
      }
      const enriched = (data || []).map(m => ({
        ...m,
        last_sign_in_at: (m.user_id && signInByUserId[m.user_id]) || signInByEmail[String(m.email || '').toLowerCase()] || null
      }));
      return sendJson(res, 200, { ok: true, members: enriched });
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
      const baseUrl = baseUrlFromReq(req);
      const redirectTo = `${baseUrl}/signup.html`;

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
          body: { full_name, role, page_access, invited_by: result.user.id, updated_at: new Date().toISOString() }
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
            invited_by: result.user.id
          }
        });
        member = created;
      }

      // Ask Supabase to create the auth user (if not already) and send the invite email
      // through whatever email provider is configured in the Supabase dashboard.
      const emailRes = await inviteUserViaSupabase(email, redirectTo, full_name);

      await writeAudit({
        action: 'invite',
        target_email: email,
        target_member_id: member?.id || null,
        actor_email: result.user.email,
        actor_user_id: result.user.id,
        details: {
          role,
          page_access,
          full_name,
          reissue: existing && existing.length > 0,
          email_sent: emailRes.ok,
          email_reason: emailRes.error || null,
          via: 'supabase'
        }
      });

      if (!emailRes.ok) {
        return sendJson(res, 200, {
          ok: true,
          member,
          emailSent: false,
          emailReason: emailRes.error,
          warning: `Member added but Supabase could not send the email: ${emailRes.error}. Check your Supabase Auth email settings.`
        });
      }

      return sendJson(res, 200, { ok: true, member, emailSent: true });
    }

    // RESEND — admin only. Re-issues a fresh invite token for a pending member
    // and re-sends the invitation email (or returns the new link).
    if (action === 'resend') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const result = await requireAdmin(req, res);
      if (!result) return;
      const id = req.body?.id;
      if (!id) return sendJson(res, 400, { error: 'id is required' });

      const rows = await supabaseRequest(`/rest/v1/admin_team?id=eq.${id}&limit=1`);
      const member = rows && rows[0];
      if (!member) return sendJson(res, 404, { error: 'Member not found' });
      if (member.status === 'active') return sendJson(res, 400, { error: 'User is already active — no invite to resend' });

      const baseUrl = baseUrlFromReq(req);
      const redirectTo = `${baseUrl}/signup.html`;

      const [updated] = await supabaseRequest(`/rest/v1/admin_team?id=eq.${id}`, {
        method: 'PATCH',
        extraHeaders: { 'Prefer': 'return=representation' },
        body: { invited_by: result.user.id, updated_at: new Date().toISOString() }
      });

      // Ask Supabase to (re-)send the invite email
      const emailRes = await inviteUserViaSupabase(member.email, redirectTo, member.full_name);

      await writeAudit({
        action: 'invite',
        target_email: member.email,
        target_member_id: id,
        actor_email: result.user.email,
        actor_user_id: result.user.id,
        details: {
          role: member.role,
          page_access: member.page_access || [],
          full_name: member.full_name,
          reissue: true,
          email_sent: emailRes.ok,
          email_reason: emailRes.error || null,
          via: 'supabase'
        }
      });

      if (!emailRes.ok) {
        return sendJson(res, 200, {
          ok: true,
          member: updated,
          emailSent: false,
          emailReason: emailRes.error,
          warning: `Could not resend via Supabase: ${emailRes.error}`
        });
      }

      return sendJson(res, 200, { ok: true, member: updated, emailSent: true });
    }

    // COMPLETE-SIGNUP — called by /signup.html after the invitee has set their password
    // via Supabase. We just mark the admin_team row active and bind their user_id.
    // The user MUST be authenticated (Supabase magic-link session in the Authorization header).
    if (action === 'complete-signup') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const email = normEmail(auth.user.email);
      const full_name = (req.body?.full_name || '').trim() || null;

      const rows = await supabaseRequest(`/rest/v1/admin_team?email=eq.${encodeURIComponent(email)}&limit=1`);
      const member = rows && rows[0];
      if (!member) return sendJson(res, 404, { error: 'No team membership found for this email. Ask an admin to invite you.' });

      const [updated] = await supabaseRequest(`/rest/v1/admin_team?id=eq.${member.id}`, {
        method: 'PATCH',
        extraHeaders: { 'Prefer': 'return=representation' },
        body: {
          status: 'active',
          user_id: auth.user.id,
          full_name: full_name || member.full_name,
          invite_token: null,
          invite_token_expires_at: null,
          updated_at: new Date().toISOString()
        }
      });

      await writeAudit({
        action: 'signup',
        target_email: email,
        target_member_id: updated?.id || member.id,
        actor_email: email,
        actor_user_id: auth.user.id,
        details: { full_name: full_name || member.full_name, via: 'supabase' }
      });

      return sendJson(res, 200, { ok: true, member: updated });
    }

    // FORGOT-PASSWORD — public. Asks Supabase to email a reset link.
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
          const r = await recoverPasswordViaSupabase(email, `${baseUrl}/reset-password.html`);
          if (!r.ok) console.error('[Forgot] Supabase recover failed:', r.error);
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

      const beforeRows = await supabaseRequest(`/rest/v1/admin_team?id=eq.${id}&limit=1`);
      const before = beforeRows && beforeRows[0];

      const safeRole = role === 'admin' ? 'admin' : 'staff';
      const safePages = safeRole === 'admin' ? [] : (Array.isArray(page_access) ? page_access : []);
      const [updated] = await supabaseRequest(`/rest/v1/admin_team?id=eq.${id}`, {
        method: 'PATCH',
        extraHeaders: { 'Prefer': 'return=representation' },
        body: {
          role: safeRole,
          page_access: safePages,
          updated_at: new Date().toISOString()
        }
      });

      await writeAudit({
        action: 'update',
        target_email: updated?.email || before?.email || '',
        target_member_id: id,
        actor_email: result.user.email,
        actor_user_id: result.user.id,
        details: {
          before: before ? { role: before.role, page_access: before.page_access || [] } : null,
          after:  { role: safeRole, page_access: safePages }
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

      const beforeRows = await supabaseRequest(`/rest/v1/admin_team?id=eq.${id}&limit=1`);
      const before = beforeRows && beforeRows[0];

      await supabaseRequest(`/rest/v1/admin_team?id=eq.${id}`, { method: 'DELETE' });

      await writeAudit({
        action: 'remove',
        target_email: before?.email || '',
        target_member_id: id,
        actor_email: result.user.email,
        actor_user_id: result.user.id,
        details: before ? { role: before.role, page_access: before.page_access || [], full_name: before.full_name } : {}
      });

      return sendJson(res, 200, { ok: true });
    }

    // AUDIT-LIST — admin only
    if (action === 'audit-list') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const result = await requireAdmin(req, res);
      if (!result) return;
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500);
      try {
        const rows = await supabaseRequest(
          `/rest/v1/admin_team_audit?select=id,action,target_email,target_member_id,actor_email,actor_user_id,details,created_at&order=created_at.desc&limit=${limit}`
        );
        return sendJson(res, 200, { ok: true, entries: rows });
      } catch (err) {
        // If the table doesn't exist yet, return an actionable hint
        return sendJson(res, 200, { ok: true, entries: [], notice: 'Audit table not yet created. Run sql/admin_team_audit.sql in your Supabase SQL editor.' });
      }
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[Team API]', err);
    sendJson(res, 500, { error: err.message });
  }
};
