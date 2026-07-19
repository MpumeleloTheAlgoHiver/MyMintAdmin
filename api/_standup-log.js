const { sendJson, requireAuth, supabaseRequest } = require('./_team');

function sastDate(offsetDays = 0) {
  const sast = new Date(Date.now() + 2 * 3600000);
  sast.setUTCDate(sast.getUTCDate() + offsetDays);
  return `${sast.getUTCFullYear()}-${String(sast.getUTCMonth()+1).padStart(2,'0')}-${String(sast.getUTCDate()).padStart(2,'0')}`;
}

// Snapshot all tasks active on a given date into standup_logs.
// "Active" = due_date matches OR status is in_progress.
async function runSnapshot(date) {
  const tasks = await supabaseRequest(
    `/rest/v1/tasks?select=id,title,status,priority,due_date,assigned_to&or=(due_date.eq.${date},status.eq.in_progress)`,
    { method: 'GET' }
  );
  if (!Array.isArray(tasks) || !tasks.length) return { snapped: 0 };

  const rows = tasks.map(t => ({
    log_date:  date,
    task_id:   t.id,
    member_id: t.assigned_to || null,
    title:     t.title,
    status:    t.status,
    priority:  t.priority || 'medium',
    due_date:  t.due_date || null,
    snapped_at: new Date().toISOString(),
  }));

  await supabaseRequest('/rest/v1/standup_logs', {
    method: 'POST',
    extraHeaders: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: rows,
  });

  return { snapped: rows.length, date };
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const TODAY = sastDate(0);

  // POST /api/standup-log/snapshot — cron or manual trigger (no user auth needed, internal)
  if (req.method === 'POST' && url.searchParams.get('action') === 'snapshot') {
    const date = url.searchParams.get('date') || TODAY;
    const result = await runSnapshot(date);
    return sendJson(res, 200, result);
  }

  // All other endpoints require auth
  const auth = await requireAuth(req, res);
  if (!auth) return;

  // GET /api/standup-log?date=YYYY-MM-DD
  if (req.method === 'GET') {
    const date = url.searchParams.get('date') || TODAY;

    // Don't serve snapshots for today — caller should use live tasks
    if (date >= TODAY) return sendJson(res, 200, { live: true });

    const rows = await supabaseRequest(
      `/rest/v1/standup_logs?log_date=eq.${date}&select=*,member:member_id(id,full_name,email,role)&order=member_id.asc`,
      { method: 'GET' }
    );

    // If no snapshot exists, fall back to live tasks filtered by due_date
    if (!Array.isArray(rows) || !rows.length) {
      const tasks = await supabaseRequest(
        `/rest/v1/tasks?due_date=eq.${date}&select=*,assignee:assigned_to(id,full_name,email),creator:created_by(id,full_name,email)`,
        { method: 'GET' }
      );
      return sendJson(res, 200, { live: false, fallback: true, rows: Array.isArray(tasks) ? tasks : [] });
    }

    return sendJson(res, 200, { live: false, fallback: false, rows });
  }

  sendJson(res, 404, { error: 'Not found' });
};

module.exports.runSnapshot = runSnapshot;
