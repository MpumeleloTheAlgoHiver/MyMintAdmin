const {
  sendJson,
  requestSupabaseJson,
  toOrderbookCsvContent,
  sendOrderbookCsvEmail,
  loadLiveOrderbookRows
} = require('../_orderbook');
// _returns-publish and _client-returns-publish are intentionally no longer
// wired in here — both moved to the OEM (see the notes at their former call
// sites below).

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

    // ── EOD strategy return publication — MOVED TO THE OEM ────────────────────
    // Now owned by Wealth Navigator: `/api/cron/returns-publish`
    // (src/lib/returns/publish-eod-returns.ts), scheduled 17:00 on weekdays.
    // Two publishers must never both write `strategy_return_publication_audit_c`
    // for the same (strategy, as_of_date): they disagree on
    // `composition_effective_from` and manufacture spurious boundary bridges —
    // see the 5–7 Aug 2026 rows for what that looks like. So this call is
    // removed rather than left behind an env flag that could be switched back
    // on by accident.
    //
    // The OEM port was verified byte-identical to this implementation before
    // cutover: 8/8 active strategies agreed to the cent on securities,
    // continuity cash and complete value, and to 1e-9 on YTD (2026-08-10).
    //
    // The OEM also seals the rebalance return boundary at settlement
    // (src/lib/returns/seal-rebalance-boundary.ts), which this project never
    // did from its own rebalance flow.
    const returnsPublish = { skipped: 'moved-to-oem' };

    // ── Per-client EOD return publication — MOVED TO THE OEM ──────────────────
    // Now owned by Wealth Navigator: `/api/cron/client-returns-publish`
    // (src/lib/returns/publish-client-eod-returns.ts), scheduled 17:20 UTC on
    // weekdays. Same reasoning as the strategy-level handoff above: two
    // publishers must never both write `client_strategy_return_publication_audit_c`
    // for the same (owner, as_of_date) — they'd disagree on
    // composition_effective_from and fork that client's return chain. Removed
    // rather than left behind an env flag that could be switched back on by
    // accident (that's exactly what happened to the strategy-level flag before
    // its own cutover — see the 5-7 Aug 2026 rows).
    //
    // Last write from this implementation before cutover: 2026-08-21 (the
    // weekend of 22-23 Aug had no trading, so its own EOD carry-forward is
    // expected, not a gap).
    const clientReturnsPublish = { skipped: 'moved-to-oem' };

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
