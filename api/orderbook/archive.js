const { sendJson, fetchSupabaseJson, requestSupabaseJson } = require('../_orderbook');

const normalizeArchiveRows = (rows) => {
  return (rows || [])
    .filter((row) => Array.isArray(row?.snapshot_rows) && row.snapshot_rows.length > 0)
    .map((row, index) => {
      const sequence = Number(row.sequence_number || 0) || (index + 1);
      const dateKey = String(row.run_date || '');
      const createdAt = row.sent_at || row.updated_at || row.created_at || null;
      return {
        id: `${dateKey}-${sequence}`,
        dateKey,
        sequence,
        title: row.title || `Order Book ${sequence}`,
        dateLabel: row.date_label || dateKey,
        createdAt,
        rows: row.snapshot_rows || [],
        emailStatus: row.status === 'sent' ? 'sent' : (row.status === 'failed' ? 'failed' : ''),
        emailError: row.error_message || '',
        runDate: dateKey
      };
    });
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    return sendJson(res, 401, { error: 'Missing Authorization bearer token' });
  }

  try {
    await fetchSupabaseJson('/auth/v1/user', token, false);

    const dbRows = await requestSupabaseJson(
      '/rest/v1/orderbook_email_runs?select=run_date,status,row_count,sent_at,error_message,created_at,updated_at,sequence_number,title,date_label,snapshot_rows&order=sequence_number.desc.nullslast,run_date.desc',
      { method: 'GET' }
    );

    const items = normalizeArchiveRows(Array.isArray(dbRows) ? dbRows : []);
    return sendJson(res, 200, { items });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Could not load orderbook archive',
      details: error?.message || 'Unknown error'
    });
  }
};
