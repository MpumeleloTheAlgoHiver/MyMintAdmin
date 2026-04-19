const { sendJson, requireAdmin, supabaseRequest } = require('../_team');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const result = await requireAdmin(req, res);
    if (!result) return;
    const members = await supabaseRequest('/rest/v1/admin_team?order=created_at.asc');
    sendJson(res, 200, { ok: true, members });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
};
