const {
  sendJson,
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
  const targetMinute = Number(process.env.ORDERBOOK_DAILY_AM_MINUTE || 40);

  try {
    const now = new Date();
    const localNow = getNowInTimezoneParts(now, timeZone);

    if (localNow.hour !== targetHour || localNow.minute !== targetMinute) {
      return sendJson(res, 200, {
        ok: true,
        skipped: true,
        reason: 'Not scheduled minute',
        now: localNow,
        target: { hour: targetHour, minute: targetMinute, timeZone }
      });
    }

    const rows = await loadLiveOrderbookRows();
    const dateLabel = `${String(localNow.year).padStart(4, '0')}-${String(localNow.month).padStart(2, '0')}-${String(localNow.day).padStart(2, '0')} ${String(localNow.hour).padStart(2, '0')}:${String(localNow.minute).padStart(2, '0')}`;

    await sendOrderbookCsvEmail({
      subject: `Daily Filled Order Book - ${dateLabel} (${timeZone})`,
      csvContent: toOrderbookCsvContent(rows),
      fileName: `daily-filled-orderbook-${String(localNow.year).padStart(4, '0')}-${String(localNow.month).padStart(2, '0')}-${String(localNow.day).padStart(2, '0')}.csv`
    });

    return sendJson(res, 200, {
      ok: true,
      sent: true,
      rowCount: rows.length,
      at: dateLabel,
      timeZone
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Daily cron send failed',
      details: error?.message || 'Unknown error'
    });
  }
};
