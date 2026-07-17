const { sendJson, requireAuth, supabaseRequest } = require('./_team');

function localDate(offsetDays = 0) {
  const now = new Date();
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  sast.setUTCDate(sast.getUTCDate() + offsetDays);
  return `${sast.getUTCFullYear()}-${String(sast.getUTCMonth()+1).padStart(2,'0')}-${String(sast.getUTCDate()).padStart(2,'0')}`;
}

module.exports = async (req, res) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const url = new URL(req.url, 'http://x');
  // Extract task id from path or query param (query param used when routed via team.js on Vercel)
  const pathParts = url.pathname.replace(/^\/api\/tasks\/?/, '').split('/').filter(Boolean);
  const taskId = pathParts[0] || url.searchParams.get('taskId') || null;

  // GET /api/tasks?action=me — current user's own member record
  if (req.method === 'GET' && url.searchParams.get('action') === 'me') {
    console.log('[tasks/me] member:', JSON.stringify({ id: auth.member?.id, email: auth.member?.email, full_name: auth.member?.full_name, role: auth.member?.role }));
    return sendJson(res, 200, auth.member);
  }

  // GET /api/tasks?action=members — all active team members, any auth'd user
  if (req.method === 'GET' && url.searchParams.get('action') === 'members') {
    const rows = await supabaseRequest(
      '/rest/v1/admin_team?select=id,full_name,email,role,status&order=full_name.asc',
      { method: 'GET' }
    );
    return sendJson(res, 200, Array.isArray(rows) ? rows : []);
  }

  // GET /api/tasks
  if (req.method === 'GET' && !taskId) {
    const filter = url.searchParams.get('filter'); // today | yesterday | all
    const TODAY = localDate(0);
    const YESTERDAY = localDate(-1);

    let qs = 'select=*,assignee:assigned_to(id,full_name,email),creator:created_by(id,full_name,email)&order=created_at.desc';
    if (filter === 'today') {
      qs += `&or=(due_date.eq.${TODAY},status.eq.in_progress)`;
    } else if (filter === 'yesterday') {
      qs += `&due_date=eq.${YESTERDAY}&status=neq.done`;
    }

    const rows = await supabaseRequest(`/rest/v1/tasks?${qs}`, { method: 'GET' });
    return sendJson(res, 200, rows);
  }

  // POST /api/tasks
  if (req.method === 'POST' && !taskId) {
    const { title, priority, due_date, assigned_to, status } = req.body || {};
    if (!title || !title.trim()) return sendJson(res, 400, { error: 'title is required' });

    const row = await supabaseRequest('/rest/v1/tasks', {
      method: 'POST',
      extraHeaders: { 'Prefer': 'return=representation' },
      body: {
        title: title.trim(),
        priority: priority || 'medium',
        due_date: due_date || localDate(0),
        assigned_to: assigned_to || null,
        created_by: auth.member.id || null,
        status: status || 'todo',
      }
    });
    return sendJson(res, 201, Array.isArray(row) ? row[0] : row);
  }

  // PATCH /api/tasks/:id
  if (req.method === 'PATCH' && taskId) {
    const updates = req.body || {};
    if (updates.status === 'in_progress' && !updates.started_at) {
      updates.started_at = new Date().toISOString();
    }
    if (updates.status === 'done' && !updates.completed_at) {
      updates.completed_at = new Date().toISOString();
    }
    if (updates.status && updates.status !== 'done') {
      updates.completed_at = null;
    }
    const row = await supabaseRequest(`/rest/v1/tasks?id=eq.${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      extraHeaders: { 'Prefer': 'return=representation' },
      body: updates
    });
    return sendJson(res, 200, Array.isArray(row) ? row[0] : row);
  }

  // DELETE /api/tasks/:id
  if (req.method === 'DELETE' && taskId) {
    await supabaseRequest(`/rest/v1/tasks?id=eq.${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
      extraHeaders: { 'Prefer': 'return=minimal' }
    });
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 404, { error: 'Not found' });
};
