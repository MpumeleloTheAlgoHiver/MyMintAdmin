const { sendJson, requireAuth, supabaseRequest, sendResendEmail, emailShell, baseUrlFromReq } = require('./_team');

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

  // POST /api/tasks/:id?action=request_help — notify a coworker that their help is needed
  if (req.method === 'POST' && taskId && url.searchParams.get('action') === 'request_help') {
    const { notify_member_id, note } = req.body || {};
    if (!notify_member_id) return sendJson(res, 400, { error: 'notify_member_id is required' });

    const [tasks, members] = await Promise.all([
      supabaseRequest(`/rest/v1/tasks?id=eq.${encodeURIComponent(taskId)}&select=*&limit=1`, { method: 'GET' }),
      supabaseRequest(`/rest/v1/admin_team?id=eq.${encodeURIComponent(notify_member_id)}&select=email,full_name&limit=1`, { method: 'GET' }),
    ]);

    const task = Array.isArray(tasks) ? tasks[0] : null;
    const helper = Array.isArray(members) ? members[0] : null;
    if (!task) return sendJson(res, 404, { error: 'Task not found' });
    if (!helper?.email) return sendJson(res, 404, { error: 'Team member not found' });

    const requesterName = auth.member.full_name || auth.member.email || 'A teammate';
    const greeting = helper.full_name ? `Hi ${helper.full_name.split(' ')[0]},` : 'Hi there,';
    const baseUrl = baseUrlFromReq(req);

    await sendResendEmail({
      to: helper.email,
      subject: `${requesterName} needs your help: ${task.title}`,
      text: `${greeting}\n\n${requesterName} needs your help with a task in today's standup.\n\nTask: ${task.title}\n${note ? `Note: ${note}\n` : ''}\nView it here: ${baseUrl}/standup.html\n\n— Mint Hub`,
      html: emailShell({
        preheader: `${requesterName} needs your help with "${task.title}" in today's standup.`,
        heading: 'Your help is needed',
        intro: `${greeting} <strong>${requesterName}</strong> needs your help with a task in today's daily standup.`,
        body: `
          <div style="background:#faf7ff;border:1px solid #ede5ff;border-radius:12px;padding:16px 18px;margin:4px 0 8px 0;">
            <div style="font-size:11px;font-weight:600;color:#5b21b6;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Task</div>
            <div style="font-size:15px;font-weight:700;color:#1c1c1e;">${task.title}</div>
            ${task.description ? `<div style="font-size:13px;color:#3c3c43;margin-top:6px;">${task.description}</div>` : ''}
            <div style="margin-top:10px;display:flex;gap:12px;flex-wrap:wrap;">
              <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:#ede9fe;color:#5b21b6;">${task.priority || 'medium'}</span>
              ${task.due_date ? `<span style="font-size:12px;color:#8e8e93;">Due: ${task.due_date}</span>` : ''}
            </div>
          </div>
          ${note ? `
          <div style="background:#fff8e1;border:1px solid #fde68a;border-radius:12px;padding:14px 18px;margin:12px 0 4px 0;">
            <div style="font-size:11px;font-weight:600;color:#c47f00;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Note from ${requesterName}</div>
            <div style="font-size:14px;color:#1c1c1e;">${note}</div>
          </div>` : ''}
        `,
        ctaLabel: 'Open Daily Standup',
        ctaUrl: `${baseUrl}/standup.html`,
        fallbackUrl: `${baseUrl}/standup.html`,
        footer: `You received this because ${requesterName} flagged this task in Mint Hub.`
      })
    });

    return sendJson(res, 200, { ok: true });
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
