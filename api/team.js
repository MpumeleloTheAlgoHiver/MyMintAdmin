const { sendJson, requireAuth, requireAdmin, supabaseRequest, sendInviteEmail } = require('./_team');

const loadSupabaseSettings = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase credentials not configured');
  return { supabaseUrl, serviceRoleKey };
};

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const action = url.searchParams.get('action') || req.body?.action;
    
    // ME
    if (action === 'me') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const result = await requireAuth(req, res);
      if (!result) return;
      const { user, member } = result;
      return sendJson(res, 200, { ok: true, email: user.email, role: member.role, page_permissions: member.page_permissions || [], idx: member.idx });
    }
    
    // LIST
    if (action === 'list') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const result = await requireAdmin(req, res);
      if (!result) return;
      const data = await supabaseRequest('/rest/v1/admin_team?order=created_at.asc');
      return sendJson(res, 200, { ok: true, members: data });
    }
    
    // INVITE
    if (action === 'invite') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const result = await requireAdmin(req, res);
      if (!result) return;
      const { email, full_name, role = 'staff', page_permissions = [] } = req.body || {};
      if (!email) return sendJson(res, 400, { error: 'Email is required' });
      const existing = await supabaseRequest(`/rest/v1/admin_team?email=eq.${encodeURIComponent(email)}`);
      if (existing && existing.length > 0) return sendJson(res, 400, { error: 'User is already in team' });
      const [member] = await supabaseRequest('/rest/v1/admin_team', {
        method: 'POST',
        body: { email, full_name: full_name || null, role, page_permissions: role === 'admin' ? [] : page_permissions, invited_by: result.user.id }
      });
      await sendInviteEmail(email, full_name, result.user.email).catch(() => {});
      return sendJson(res, 200, { ok: true, member });
    }
    
    // UPDATE
    if (action === 'update') {
      if (req.method !== 'PUT' && req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      const result = await requireAdmin(req, res);
      if (!result) return;
      const { idx, role, page_permissions } = req.body || {};
      if (!idx) return sendJson(res, 400, { error: 'idx is required' });
      const [updated] = await supabaseRequest(`/rest/v1/admin_team?idx=eq.${idx}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=representation' },
        body: { role, page_permissions: role === 'admin' ? [] : (page_permissions || []) }
      });
      return sendJson(res, 200, { ok: true, member: updated });
    }
    
    // REMOVE
    if (action === 'remove') {
      if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
      const result = await requireAdmin(req, res);
      if (!result) return;
      const idx = req.body?.idx || url.searchParams.get('idx');
      if (!idx) return sendJson(res, 400, { error: 'idx is required' });
      if (String(idx) === String(result.member.idx)) return sendJson(res, 400, { error: 'Cannot remove yourself' });
      await supabaseRequest(`/rest/v1/admin_team?idx=eq.${idx}`, { method: 'DELETE' });
      return sendJson(res, 200, { ok: true });
    }
    
    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
};
