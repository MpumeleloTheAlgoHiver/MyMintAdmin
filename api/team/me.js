const { sendJson, requireAuth } = require('../_team');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const result = await requireAuth(req, res);
    if (!result) return;
    const { member } = result;
    sendJson(res, 200, {
      ok: true,
      idx: member.idx,
      role: member.role,
      page_permissions: member.page_permissions,
      full_name: member.full_name,
      email: member.email
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
};
