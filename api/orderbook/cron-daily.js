const {
  sendJson,
  requestSupabaseJson,
  toOrderbookCsvContent,
  sendOrderbookCsvEmail,
  loadLiveOrderbookRows
} = require('../_orderbook');

const getNowInTimezoneParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const valueByType = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') {
      valueByType[part.type] = part.value;
    }
  });

  return {
    year: Number(valueByType.year),
    month: Number(valueByType.month),
    day: Number(valueByType.day),
    hour: Number(valueByType.hour),
    minute: Number(valueByType.minute),
    second: Number(valueByType.second)
  };
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization || '';
    if (authHeader !== `Bearer ${cronSecret}`) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }
  }

  const timeZone = process.env.ORDERBOOK_TIMEZONE || 'Africa/Johannesburg';
  const targetHour = Number(process.env.ORDERBOOK_DAILY_AM_HOUR || 11);
  const targetMinute = Number(process.env.ORDERBOOK_DAILY_AM_MINUTE || 59);

  try {
    const now = new Date();
    const localNow = getNowInTimezoneParts(now, timeZone);
    const dateKey = `${String(localNow.year).padStart(4, '0')}-${String(localNow.month).padStart(2, '0')}-${String(localNow.day).padStart(2, '0')}`;
    const isPastCutoff = localNow.hour > targetHour || (localNow.hour === targetHour && localNow.minute >= targetMinute);

    if (!isPastCutoff) {
      return sendJson(res, 200, {
        ok: true,
        skipped: true,
        reason: 'Before cutoff time',
        now: localNow,
        target: { hour: targetHour, minute: targetMinute, timeZone }
      });
    }

    const existingRuns = await requestSupabaseJson(
      `/rest/v1/orderbook_email_runs?select=id,run_date,status,sent_at&run_date=eq.${dateKey}&limit=1`,
      { method: 'GET' }
    );
    const existingRun = Array.isArray(existingRuns) && existingRuns.length ? existingRuns[0] : null;

    if (existingRun?.status === 'sent') {
      return sendJson(res, 200, {
        ok: true,
        skipped: true,
        reason: 'Already sent for date',
        runDate: dateKey,
        sentAt: existingRun.sent_at || null,
        now: localNow,
        target: { hour: targetHour, minute: targetMinute, timeZone }
      });
    }

    const upsertPayload = {
      run_date: dateKey,
      status: 'pending',
      timezone: timeZone,
      target_hour: targetHour,
      target_minute: targetMinute,
      last_attempt_at: new Date().toISOString(),
      error_message: null
    };

    await requestSupabaseJson(
      '/rest/v1/orderbook_email_runs?on_conflict=run_date',
      {
        method: 'POST',
        body: upsertPayload,
        extraHeaders: {
          'Prefer': 'resolution=merge-duplicates,return=representation'
        }
      }
    );

    const rows = await loadLiveOrderbookRows();
    const dateLabel = `${String(localNow.year).padStart(4, '0')}-${String(localNow.month).padStart(2, '0')}-${String(localNow.day).padStart(2, '0')} ${String(localNow.hour).padStart(2, '0')}:${String(localNow.minute).padStart(2, '0')}`;

    try {
      await sendOrderbookCsvEmail({
        subject: `Daily Filled Order Book - ${dateLabel} (${timeZone})`,
        csvContent: toOrderbookCsvContent(rows),
        fileName: `daily-filled-orderbook-${String(localNow.year).padStart(4, '0')}-${String(localNow.month).padStart(2, '0')}-${String(localNow.day).padStart(2, '0')}.csv`
      });

      await requestSupabaseJson(
        `/rest/v1/orderbook_email_runs?run_date=eq.${dateKey}`,
        {
          method: 'PATCH',
          body: {
            status: 'sent',
            sent_at: new Date().toISOString(),
            row_count: rows.length,
            error_message: null
          }
        }
      );
    } catch (sendError) {
      await requestSupabaseJson(
        `/rest/v1/orderbook_email_runs?run_date=eq.${dateKey}`,
        {
          method: 'PATCH',
          body: {
            status: 'failed',
            error_message: sendError?.message || 'Unknown send error',
            last_attempt_at: new Date().toISOString()
          }
        }
      );

      throw sendError;
    }

    return sendJson(res, 200, {
      ok: true,
      sent: true,
      rowCount: rows.length,
      at: dateLabel,
      runDate: dateKey,
      timeZone
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Daily cron send failed',
      details: error?.message || 'Unknown error'
    });
  }
};
