const { sendJson, requireAdmin, supabaseRequest } = require('../_team');

module.exports = async (req, res) => {
  if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const result = await requireAdmin(req, res);
    if (!result) return;

    const idx = req.body?.idx || new URL(req.url, 'http://x').searchParams.get('idx');
    if (!idx) return sendJson(res, 400, { error: 'idx is required' });
    if (String(idx) === String(result.member.idx)) return sendJson(res, 400, { error: 'Cannot remove yourself' });

    await supabaseRequest(`/rest/v1/admin_team?idx=eq.${idx}`, { method: 'DELETE' });
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
};
