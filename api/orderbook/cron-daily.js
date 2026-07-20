const {
  sendJson,
  requestSupabaseJson,
  toOrderbookCsvContent,
  sendOrderbookCsvEmail,
  loadLiveOrderbookRows
} = require('../_orderbook');
const { publishEodReturns } = require('../_returns-publish');
const { publishClientEodReturns } = require('../_client-returns-publish');

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
  const targetHour = Number(process.env.ORDERBOOK_DAILY_AM_HOUR || 15);
  const targetMinute = Number(process.env.ORDERBOOK_DAILY_AM_MINUTE || 30);

  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const localNow = getNowInTimezoneParts(now, timeZone);
    const dateKey = `${String(localNow.year).padStart(4, '0')}-${String(localNow.month).padStart(2, '0')}-${String(localNow.day).padStart(2, '0')}`;

    // ── EOD return publication (Stage 1, rebalance-aware) ──────────────────────
    // Runs first, independently of the order-book email flow below. Publishes every
    // active strategy's complete-value return through the guarded RPC, chaining from
    // its own prior publication (rebalance-aware; YTD never resets). Safe by default:
    // writes only when RETURNS_PUBLISH_APPLY=1, otherwise read-only. Never fatal to
    // the order-book cron.
    let returnsPublish = null;
    try {
      returnsPublish = await publishEodReturns({ asOfDate: dateKey, apply: process.env.RETURNS_PUBLISH_APPLY === '1' });
      console.log('[returns-publish]', returnsPublish.apply ? 'APPLIED' : 'dry-run', JSON.stringify(returnsPublish.summary));
    } catch (e) {
      console.error('[returns-publish] failed (non-fatal):', e?.message || e);
    }

    // Client publication runs after strategies and has its own independent
    // apply switch. It values actual owner quantities plus strategy-scoped
    // residual/reserve cash, excludes accrued liabilities from gross TWR, and
    // refuses unexplained composition changes.
    let clientReturnsPublish = null;
    try {
      clientReturnsPublish = await publishClientEodReturns({
        asOfDate: dateKey,
        apply: process.env.CLIENT_RETURNS_PUBLISH_APPLY === '1',
        includeUat: process.env.CLIENT_RETURNS_INCLUDE_UAT === '1',
        includeTestUsers: process.env.CLIENT_RETURNS_INCLUDE_TEST === '1'
      });
      console.log('[client-returns-publish]', clientReturnsPublish.apply ? 'APPLIED' : 'dry-run', JSON.stringify(clientReturnsPublish.summary));
    } catch (e) {
      console.error('[client-returns-publish] failed (non-fatal):', e?.message || e);
    }

    const currentMinuteOfDay = (localNow.hour * 60) + localNow.minute;
    const targetMinuteOfDay = (targetHour * 60) + targetMinute;

    const existingRuns = await requestSupabaseJson(
      `/rest/v1/orderbook_email_runs?select=id,run_date,status,sent_at,last_attempt_at,sequence_number,title,date_label&run_date=eq.${dateKey}&limit=1`,
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

    if (existingRun?.status === 'sending') {
      const lastAttemptMs = existingRun?.last_attempt_at ? new Date(existingRun.last_attempt_at).getTime() : 0;
      const sendingCooldownMs = 60 * 60 * 1000;
      if (lastAttemptMs && (Date.now() - lastAttemptMs) < sendingCooldownMs) {
        return sendJson(res, 200, {
          ok: true,
          skipped: true,
          reason: 'Run is already in progress',
          runDate: dateKey,
          sentAt: existingRun.sent_at || null,
          now: localNow,
          target: { hour: targetHour, minute: targetMinute, timeZone }
        });
      }
    }

    if (currentMinuteOfDay < targetMinuteOfDay) {
      return sendJson(res, 200, {
        ok: true,
        skipped: true,
        reason: 'Before target send time',
        runDate: dateKey,
        now: localNow,
        target: { hour: targetHour, minute: targetMinute, timeZone },
        returnsPublish: returnsPublish || null,
        clientReturnsPublish: clientReturnsPublish || null
      });
    }

    const upsertPayload = {
      run_date: dateKey,
      status: 'pending',
      timezone: timeZone,
      target_hour: targetHour,
      target_minute: targetMinute,
      last_attempt_at: nowIso,
      error_message: null
    };

    // sql/orderbook_email_runs.sql later dropped the single-column unique on
    // run_date in favour of a composite unique(run_date, sequence_number) —
    // "allow multiple order books per day" — but this on_conflict target was
    // never updated to match, so every upsert here failed with "there is no
    // unique or exclusion constraint matching the ON CONFLICT specification"
    // once that migration ran (visible as the whole cron 500ing after the
    // return publishers had already run — a real, confirmed production bug).
    await requestSupabaseJson(
      '/rest/v1/orderbook_email_runs?on_conflict=run_date,sequence_number',
      {
        method: 'POST',
        body: upsertPayload,
        extraHeaders: {
          'Prefer': 'resolution=merge-duplicates,return=representation'
        }
      }
    );

    const claimRows = await requestSupabaseJson(
      `/rest/v1/orderbook_email_runs?run_date=eq.${dateKey}&status=in.(pending,failed,no_data)`,
      {
        method: 'PATCH',
        body: {
          status: 'sending',
          last_attempt_at: nowIso,
          error_message: null
        },
        extraHeaders: {
          'Prefer': 'return=representation'
        }
      }
    );
    const claimedRun = Array.isArray(claimRows) && claimRows.length ? claimRows[0] : null;

    if (!claimedRun) {
      const latestRuns = await requestSupabaseJson(
        `/rest/v1/orderbook_email_runs?select=status,sent_at,last_attempt_at&run_date=eq.${dateKey}&limit=1`,
        { method: 'GET' }
      );
      const latestRun = Array.isArray(latestRuns) && latestRuns.length ? latestRuns[0] : null;
      return sendJson(res, 200, {
        ok: true,
        skipped: true,
        reason: latestRun?.status === 'sent' ? 'Already sent for date' : 'Run is already in progress',
        runDate: dateKey,
        status: latestRun?.status || null,
        sentAt: latestRun?.sent_at || null,
        now: localNow,
        target: { hour: targetHour, minute: targetMinute, timeZone }
      });
    }

    const previousSentRuns = await requestSupabaseJson(
      `/rest/v1/orderbook_email_runs?select=sent_at,run_date,status&status=eq.sent&run_date=lt.${dateKey}&order=run_date.desc&limit=1`,
      { method: 'GET' }
    );
    const previousSentAt = Array.isArray(previousSentRuns) && previousSentRuns.length
      ? previousSentRuns[0]?.sent_at || null
      : null;

    const rows = await loadLiveOrderbookRows(previousSentAt);
    const dateLabel = `${String(localNow.year).padStart(4, '0')}-${String(localNow.month).padStart(2, '0')}-${String(localNow.day).padStart(2, '0')} ${String(localNow.hour).padStart(2, '0')}:${String(localNow.minute).padStart(2, '0')}`;

    let sequenceNumber = Number(claimedRun?.sequence_number || existingRun?.sequence_number || 0);
    if (!Number.isFinite(sequenceNumber) || sequenceNumber <= 0) {
      const latestSequenceRows = await requestSupabaseJson(
        '/rest/v1/orderbook_email_runs?select=sequence_number&sequence_number=not.is.null&order=sequence_number.desc&limit=1',
        { method: 'GET' }
      );
      const latestSequence = Array.isArray(latestSequenceRows) && latestSequenceRows.length
        ? Number(latestSequenceRows[0]?.sequence_number || 0)
        : 0;
      sequenceNumber = latestSequence + 1;
    }
    const snapshotTitle = claimedRun?.title || existingRun?.title || `Order Book ${sequenceNumber}`;
    const snapshotDateLabel = claimedRun?.date_label || existingRun?.date_label || dateLabel;

    if (!rows.length) {
      await requestSupabaseJson(
        `/rest/v1/orderbook_email_runs?run_date=eq.${dateKey}`,
        {
          method: 'PATCH',
          body: {
            status: 'no_data',
            row_count: 0,
            snapshot_rows: [],
            sent_at: null,
            error_message: null,
            last_attempt_at: nowIso
          }
        }
      );

      return sendJson(res, 200, {
        ok: true,
        skipped: true,
        reason: 'No new entries since last order book',
        runDate: dateKey,
        timeZone,
        target: { hour: targetHour, minute: targetMinute, timeZone }
      });
    }

    try {
      await sendOrderbookCsvEmail({
        subject: `Daily Order Book - ${dateLabel} (${timeZone})`,
        csvContent: toOrderbookCsvContent(rows),
        fileName: `daily-orderbook-${String(localNow.year).padStart(4, '0')}-${String(localNow.month).padStart(2, '0')}-${String(localNow.day).padStart(2, '0')}.csv`,
        idempotencyKey: `orderbook-daily-${dateKey}`
      });

      await requestSupabaseJson(
        `/rest/v1/orderbook_email_runs?run_date=eq.${dateKey}`,
        {
          method: 'PATCH',
          body: {
            status: 'sent',
            sent_at: new Date().toISOString(),
            row_count: rows.length,
            sequence_number: sequenceNumber,
            title: snapshotTitle,
            date_label: snapshotDateLabel,
            snapshot_rows: rows,
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
            sequence_number: sequenceNumber,
            title: snapshotTitle,
            date_label: snapshotDateLabel,
            snapshot_rows: rows,
            row_count: rows.length,
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
      sequence: sequenceNumber,
      title: snapshotTitle,
      rowCount: rows.length,
      at: dateLabel,
      runDate: dateKey,
      target: { hour: targetHour, minute: targetMinute, timeZone },
      timeZone
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Daily cron send failed',
      details: error?.message || 'Unknown error'
    });
  }
};
