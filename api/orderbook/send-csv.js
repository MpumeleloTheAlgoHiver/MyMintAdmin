const { sendJson, fetchSupabaseJson, requestSupabaseJson, buildInFilter, sendOrderbookCsvEmail, handleSendTradeConfirmation } = require('../_orderbook');
const { requirePermission } = require('../_team');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    return sendJson(res, 401, { error: 'Missing Authorization bearer token' });
  }

  try {
    const authUser = await fetchSupabaseJson('/auth/v1/user', token, false);

    const action = req.query?.action || new URL(req.url, `http://${req.headers.host}`).searchParams.get('action');
    if (action === 'trade-confirmation') {
      if (!(await requirePermission(req, res, 'orderbook', 'send_confirmation'))) return;
      return handleSendTradeConfirmation(req, res, token);
    }

    // ── Orderbook pins ────────────────────────────────────────────────────────
    // Pin an investor row (by pin_key = buildInvestorKey: userId|familyMemberId|
    // txn) so it floats to the top of that strategy's investor list. Non-
    // destructive — no password gate. Stored in orderbook_pins (service-role).
    if (action === 'list-pins') {
      const pins = await fetchSupabaseJson('/rest/v1/orderbook_pins?select=pin_key,user_id');
      return sendJson(res, 200, { pins: Array.isArray(pins) ? pins : [] });
    }
    if (action === 'pin-investor' || action === 'unpin-investor') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const pinKey = String(body.pinKey || '').trim();
      if (!pinKey) return sendJson(res, 400, { error: 'pinKey required' });
      if (action === 'unpin-investor') {
        await requestSupabaseJson(`/rest/v1/orderbook_pins?pin_key=eq.${encodeURIComponent(pinKey)}`, { method: 'DELETE' });
        return sendJson(res, 200, { ok: true, pinned: false });
      }
      await requestSupabaseJson('/rest/v1/orderbook_pins?on_conflict=pin_key', {
        method: 'POST',
        extraHeaders: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { pin_key: pinKey, user_id: String(body.userId || '') || null, pinned_by: authUser?.email || null, pinned_at: new Date().toISOString() }
      });
      return sendJson(res, 200, { ok: true, pinned: true });
    }

    // Fetch a user's transactions using service-role key (bypasses RLS).
    // Used by the reverse-investor modal to find the refund amount.
    if (action === 'get-user-transactions') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const userId = String(body.userId || '').trim();
      const familyMemberId = String(body.familyMemberId || '').trim();
      if (!userId) return sendJson(res, 400, { error: 'userId required' });

      const baseQs = () => {
        // Fetch both strategy ("Strategy Investment: X") and single-security
        // ("Purchased X") transactions — the name filter was Strategy Investment
        // only, which silently dropped direct stock buys. Client-side narrows
        // to the specific security/strategy after fetch.
        let qs = `user_id=eq.${encodeURIComponent(userId)}&select=id,amount,name,description,direction,status,transaction_date,created_at,family_member_id&order=transaction_date.desc&limit=400`;
        // Scope to the right account: family member's txns vs parent's own.
        if (familyMemberId) qs += `&family_member_id=eq.${encodeURIComponent(familyMemberId)}`;
        else qs += `&family_member_id=is.null`;
        if (body.dateFrom) qs += `&transaction_date=gte.${encodeURIComponent(body.dateFrom)}`;
        if (body.dateTo)   qs += `&transaction_date=lte.${encodeURIComponent(body.dateTo)}`;
        return qs;
      };

      let rows;
      try {
        rows = await fetchSupabaseJson(`/rest/v1/transactions?${baseQs()}&reversed=eq.false`);
      } catch (_) {
        rows = await fetchSupabaseJson(`/rest/v1/transactions?${baseQs()}`);
      }
      return sendJson(res, 200, { transactions: Array.isArray(rows) ? rows : [] });
    }

    // Reverse an investor's order: delete holdings, refund wallet, audit credit
    // txn, and flag source txn reversed=true. Done server-side to bypass RLS.
    if (action === 'reverse-investor') {
      if (!(await requirePermission(req, res, 'orderbook', 'refund_investor'))) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const userId = String(body.userId || '').trim();
      const familyMemberId = String(body.familyMemberId || '').trim();
      const context = body.context === 'security' ? 'security' : 'strategy';
      const strategyId = String(body.strategyId || '').trim();
      const sourceId = String(body.sourceId || '').trim();
      const selectedTxnId = String(body.selectedTxnId || '').trim();
      const targetName = String(body.targetName || 'Order');
      // Scope to a specific buy event by created_at window (the investors
      // panel passes the minute bucket ±5s of the original purchase).
      // Optional — falls back to whole-strategy when missing.
      const createdAtFrom = String(body.createdAtFrom || '').trim();
      const createdAtTo = String(body.createdAtTo || '').trim();

      if (!userId) return sendJson(res, 400, { error: 'userId required' });
      if (context === 'strategy' && !strategyId) return sendJson(res, 400, { error: 'strategyId required for strategy context' });
      if (context === 'security' && !sourceId) return sendJson(res, 400, { error: 'sourceId required for security context' });

      // 1. Holdings to delete — for strategy context, scope by user + strategy
      //    and optionally by created_at window so two separate buys of the
      //    same strategy by the same user don't get reversed together.
      let holdingsPath;
      if (context === 'strategy') {
        let qs = `user_id=eq.${encodeURIComponent(userId)}&strategy_id=eq.${encodeURIComponent(strategyId)}`;
        if (familyMemberId) {
          qs += `&family_member_id=eq.${encodeURIComponent(familyMemberId)}`;
        } else {
          qs += `&family_member_id=is.null`;
        }
        if (createdAtFrom) {
          const fromMs = new Date(createdAtFrom).getTime() - 5000;
          if (Number.isFinite(fromMs)) qs += `&created_at=gte.${encodeURIComponent(new Date(fromMs).toISOString())}`;
        }
        if (createdAtTo) {
          const toMs = new Date(createdAtTo).getTime() + 5000;
          if (Number.isFinite(toMs)) qs += `&created_at=lte.${encodeURIComponent(new Date(toMs).toISOString())}`;
        }
        holdingsPath = `/rest/v1/stock_holdings_c?${qs}&select=id`;
      } else {
        holdingsPath = `/rest/v1/stock_holdings_c?id=eq.${encodeURIComponent(sourceId)}&select=id`;
      }
      const holdingsRows = await fetchSupabaseJson(holdingsPath);
      const holdingIds = Array.isArray(holdingsRows) ? holdingsRows.map((r) => r.id).filter(Boolean) : [];

      // 2. Resolve refund from the selected transaction.
      let refundCents = 0;
      let selectedTxn = null;
      if (selectedTxnId) {
        const txns = await fetchSupabaseJson(
          `/rest/v1/transactions?id=eq.${encodeURIComponent(selectedTxnId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,amount,name,description`
        );
        selectedTxn = Array.isArray(txns) && txns[0] ? txns[0] : null;
        if (!selectedTxn) return sendJson(res, 400, { error: 'Selected transaction not found for this user' });
        refundCents = Math.round(Number(selectedTxn.amount || 0));
      }
      const refundRand = refundCents / 100;

      // 3. Read the right balance source: family_members.available_balance for
      //    a family-member account, wallets.balance for the parent themselves.
      let wallet = null;
      let familyMember = null;
      let balanceBefore = 0;
      if (familyMemberId) {
        const fmRows = await fetchSupabaseJson(
          `/rest/v1/family_members?id=eq.${encodeURIComponent(familyMemberId)}&select=id,available_balance`
        );
        familyMember = Array.isArray(fmRows) && fmRows[0] ? fmRows[0] : null;
        if (!familyMember) return sendJson(res, 400, { error: 'Family member not found' });
        // available_balance is in cents — work in Rands to stay consistent with wallets.
        balanceBefore = Number(familyMember.available_balance || 0) / 100;
      } else {
        const walletRows = await fetchSupabaseJson(
          `/rest/v1/wallets?user_id=eq.${encodeURIComponent(userId)}&select=id,balance`
        );
        wallet = Array.isArray(walletRows) && walletRows[0] ? walletRows[0] : null;
        balanceBefore = Number(wallet?.balance || 0);
      }
      const balanceAfter = balanceBefore + refundRand;
      const nowIso = new Date().toISOString();

      // 4. Delete holdings (service-role bypasses RLS) + verify.
      let deletedCount = 0;
      let leftoverIds = [];
      if (holdingIds.length) {
        const deleted = await requestSupabaseJson(
          `/rest/v1/stock_holdings_c?id=in.(${buildInFilter(holdingIds)})&select=id`,
          { method: 'DELETE', useServiceRoleAuth: true, extraHeaders: { Prefer: 'return=representation' } }
        );
        deletedCount = Array.isArray(deleted) ? deleted.length : 0;
        const stillThere = await fetchSupabaseJson(
          `/rest/v1/stock_holdings_c?id=in.(${buildInFilter(holdingIds)})&select=id`
        );
        leftoverIds = Array.isArray(stillThere) ? stillThere.map((r) => r.id) : [];
        if (!deletedCount) deletedCount = holdingIds.length - leftoverIds.length;
        if (leftoverIds.length) {
          return sendJson(res, 500, {
            error: 'Holdings delete did not remove all rows',
            details: `${leftoverIds.length} of ${holdingIds.length} stock_holdings_c row(s) still present after DELETE. Check FK constraints or triggers on stock_holdings_c.`,
            requestedHoldingIds: holdingIds,
            leftoverIds,
          });
        }
      }

      // 5. Apply refund to the right account.
      let walletUpdated = false;
      if (refundRand > 0) {
        if (familyMember) {
          const updated = await requestSupabaseJson(
            `/rest/v1/family_members?id=eq.${encodeURIComponent(familyMember.id)}&select=id,available_balance`,
            { method: 'PATCH', useServiceRoleAuth: true, body: { available_balance: Math.round(balanceAfter * 100), updated_at: nowIso }, extraHeaders: { Prefer: 'return=representation' } }
          );
          walletUpdated = Array.isArray(updated) && updated.length > 0;
        } else if (wallet) {
          const updated = await requestSupabaseJson(
            `/rest/v1/wallets?id=eq.${encodeURIComponent(wallet.id)}&select=id,balance`,
            { method: 'PATCH', useServiceRoleAuth: true, body: { balance: balanceAfter, updated_at: nowIso }, extraHeaders: { Prefer: 'return=representation' } }
          );
          walletUpdated = Array.isArray(updated) && updated.length > 0;
        } else {
          const created = await requestSupabaseJson(
            `/rest/v1/wallets?select=id,balance`,
            { method: 'POST', useServiceRoleAuth: true, body: { user_id: userId, balance: balanceAfter, currency: 'ZAR', updated_at: nowIso }, extraHeaders: { Prefer: 'return=representation' } }
          );
          walletUpdated = Array.isArray(created) && created.length > 0;
        }
      }

      // 6. Audit credit txn.
      let auditTxnId = null;
      if (refundCents > 0) {
        const auditDescription = `Order reversal for ${targetName}. ${holdingIds.length} holding(s) removed.`;
        const created = await requestSupabaseJson(
          `/rest/v1/transactions?select=id`,
          {
            method: 'POST',
            useServiceRoleAuth: true,
            body: {
              user_id: userId,
              family_member_id: familyMemberId || null,
              amount: refundCents,
              direction: 'credit',
              status: 'posted',
              name: `Reversal: ${targetName}`,
              description: auditDescription,
              currency: 'ZAR',
              transaction_date: nowIso,
            },
            extraHeaders: { Prefer: 'return=representation' }
          }
        );
        auditTxnId = Array.isArray(created) && created[0] ? created[0].id : null;
      }

      // 7. Flag source txn as reversed.
      let sourceTxnReversed = false;
      if (selectedTxn?.id) {
        const updated = await requestSupabaseJson(
          `/rest/v1/transactions?id=eq.${encodeURIComponent(selectedTxn.id)}&select=id`,
          { method: 'PATCH', useServiceRoleAuth: true, body: { reversed: true, updated_at: nowIso }, extraHeaders: { Prefer: 'return=representation' } }
        );
        sourceTxnReversed = Array.isArray(updated) && updated.length > 0;
      }

      return sendJson(res, 200, {
        ok: true,
        deletedCount,
        requestedHoldingIds: holdingIds,
        refund: refundRand,
        refundCents,
        walletUpdated,
        balanceBefore,
        balanceAfter: refundRand > 0 ? balanceAfter : balanceBefore,
        auditTxnId,
        selectedTxnId: selectedTxn?.id || null,
        sourceTxnReversed,
      });
    }

    // Fetch execution-reserve (8% buffer) ledger rows via service-role key
    // (bypasses RLS) so the orderbook's MINT PnL column can reliably show the
    // shortfall (slippage beyond the reserve) regardless of RLS on the table.
    if (action === 'get-buffer-drawdowns') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const holdingIds = Array.isArray(body.holdingIds)
        ? body.holdingIds.map((v) => String(v || '').trim()).filter(Boolean)
        : [];
      if (!holdingIds.length) return sendJson(res, 200, { drawdowns: [] });

      const chunkSize = 150;
      const all = [];
      for (let i = 0; i < holdingIds.length; i += chunkSize) {
        const chunk = holdingIds.slice(i, i + chunkSize);
        const rows = await fetchSupabaseJson(
          `/rest/v1/buffer_drawdowns_c?holding_id=in.(${buildInFilter(chunk)})&event_type=in.(slippage_drawdown,shortfall)&select=holding_id,event_type,delta_cents`
        );
        if (Array.isArray(rows)) all.push(...rows);
      }
      return sendJson(res, 200, { drawdowns: all });
    }

    // Reserve-first rebalance support. Preview reads each owner's unused 8%
    // transaction reserve; settlement consumes the actual Excel-fill fees via
    // an idempotent SQL function keyed by batch + owner.
    if (action === 'rebalance-load-reserves') {
      if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const strategyId = String(body.strategyId || '').trim();
      const userIds = Array.isArray(body.userIds)
        ? [...new Set(body.userIds.map((v) => String(v || '').trim()).filter(Boolean))]
        : [];
      if (!strategyId) return sendJson(res, 400, { error: 'strategyId required' });
      if (!userIds.length) return sendJson(res, 200, { reservesCentsByUser: {} });
      const familyMemberId = body.familyMemberId ? String(body.familyMemberId).trim() : null;
      const fmFilter = familyMemberId
        ? `&family_member_id=eq.${encodeURIComponent(familyMemberId)}`
        : '&family_member_id=is.null';
      const holdings = await fetchSupabaseJson(
        `/rest/v1/stock_holdings_c?strategy_id=eq.${encodeURIComponent(strategyId)}` +
        `&user_id=in.(${buildInFilter(userIds)})${fmFilter}&transaction_id=not.is.null` +
        '&select=user_id,transaction_id'
      );
      const transactionIds = [...new Set((holdings || []).map((h) => h.transaction_id).filter(Boolean))];
      const reservesCentsByUser = Object.fromEntries(userIds.map((uid) => [uid, 0]));
      if (!transactionIds.length) return sendJson(res, 200, { reservesCentsByUser });
      const txns = await fetchSupabaseJson(
        `/rest/v1/transactions?id=in.(${buildInFilter(transactionIds)})` +
        '&status=eq.posted&reversed=eq.false&select=id,buffer_cents,buffer_consumed_cents'
      );
      const availableByTxn = Object.fromEntries((txns || []).map((t) => [
        String(t.id),
        Math.max(0, Math.round(Number(t.buffer_cents || 0)) - Math.round(Number(t.buffer_consumed_cents || 0))),
      ]));
      const seen = new Set();
      (holdings || []).forEach((h) => {
        const key = `${h.user_id}|${h.transaction_id}`;
        if (seen.has(key)) return;
        seen.add(key);
        reservesCentsByUser[String(h.user_id)] = (reservesCentsByUser[String(h.user_id)] || 0)
          + (availableByTxn[String(h.transaction_id)] || 0);
      });
      return sendJson(res, 200, { reservesCentsByUser });
    }

    // Read-only lookup of already-applied strategy_rebalance_cash_events_c
    // rows for THIS batch. apply_strategy_rebalance_cash_event is idempotent
    // per (batch_id, strategy_id, user_id, family_member_id, event_type), so
    // once it has run for a user their charge is final and safe to retry —
    // but a balance-based preflight re-check afterwards would compare the
    // requirement against the ALREADY-DEBITED balance and wrongly block a
    // resumed settlement. Callers use this to skip re-checking users who are
    // already covered.
    if (action === 'rebalance-load-cash-events') {
      if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const batchId = String(body.batchId || '').trim();
      const strategyId = String(body.strategyId || '').trim();
      const eventType = String(body.eventType || '').trim();
      const userIds = Array.isArray(body.userIds)
        ? [...new Set(body.userIds.map((v) => String(v || '').trim()).filter(Boolean))]
        : [];
      if (!batchId || !strategyId || !eventType) {
        return sendJson(res, 400, { error: 'batchId, strategyId and eventType required' });
      }
      if (!userIds.length) return sendJson(res, 200, { appliedUserIds: [] });
      const familyMemberId = body.familyMemberId ? String(body.familyMemberId).trim() : null;
      const fmFilter = familyMemberId
        ? `&family_member_id=eq.${encodeURIComponent(familyMemberId)}`
        : '&family_member_id=is.null';
      const rows = await fetchSupabaseJson(
        `/rest/v1/strategy_rebalance_cash_events_c?batch_id=eq.${encodeURIComponent(batchId)}` +
        `&strategy_id=eq.${encodeURIComponent(strategyId)}&event_type=eq.${encodeURIComponent(eventType)}` +
        `&user_id=in.(${buildInFilter(userIds)})${fmFilter}&select=user_id`
      );
      const appliedUserIds = [...new Set((rows || []).map((r) => String(r.user_id)))];
      return sendJson(res, 200, { appliedUserIds });
    }

    if (action === 'rebalance-consume-reserves') {
      if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const batchId = String(body.batchId || '').trim();
      const strategyId = String(body.strategyId || '').trim();
      const familyMemberId = body.familyMemberId ? String(body.familyMemberId).trim() : null;
      const feesCentsByUser = body.feesCentsByUser && typeof body.feesCentsByUser === 'object'
        ? body.feesCentsByUser
        : {};
      if (!batchId || !strategyId) return sendJson(res, 400, { error: 'batchId and strategyId required' });
      const resultsByUser = {};
      for (const [userId, requested] of Object.entries(feesCentsByUser)) {
        if (!userId) continue;
        const result = await requestSupabaseJson('/rest/v1/rpc/apply_rebalance_reserve_charge', {
          method: 'POST',
          body: {
            p_batch_id: batchId,
            p_strategy_id: strategyId,
            p_user_id: userId,
            p_family_member_id: familyMemberId,
            p_requested_cents: Math.max(0, Math.round(Number(requested) || 0)),
            p_effective_at: body.effectiveAt || new Date().toISOString(),
            p_metadata: body.metadataByUser?.[userId] || {},
          },
        });
        resultsByUser[userId] = result;
      }
      return sendJson(res, 200, { ok: true, resultsByUser });
    }

    // Read strategy_rebalance_residuals with the service-role key. The table's
    // RLS only grants SELECT to the owning user, so a browser read returns {} for
    // every other client — this lets the admin see every holder's residual.
    if (action === 'rebalance-load-residuals') {
      if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const strategyId = String(body.strategyId || '').trim();
      if (!strategyId) return sendJson(res, 400, { error: 'strategyId required' });
      const userIds = Array.isArray(body.userIds)
        ? [...new Set(body.userIds.map((v) => String(v || '').trim()).filter(Boolean))]
        : [];
      if (!userIds.length) return sendJson(res, 200, { balances: {} });
      const familyMemberId = body.familyMemberId ? String(body.familyMemberId).trim() : null;
      const fmFilter = familyMemberId
        ? `&family_member_id=eq.${encodeURIComponent(familyMemberId)}`
        : `&family_member_id=is.null`;

      const rows = await fetchSupabaseJson(
        `/rest/v1/strategy_rebalance_residuals?select=user_id,balance_cents&strategy_id=eq.${encodeURIComponent(strategyId)}&user_id=in.(${buildInFilter(userIds)})${fmFilter}`
      );
      const balances = {};
      (rows || []).forEach((r) => {
        const uid = String(r.user_id || '');
        if (uid) balances[uid] = (Number(r.balance_cents) || 0) / 100;
      });
      return sendJson(res, 200, { balances });
    }

    // Upsert strategy_rebalance_residuals with the service-role key. The table has
    // no write RLS policy (writes are service-role only by design), so a browser
    // upsert fails with "new row violates row-level security policy".
    if (action === 'rebalance-upsert-residuals') {
      if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const strategyId = String(body.strategyId || '').trim();
      if (!strategyId) return sendJson(res, 400, { error: 'strategyId required' });
      const familyMemberId = body.familyMemberId ? String(body.familyMemberId).trim() : null;
      const fmFilter = familyMemberId
        ? `&family_member_id=eq.${encodeURIComponent(familyMemberId)}`
        : `&family_member_id=is.null`;
      // New callers should send integer cents explicitly. balancesByUser is
      // retained for older dashboard/reversal callers whose values are rands.
      const hasDeltasCents = body.residualDeltasCentsByUser && typeof body.residualDeltasCentsByUser === 'object';
      const hasExplicitCents = !hasDeltasCents && body.balancesCentsByUser && typeof body.balancesCentsByUser === 'object';
      const balancesByUser = hasDeltasCents
        ? body.residualDeltasCentsByUser
        : hasExplicitCents
        ? body.balancesCentsByUser
        : (body.balancesByUser && typeof body.balancesByUser === 'object' ? body.balancesByUser : {});
      const entries = Object.entries(balancesByUser).filter(([uid]) => uid);
      if (!entries.length) return sendJson(res, 200, { ok: true, upserted: 0 });

      const nowIso = new Date().toISOString();
      const batchId = String(body.batchId || '').trim() || null;
      const eventType = String(body.eventType || '').trim() || null;
      const effectiveAt = String(body.effectiveAt || '').trim() || nowIso;
      const metadataByUser = body.metadataByUser && typeof body.metadataByUser === 'object'
        ? body.metadataByUser
        : {};
      let upserted = 0;
      // Manual read-then-update-or-insert per user — PostgREST on_conflict can't
      // target the COALESCE(family_member_id, sentinel) unique index.
      for (const [userId, balance] of entries) {
        const requestedCents = (hasExplicitCents || hasDeltasCents)
          ? Math.round(Number(balance) || 0)
          : Math.round((Number(balance) || 0) * 100);
        const scope = `user_id=eq.${encodeURIComponent(userId)}&strategy_id=eq.${encodeURIComponent(strategyId)}${fmFilter}`;
        if (hasDeltasCents && batchId && eventType) {
          await requestSupabaseJson('/rest/v1/rpc/apply_strategy_rebalance_cash_event', {
            method: 'POST',
            body: {
              p_batch_id: batchId,
              p_strategy_id: strategyId,
              p_user_id: userId,
              p_family_member_id: familyMemberId || null,
              p_event_type: eventType,
              p_amount_cents: requestedCents,
              p_effective_at: effectiveAt,
              p_metadata: metadataByUser[userId] && typeof metadataByUser[userId] === 'object'
                ? metadataByUser[userId]
                : {},
            },
          });
          upserted += 1;
          continue;
        }
        let balanceCents = requestedCents;
        if (hasDeltasCents) {
          const existing = await requestSupabaseJson(
            `/rest/v1/strategy_rebalance_residuals?${scope}&select=balance_cents&limit=1`
          );
          const openingBalanceCents = Math.round(Number(existing?.[0]?.balance_cents || 0));
          balanceCents = openingBalanceCents + requestedCents;
        }
        const updated = await requestSupabaseJson(
          `/rest/v1/strategy_rebalance_residuals?${scope}&select=user_id`,
          { method: 'PATCH', body: { balance_cents: balanceCents, updated_at: nowIso }, extraHeaders: { Prefer: 'return=representation' } }
        );
        if (!Array.isArray(updated) || !updated.length) {
          await requestSupabaseJson('/rest/v1/strategy_rebalance_residuals', {
            method: 'POST',
            body: { user_id: userId, strategy_id: strategyId, family_member_id: familyMemberId || null, balance_cents: balanceCents, updated_at: nowIso },
          });
        }
        upserted += 1;
      }
      return sendJson(res, 200, { ok: true, upserted });
    }

    // Strategy composition changes are admin writes. Keep them behind the same
    // permission gate as the rebalance commit instead of relying on browser RLS.
    if (action === 'rebalance-update-strategy-holdings') {
      if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const strategyId = String(body.strategyId || '').trim();
      if (!strategyId) return sendJson(res, 400, { error: 'strategyId required' });
      if (body.holdings !== null && !Array.isArray(body.holdings)) {
        return sendJson(res, 400, { error: 'holdings must be an array or null' });
      }
      const minInvestment = Number(body.minInvestment);
      if (!Number.isFinite(minInvestment) || minInvestment < 0) {
        return sendJson(res, 400, { error: 'minInvestment must be a non-negative number' });
      }

      const updated = await requestSupabaseJson(
        `/rest/v1/strategies_c?id=eq.${encodeURIComponent(strategyId)}&select=id`,
        {
          method: 'PATCH',
          body: { holdings: body.holdings, min_investment: minInvestment },
          extraHeaders: { Prefer: 'return=representation' },
        }
      );
      if (!Array.isArray(updated) || !updated.length) {
        return sendJson(res, 404, { error: 'Strategy not found' });
      }
      return sendJson(res, 200, { ok: true, strategyId });
    }

    // Publish the post-settlement composition as a zero-return chain boundary.
    // Actual Excel fills price changed instruments; guarded intraday prices
    // value unchanged instruments. The SQL RPC atomically preserves YTD and
    // turns value no longer represented by securities into continuity cash.
    if (action === 'rebalance-finalize-return-boundary') {
      if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const batchId = String(body.batchId || '').trim();
      const holdings = Array.isArray(body.holdingsSnapshot) ? body.holdingsSnapshot : null;
      const fillBySecId = body.fillBySecId && typeof body.fillBySecId === 'object' ? body.fillBySecId : {};
      if (!batchId || !holdings) return sendJson(res, 400, { error: 'batchId and holdingsSnapshot required' });
      if (!authUser?.id) return sendJson(res, 401, { error: 'Authenticated actor is required' });

      const symbols = [...new Set(holdings.map((h) => String(h?.symbol || h?.ticker || '').trim().toUpperCase()).filter(Boolean))];
      const querySymbols = [...new Set([...symbols, ...symbols.map((s) => s.endsWith('.JO') ? s.slice(0, -3) : `${s}.JO`)])];
      const securityRows = querySymbols.length ? await fetchSupabaseJson(
        `/rest/v1/securities_c?symbol=in.(${buildInFilter(querySymbols)})&select=id,symbol,last_price`
      ) : [];
      // stock_intraday_c accumulates ticks continuously — an unbounded
      // order-by-timestamp scan across the whole table's history for these
      // symbols was timing out (the query only needs the LATEST row per
      // symbol, but with no time filter Postgres has to sort far more rows
      // than necessary). Bounded to the last 2 days, well inside the 24h
      // freshness check below, so it can't silently miss a legitimately
      // fresh price while staying fast regardless of total table size.
      const intradaySinceIso = new Date(Date.now() - 2 * 86400000).toISOString();
      const intradayRows = querySymbols.length ? await fetchSupabaseJson(
        `/rest/v1/stock_intraday_c?symbol=in.(${buildInFilter(querySymbols)})&timestamp=gte.${encodeURIComponent(intradaySinceIso)}&select=symbol,current_price,timestamp&order=timestamp.desc&limit=2000`
      ) : [];
      const norm = (value) => String(value || '').trim().toUpperCase().replace(/\.JO$/, '');
      const securityBySymbol = new Map();
      (securityRows || []).forEach((row) => { if (!securityBySymbol.has(norm(row.symbol))) securityBySymbol.set(norm(row.symbol), row); });
      const liveBySymbol = new Map();
      (intradayRows || []).forEach((row) => {
        const key = norm(row.symbol);
        if (!liveBySymbol.has(key) && Number(row.current_price) > 0) liveBySymbol.set(key, row);
      });

      let securitiesValueCents = 0;
      let oldestObservedMs = Date.now();
      const valuation = [];
      for (const holding of holdings) {
        const symbol = String(holding?.symbol || holding?.ticker || '').trim().toUpperCase();
        const shares = Number(holding?.shares ?? holding?.quantity);
        const security = securityBySymbol.get(norm(symbol));
        const live = liveBySymbol.get(norm(symbol));
        const actualFill = security?.id ? Number(fillBySecId[security.id]) : 0;
        const reference = Number(live?.current_price || security?.last_price || 0);
        if (!symbol || !Number.isFinite(shares) || shares <= 0 || !(actualFill > 0 || reference > 0)) {
          return sendJson(res, 409, { error: `Boundary valuation incomplete for ${symbol || 'unknown holding'}` });
        }
        if (actualFill > 0 && reference > 0) {
          const ratio = actualFill / reference;
          if (ratio < 0.2 || ratio > 5) return sendJson(res, 409, { error: `Possible cents/rands error for ${symbol}: actual fill differs ${ratio.toFixed(2)}x from live price` });
        }
        const priceCents = Math.round(actualFill > 0 ? actualFill : reference);
        securitiesValueCents += Math.round(shares * priceCents);
        const observedMs = actualFill > 0 ? Date.now() : new Date(live?.timestamp || 0).getTime();
        if (!Number.isFinite(observedMs) || observedMs <= 0) return sendJson(res, 409, { error: `No timestamped guarded price for ${symbol}` });
        oldestObservedMs = Math.min(oldestObservedMs, observedMs);
        valuation.push({ symbol, shares, price_cents: priceCents, source: actualFill > 0 ? 'ACTUAL_EXCEL_FILL' : 'GUARDED_INTRADAY' });
      }

      const effectiveAt = body.effectiveAt || new Date().toISOString();
      const effectiveMs = new Date(effectiveAt).getTime();
      if (holdings.length && oldestObservedMs < effectiveMs - 86400000) {
        return sendJson(res, 409, { error: 'Boundary valuation blocked: at least one unchanged holding price is older than 24 hours' });
      }

      const result = await requestSupabaseJson('/rest/v1/rpc/finalize_rebalance_return_boundary', {
        method: 'POST',
        body: {
          p_batch_id: batchId,
          p_securities_value_cents: securitiesValueCents,
          p_holdings_snapshot: holdings,
          p_effective_at: effectiveAt,
          p_price_observed_at: new Date(oldestObservedMs).toISOString(),
          p_actor: authUser.id,
        },
      });
      return sendJson(res, 200, { ok: true, boundary: result, valuation });
    }

    // Rebalance settlement creates immutable holding/audit rows and an activity
    // transaction. Browser INSERT policies intentionally deny these writes, so
    // perform only these tightly-whitelisted inserts behind the existing Master
    // rebalance permission. Updates/claims remain scoped in the settlement UI.
    if (action === 'rebalance-settlement-claim') {
      if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const batchId = String(body.batchId || '').trim();
      const priorState = String(body.priorState || 'PENDING').trim().toUpperCase();
      if (!batchId) return sendJson(res, 400, { error: 'batchId required' });
      if (!['PENDING', 'PAUSED'].includes(priorState)) {
        return sendJson(res, 400, { error: 'priorState must be PENDING or PAUSED' });
      }
      const now = new Date().toISOString();
      const claimed = await requestSupabaseJson(
        `/rest/v1/rebalance_batch?id=eq.${encodeURIComponent(batchId)}&status=eq.PENDING&settlement_state=eq.${priorState}&select=id,settlement_state`,
        {
          method: 'PATCH',
          body: { settlement_state: 'PROCESSING', settlement_started_at: now, settlement_error: null, updated_at: now },
          extraHeaders: { Prefer: 'return=representation' },
        }
      );
      if (!Array.isArray(claimed) || !claimed.length) {
        return sendJson(res, 409, { error: 'Batch is already settling, settled, reversed, or was claimed by another session.' });
      }
      return sendJson(res, 200, { ok: true, batchId, settlementState: 'PROCESSING' });
    }

    if (action === 'rebalance-settlement-pause') {
      if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const batchId = String(body.batchId || '').trim();
      const error = String(body.error || 'Settlement paused').slice(0, 4000);
      if (!batchId) return sendJson(res, 400, { error: 'batchId required' });
      const paused = await requestSupabaseJson(
        `/rest/v1/rebalance_batch?id=eq.${encodeURIComponent(batchId)}&status=eq.PENDING&settlement_state=eq.PROCESSING&select=id`,
        {
          method: 'PATCH',
          body: { settlement_state: 'PAUSED', settlement_error: error, updated_at: new Date().toISOString() },
          extraHeaders: { Prefer: 'return=representation' },
        }
      );
      return sendJson(res, 200, { ok: true, paused: Array.isArray(paused) && paused.length > 0 });
    }

    if (action === 'rebalance-settlement-insert') {
      if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const table = String(body.table || '');
      const allowedTables = new Set(['stock_holdings_c', 'transactions']);
      if (!allowedTables.has(table)) return sendJson(res, 400, { error: 'Settlement table is not allowed' });
      const rows = Array.isArray(body.rows) ? body.rows : [body.rows];
      if (!rows.length || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
        return sendJson(res, 400, { error: 'rows must contain one or more objects' });
      }
      const inserted = await requestSupabaseJson(`/rest/v1/${table}?select=id`, {
        method: 'POST',
        body: Array.isArray(body.rows) ? rows : rows[0],
        extraHeaders: { Prefer: 'return=representation' },
      });
      return sendJson(res, 200, { ok: true, rows: Array.isArray(inserted) ? inserted : [] });
    }

    if (action === 'rebalance-settlement-update-holding') {
      if (!(await requirePermission(req, res, 'dashboard', 'commit_rebalance'))) return;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const holdingId = String(body.holdingId || '').trim();
      if (!holdingId) return sendJson(res, 400, { error: 'holdingId required' });
      const allowedFields = new Set([
        'is_active', 'closed_reason', 'closed_at', 'updated_at', 'avg_exit',
        'Exit_date', 'quantity', 'Status',
      ]);
      const requestedPatch = body.patch && typeof body.patch === 'object' ? body.patch : {};
      const patch = Object.fromEntries(Object.entries(requestedPatch).filter(([key]) => allowedFields.has(key)));
      if (!Object.keys(patch).length) return sendJson(res, 400, { error: 'No allowed holding fields supplied' });
      const updated = await requestSupabaseJson(
        `/rest/v1/stock_holdings_c?id=eq.${encodeURIComponent(holdingId)}&select=id`,
        { method: 'PATCH', body: patch, extraHeaders: { Prefer: 'return=representation' } }
      );
      if (!Array.isArray(updated) || !updated.length) return sendJson(res, 404, { error: 'Holding not found' });
      return sendJson(res, 200, { ok: true, holdingId });
    }

    // Fetch confirmation statuses using service-role key (bypasses RLS)
    if (action === 'get-confirmation-statuses') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const { holdingIds, batchIds } = body;
      const statuses = {};
      const chunkSize = 200;

      // 1. Check individual holding IDs
      if (holdingIds && holdingIds.length) {
        for (let i = 0; i < holdingIds.length; i += chunkSize) {
          const chunk = holdingIds.slice(i, i + chunkSize);
          const inFilter = chunk.map(id => `"${id}"`).join(',');
          const rows = await fetchSupabaseJson(
            `/rest/v1/investor_trade_confirmations?holding_id=in.(${inFilter})&select=holding_id,status`
          );
          if (Array.isArray(rows)) {
            rows.forEach(r => {
              if (!statuses[r.holding_id] || r.status === 'sent') statuses[r.holding_id] = r.status;
            });
          }
        }
      }

      // 2. Check Rebalance Batch IDs
      if (batchIds && batchIds.length) {
        for (let i = 0; i < batchIds.length; i += chunkSize) {
          const chunk = batchIds.slice(i, i + chunkSize);
          const inFilter = chunk.map(id => `"${id}"`).join(',');
          const rows = await fetchSupabaseJson(
            `/rest/v1/investor_trade_confirmations?rebalance_batch_id=in.(${inFilter})&select=rebalance_batch_id,status`
          );
          if (Array.isArray(rows)) {
            rows.forEach(r => {
              if (!statuses[r.rebalance_batch_id] || r.status === 'sent') statuses[r.rebalance_batch_id] = r.status;
            });
          }
        }
      }

      return sendJson(res, 200, { statuses });
    }

    // List every book that has been moved to "Closed Books" (shared across all
    // admins). Read with the service-role key so each admin sees the same closed
    // set regardless of who clicked "Move to Closed Book". A book maps 1:1 to an
    // orderbook_email_runs row; book id = `<run_date>-<sequence_number>`.
    if (action === 'closed-books-list') {
      const rows = await fetchSupabaseJson(
        '/rest/v1/orderbook_email_runs?select=run_date,sequence_number,closed_at&closed_at=not.is.null&order=closed_at.desc'
      );
      const items = (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.run_date != null && r.closed_at)
        .map((r) => ({
          book_id: `${r.run_date}-${Number(r.sequence_number) || 1}`,
          closed_at: r.closed_at
        }));
      return sendJson(res, 200, { items });
    }

    // Mark / unmark a book as closed for everyone. closed=true stamps closed_at,
    // closed=false clears it (reopen). Writes go through the service-role key so
    // any admin's action is visible to all (the table is RLS write-protected).
    if (action === 'closed-books-set') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const bookId = String(body.bookId || '').trim();
      if (!bookId) return sendJson(res, 400, { error: 'bookId required' });

      // book id = `<run_date>-<sequence_number>`; run_date itself contains dashes
      // (YYYY-MM-DD) so split on the trailing integer sequence.
      const match = bookId.match(/^(.*)-(\d+)$/);
      if (!match) return sendJson(res, 400, { error: 'Invalid bookId' });
      const runDate = match[1];
      const sequence = Number(match[2]) || 1;
      const scope = `run_date=eq.${encodeURIComponent(runDate)}&sequence_number=eq.${encodeURIComponent(sequence)}`;

      const closed = body.closed !== false; // default true
      let closedAt = null;
      if (closed) {
        const t = String(body.closedAt || '').trim();
        const d = t ? new Date(t) : new Date();
        closedAt = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
      }

      const updated = await requestSupabaseJson(
        `/rest/v1/orderbook_email_runs?${scope}&select=run_date,sequence_number`,
        { method: 'PATCH', body: { closed_at: closedAt }, extraHeaders: { Prefer: 'return=representation' } }
      );
      const affected = Array.isArray(updated) ? updated.length : 0;
      return sendJson(res, 200, { ok: true, closed, bookId, closedAt, affected });
    }

    if (!(await requirePermission(req, res, 'orderbook', 'export'))) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    await sendOrderbookCsvEmail({
      subject: body.subject,
      csvContent: body.csvContent,
      fileName: body.fileName
    });

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Could not process orderbook email request',
      details: error?.message || 'Unknown error'
    });
  }
};
