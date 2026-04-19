const { sendJson, requireAdmin, supabaseRequest, sendInviteEmail } = require('../_team');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const result = await requireAdmin(req, res);
    if (!result) return;

    const { email, full_name, role = 'staff', page_permissions = [] } = req.body || {};
    if (!email) return sendJson(res, 400, { error: 'email is required' });
    if (!['admin', 'staff'].includes(role)) return sendJson(res, 400, { error: 'Invalid role' });

    const existing = await supabaseRequest(
      `/rest/v1/admin_team?email=eq.${encodeURIComponent(email)}&limit=1`
    );
    if (Array.isArray(existing) && existing.length > 0) {
      return sendJson(res, 409, { error: 'A team member with that email already exists' });
    }

    const [member] = await supabaseRequest('/rest/v1/admin_team', {
      method: 'POST',
      body: {
        email,
        full_name: full_name || null,
        role,
        page_permissions: role === 'admin' ? [] : page_permissions,
        invited_by: result.user.id
      }
    });

    await sendInviteEmail(email, full_name, result.user.email).catch(() => {});

    sendJson(res, 201, { ok: true, member });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
};
