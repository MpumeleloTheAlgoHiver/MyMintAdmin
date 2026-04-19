const { sendJson, requireAdmin, supabaseRequest } = require('../_team');

module.exports = async (req, res) => {
  if (req.method !== 'PATCH') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const result = await requireAdmin(req, res);
    if (!result) return;

    const { idx, role, page_permissions } = req.body || {};
    if (!idx) return sendJson(res, 400, { error: 'idx is required' });
    if (idx === result.member.idx && role && role !== 'admin') {
      return sendJson(res, 400, { error: 'Cannot demote your own admin role' });
    }

    const patch = {};
    if (role !== undefined) {
      if (!['admin', 'staff'].includes(role)) return sendJson(res, 400, { error: 'Invalid role' });
      patch.role = role;
    }
    if (page_permissions !== undefined) patch.page_permissions = page_permissions;
    patch.updated_at = new Date().toISOString();

    const [updated] = await supabaseRequest(`/rest/v1/admin_team?idx=eq.${idx}`, {
      method: 'PATCH',
      body: patch
    });

    sendJson(res, 200, { ok: true, member: updated });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
};
