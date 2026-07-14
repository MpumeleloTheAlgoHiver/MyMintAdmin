const {
  sendJson, fetchSupabaseJson, requestSupabaseJson, buildInFilter,
  loadSecuritiesByIds, buildTradeRow, buildEmailHtml, sendTransactionalEmail
} = require('../_orderbook');
const { requirePermission, isMasterOrDev } = require('../_team');

/**
 * Emails the client once their sell has fully settled — same branded
 * trade-confirmation shell as the buy-fill email, reused via _orderbook.js.
 * Never throws; a failed/unconfigured email must not block settlement.
 */
async function sendSellSettledEmail({ userId, reference, lines, breakdown = null }) {
  try {
    const [profileRows, securities] = await Promise.all([
      fetchSupabaseJson(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=first_name,email`),
      loadSecuritiesByIds([...new Set(lines.map((l) => l.securityId).filter(Boolean))]),
    ]);
    const profile = profileRows && profileRows[0];
    if (!profile?.email) return;

    const securityById = {};
    (securities || []).forEach((s) => { securityById[s.id] = s; });

    const fmtR = (cents) => `R ${(cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    let proceedsCents = 0;
    const tableRowsHtml = lines.map((line) => {
      proceedsCents += line.amountCents;
      const sec = securityById[line.securityId] || {};
      const quantityDisplay = Number(line.quantity).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
      return buildTradeRow({
        side: 'SELL',
        assetName: sec.name || sec.symbol || 'Asset',
        quantityDisplay,
        totalAmountStr: fmtR(line.amountCents),
        ref: reference,
      });
    }).join('');

    // Full itemisation so every cent reconciles: proceeds − broker − custody
    // + returned 8% reserve + returned rebalance residual = credited.
    const bd = breakdown || { proceedsCents, brokerCents: 0, custodyCents: 0, reserveCents: 0, residualCents: 0, netCents: proceedsCents };
    const totalCents = bd.netCents;
    const row = (label, cents, colour, sign) =>
      `<tr><td style="padding:12px 20px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#475569;">${label}</td><td style="padding:12px 20px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:${colour};text-align:right;">${sign}${fmtR(cents)}</td></tr>`;
    const breakdownHtml = `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:4px;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        ${row('Sale proceeds', bd.proceedsCents, '#0f172a', '')}
        ${bd.brokerCents > 0 ? row('Broker fee', bd.brokerCents, '#b42318', '− ') : ''}
        ${bd.reserveCents > 0 ? row('Execution reserve returned (8%)', bd.reserveCents, '#059669', '+ ') : ''}
        ${bd.custodyCents > 0 ? row('Custody fee (from reserve)', bd.custodyCents, '#b42318', '− ') : ''}
        ${bd.residualCents > 0 ? row('Rebalance residual returned', bd.residualCents, '#059669', '+ ') : ''}
        <tr><td style="padding:12px 20px;font-size:12px;font-weight:700;color:#0f172a;">Credited to your wallet</td><td style="padding:12px 20px;font-size:15px;font-weight:800;color:#0f172a;text-align:right;">${fmtR(totalCents)}</td></tr>
      </table>`;
    const refund = bd.reserveCents;

    const html = buildEmailHtml({
      firstName: profile.first_name || 'Investor',
      mintRef: reference,
      orderDate: new Date().toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' }),
      tableRowsHtml: tableRowsHtml + breakdownHtml,
      subjectHeading: 'Holdings Sold.',
      subjectIntro: `You've successfully sold your holdings. We've credited ${fmtR(totalCents)} to your MINT wallet${refund > 0 ? ' (including your unused execution reserve)' : ''}. Here's the breakdown:`,
    });

    await sendTransactionalEmail({ to: profile.email, subject: 'Holdings Sold — MINT', html });
  } catch (err) {
    console.error('[settle-sell] confirmation email failed:', err?.message || err);
  }
}

/**
 * Reconcile the execution-reserve (8% buffer) ledger after a BUY fill price is set.
 *
 * When an admin stamps the actual fill price (avg_fill, cents) on a holding, the
 * difference against the price the client was quoted at buy time (Expected_fill,
 * rands) is real slippage. That slippage is absorbed by the 8% buffer that was
 * pre-funded on the parent transaction. This writes that movement into
 * buffer_drawdowns_c and keeps transactions.buffer_consumed_cents in sync.
 *
 * Key facts this relies on:
 *  - A strategy buy is ONE transaction (one buffer_cents pool) with MANY holdings
 *    (one per security), all sharing transaction_id. So the buffer is a shared
 *    pool drawn across every holding of that transaction.
 *  - Expected_fill is per-share RANDS; avg_fill is per-share CENTS.
 *
 * Idempotent by design: each run deletes the transaction's prior fill-type rows
 * (slippage_drawdown / shortfall) and recomputes from the CURRENT state of all
 * its holdings, so re-filling, correcting a price, or batch updates never
 * double-count. Holdings not yet filled contribute zero.
 *
 * Never throws — a ledger problem must not block the admin's price update.
 */
async function reconcileBufferDrawdowns(holdingIds) {
  try {
    if (!holdingIds || !holdingIds.length) return;

    // 1. Resolve which transactions are touched (BUY side only — SELL refunds
    //    are a separate settlement-time flow).
    const affected = await fetchSupabaseJson(
      `/rest/v1/stock_holdings_c?id=in.(${buildInFilter(holdingIds)})&select=id,transaction_id,trade_side`
    );
    const isBuy = (h) => String(h.trade_side || '').toUpperCase() !== 'SELL';
    const txIds = [...new Set((affected || [])
      .filter((h) => isBuy(h) && h.transaction_id)
      .map((h) => h.transaction_id))];
    if (!txIds.length) return;

    for (const txId of txIds) {
      try {
        // 2. Pull the transaction's buffer pool.
        const txRows = await fetchSupabaseJson(
          `/rest/v1/transactions?id=eq.${encodeURIComponent(txId)}&select=id,user_id,family_member_id,buffer_cents,buffer_consumed_cents`
        );
        const tx = txRows && txRows[0];
        if (!tx) continue;
        const bufferPool = Math.max(0, Math.round(Number(tx.buffer_cents) || 0));

        // 3. Pull ALL BUY holdings on this transaction (not just the batch we
        //    just updated) so the recompute reflects the full picture.
        const holdings = await fetchSupabaseJson(
          `/rest/v1/stock_holdings_c?transaction_id=eq.${encodeURIComponent(txId)}&select=id,quantity,avg_fill,user_id,family_member_id,trade_side,%22Expected_fill%22`
        );
        const buys = (holdings || []).filter(isBuy);

        // 4. Clear prior fill-type ledger rows for this transaction.
        await requestSupabaseJson(
          `/rest/v1/buffer_drawdowns_c?transaction_id=eq.${encodeURIComponent(txId)}&event_type=in.(slippage_drawdown,shortfall)`,
          { method: 'DELETE' }
        );

        // 5. Recompute slippage per holding, drawing from the shared pool.
        let remaining = bufferPool;
        let totalConsumed = 0;
        const rows = [];
        for (const h of buys) {
          const qty = Math.abs(Number(h.quantity) || 0);
          const expectedRand = Number(h.Expected_fill);
          const actualCents = Number(h.avg_fill);
          if (!qty) continue;
          if (!Number.isFinite(expectedRand) || expectedRand <= 0) continue;
          if (!Number.isFinite(actualCents) || actualCents <= 0) continue;

          const expectedCents = Math.round(expectedRand * 100);
          const slipPerShare = actualCents - expectedCents;
          if (slipPerShare <= 0) continue; // filled at/below quote → buffer untouched

          const need = slipPerShare * qty;
          const drawn = Math.min(need, remaining);
          const base = {
            transaction_id: txId,
            holding_id: h.id,
            user_id: tx.user_id || h.user_id,
            family_member_id: h.family_member_id || tx.family_member_id || null,
            expected_fill_cents: expectedCents,
            actual_fill_cents: actualCents,
            quantity: qty,
          };
          if (drawn > 0) {
            rows.push({ ...base, event_type: 'slippage_drawdown', delta_cents: drawn,
              notes: 'Fill price above quote — absorbed by execution reserve' });
            remaining -= drawn;
            totalConsumed += drawn;
          }
          const short = need - drawn;
          if (short > 0) {
            rows.push({ ...base, event_type: 'shortfall', delta_cents: short,
              notes: 'Slippage exceeded execution reserve' });
          }
        }

        // 6. Insert fresh ledger rows + sync the transaction's consumed total.
        if (rows.length) {
          await requestSupabaseJson('/rest/v1/buffer_drawdowns_c', { method: 'POST', body: rows });
        }
        if (Math.round(Number(tx.buffer_consumed_cents) || 0) !== totalConsumed) {
          await requestSupabaseJson(
            `/rest/v1/transactions?id=eq.${encodeURIComponent(txId)}`,
            { method: 'PATCH', body: { buffer_consumed_cents: totalConsumed } }
          );
        }
      } catch (txErr) {
        console.error(`[buffer-drawdowns] reconcile failed for tx ${txId}:`, txErr?.message || txErr);
      }
    }
  } catch (err) {
    console.error('[buffer-drawdowns] reconcile failed:', err?.message || err);
  }
}

/**
 * Settle SELL fills: once an exit price (avg_exit, cents) is stamped on a
 * client-requested sell, realise it — close the holding, credit the client's
 * wallet, and mark the pending "Sell:" txn completed.
 *
 * Credit basis mirrors buys: the client is paid at the price THEY SAW when they
 * tapped Sell (expected_exit, per-share cents), NOT the broker's avg_exit. MINT
 * keeps the spread when the broker sold higher (and absorbs it when lower) — the
 * exact symmetric counterpart of the buy "higher-of" model. Falls back to
 * avg_exit for legacy sells captured before expected_exit existed.
 *
 * Units: expected_exit/avg_exit are CENTS; wallets.balance is RANDS;
 * family_members.available_balance and transactions.amount are CENTS.
 *
 * Idempotent: only settles holdings still is_active=true, then flips them to
 * is_active=false — a re-fill/price correction never double-credits.
 * Never throws — a settlement hiccup must not fail the admin's price update.
 */
// ── Sell fees ────────────────────────────────────────────────────────────────
// A withdrawal is charged: BROKER fee (% of proceeds) + CUSTODY fee (per asset,
// the CRM-set isinFeePerAsset). NO transaction fee, NO AUM fee. The custody fee
// is charged AGAINST the returned 8% execution reserve (so the reserve returned
// is reduced by it). Any rebalance residual is also returned. Rates come from
// app_settings('fees') — nothing is hardcoded.
const _num = (v, d) => (v == null || v === '' || isNaN(Number(v)) ? d : Number(v));

async function getSellFeeConfig() {
  const defaults = { BROKER_FEE_RATE: 0.0025, CUSTODY_FEE_PER_ASSET: 25 };
  try {
    const rows = await fetchSupabaseJson('/rest/v1/app_settings?key=eq.fees&select=value&limit=1');
    const v = rows && rows[0] && rows[0].value;
    if (!v) return defaults;
    return {
      BROKER_FEE_RATE:       _num(v.brokerFeeRate,   defaults.BROKER_FEE_RATE),
      CUSTODY_FEE_PER_ASSET: _num(v.isinFeePerAsset, defaults.CUSTODY_FEE_PER_ASSET),
    };
  } catch { return defaults; }
}

async function settleSellFills(holdingIds) {
  try {
    if (!holdingIds || !holdingIds.length) return;
    const holdings = await fetchSupabaseJson(
      `/rest/v1/stock_holdings_c?id=in.(${buildInFilter(holdingIds)})&select=id,user_id,family_member_id,security_id,strategy_id,quantity,avg_exit,expected_exit,trade_side,is_active,sell_transaction_id,transaction_id`
    );
    const toSettle = (holdings || []).filter((h) =>
      String(h.trade_side || '').toUpperCase() === 'SELL' &&
      h.is_active !== false &&
      Number(h.avg_exit) > 0 &&
      Number(h.quantity) > 0
    );
    if (!toSettle.length) return;

    const nowIso = new Date().toISOString();
    const netRandsByUser = {};   // own holdings → wallets.balance (rands)
    const netCentsByChild = {};  // child holdings → family_members.available_balance (cents)
    // Credit at the client's expected exit (what they saw); fall back to the
    // broker's avg_exit only if it was never captured.
    const creditPerShareOf = (h) => (Number(h.expected_exit) > 0 ? Number(h.expected_exit) : Number(h.avg_exit) || 0);

    // 1. Close every sold position first (also the idempotency guard) so the
    //    "full exit" checks below see the up-to-date state.
    for (const h of toSettle) {
      await requestSupabaseJson(`/rest/v1/stock_holdings_c?id=eq.${encodeURIComponent(h.id)}`, {
        method: 'PATCH',
        body: { is_active: false, Status: 'closed', closed_at: nowIso, closed_reason: 'sold', updated_at: nowIso },
      });
    }

    // 2. Per-sale breakdown. Each sale (grouped by sell_transaction_id; legacy
    //    sells per owner) itemises: gross proceeds − broker fee − custody fee
    //    + unused 8% reserve returned + rebalance residual returned = net.
    //    Custody is charged against the reserve (shown as reducing the reserve
    //    line). No transaction fee, no AUM.
    const reserveRefundByUser = {};  // userId → rands (own) — for the email panel
    const reserveRefundByChild = {}; // familyMemberId → cents (child)
    const breakdownByKey = {};       // key → full itemisation for the sell txn + email
    const feeCfg = await getSellFeeConfig();

    const byKey = {};
    for (const h of toSettle) {
      const key = h.sell_transaction_id || `legacy:${h.family_member_id || h.user_id}`;
      (byKey[key] = byKey[key] || []).push(h);
    }

    for (const [key, group] of Object.entries(byKey)) {
      const h0 = group[0];
      const isChild = !!h0.family_member_id;
      const proceedsCents = group.reduce((s, h) => s + Math.round(creditPerShareOf(h) * (Number(h.quantity) || 0)), 0);
      const numAssets = new Set(group.map((h) => h.security_id).filter(Boolean)).size || 1;

      // Fees: broker (% of proceeds) + custody (per asset). No transaction fee.
      const brokerCents  = Math.round((proceedsCents / 100) * feeCfg.BROKER_FEE_RATE * 100);
      const custodyCents = Math.round(feeCfg.CUSTODY_FEE_PER_ASSET * numAssets * 100);

      // Reserve: unused 8% on each buy transaction fully exited by this sale.
      let reserveCents = 0;
      try {
        const buyTxnIds = [...new Set(group.map((h) => h.transaction_id).filter(Boolean))];
        for (const buyTxnId of buyTxnIds) {
          const funded = await fetchSupabaseJson(`/rest/v1/stock_holdings_c?transaction_id=eq.${encodeURIComponent(buyTxnId)}&select=is_active`);
          if (!funded || !funded.length || !funded.every((h) => h.is_active === false)) continue; // only on FULL exit
          const txRows = await fetchSupabaseJson(`/rest/v1/transactions?id=eq.${encodeURIComponent(buyTxnId)}&select=buffer_cents,buffer_consumed_cents,buffer_refunded`);
          const buyTx = txRows && txRows[0];
          if (!buyTx || buyTx.buffer_refunded) continue; // idempotent
          const unused = Math.max(0, Math.round(Number(buyTx.buffer_cents || 0) - Number(buyTx.buffer_consumed_cents || 0)));
          await requestSupabaseJson(`/rest/v1/transactions?id=eq.${encodeURIComponent(buyTxnId)}`, { method: 'PATCH', body: { buffer_refunded: true, updated_at: nowIso } });
          reserveCents += unused;
        }
      } catch (e) { console.error('[settle-sell] reserve calc:', e?.message || e); }

      // Residual: return the strategy's rebalance residual on a FULL strategy exit.
      let residualCents = 0;
      try {
        const stratIds = [...new Set(group.map((h) => h.strategy_id).filter(Boolean))];
        for (const sid of stratIds) {
          const scope = isChild
            ? `family_member_id=eq.${encodeURIComponent(h0.family_member_id)}`
            : `user_id=eq.${encodeURIComponent(h0.user_id)}&family_member_id=is.null`;
          // Any active holdings left in this strategy for this owner? If so, not a full exit.
          const remaining = await fetchSupabaseJson(`/rest/v1/stock_holdings_c?strategy_id=eq.${encodeURIComponent(sid)}&${scope}&is_active=eq.true&trade_side=eq.BUY&select=id&limit=1`);
          if (remaining && remaining.length) continue;
          const resRows = await fetchSupabaseJson(`/rest/v1/strategy_rebalance_residuals?strategy_id=eq.${encodeURIComponent(sid)}&${scope}&select=id,balance_cents`);
          for (const r of (resRows || [])) {
            const bal = Math.max(0, Math.round(Number(r.balance_cents) || 0));
            if (bal <= 0) continue;
            residualCents += bal;
            await requestSupabaseJson(`/rest/v1/strategy_rebalance_residuals?id=eq.${encodeURIComponent(r.id)}`, { method: 'PATCH', body: { balance_cents: 0 } });
          }
        }
      } catch (e) { console.error('[settle-sell] residual calc:', e?.message || e); }

      // Net = proceeds − broker − custody + reserve + residual (never below 0).
      const netCents = Math.max(0, proceedsCents - brokerCents - custodyCents + reserveCents + residualCents);
      breakdownByKey[key] = { proceedsCents, brokerCents, custodyCents, reserveCents, residualCents, netCents, numAssets };

      if (isChild) {
        netCentsByChild[h0.family_member_id] = (netCentsByChild[h0.family_member_id] || 0) + netCents;
        reserveRefundByChild[h0.family_member_id] = (reserveRefundByChild[h0.family_member_id] || 0) + reserveCents;
      } else {
        netRandsByUser[h0.user_id] = (netRandsByUser[h0.user_id] || 0) + netCents / 100;
        reserveRefundByUser[h0.user_id] = (reserveRefundByUser[h0.user_id] || 0) + reserveCents;
      }
    }

    // Credit own wallets (rands).
    for (const [uid, addRands] of Object.entries(netRandsByUser)) {
      const wRows = await fetchSupabaseJson(`/rest/v1/wallets?user_id=eq.${encodeURIComponent(uid)}&select=balance`);
      const cur = Number(wRows?.[0]?.balance || 0);
      await requestSupabaseJson(`/rest/v1/wallets?user_id=eq.${encodeURIComponent(uid)}`, {
        method: 'PATCH', body: { balance: cur + addRands },
      });
    }
    // Credit child accounts (cents).
    for (const [fmId, addCents] of Object.entries(netCentsByChild)) {
      const fmRows = await fetchSupabaseJson(`/rest/v1/family_members?id=eq.${encodeURIComponent(fmId)}&select=available_balance`);
      const cur = Number(fmRows?.[0]?.available_balance || 0);
      await requestSupabaseJson(`/rest/v1/family_members?id=eq.${encodeURIComponent(fmId)}`, {
        method: 'PATCH', body: { available_balance: cur + addCents },
      });
    }

    // ── Reconcile each sell transaction idempotently ─────────────────────────
    // A strategy sell has ONE transaction shared by MANY holdings (one per
    // security), each of which the broker may fill on a different day in a
    // separate CRM action. Rather than overwrite the transaction's amount
    // with just THIS batch's credit, recompute the full realised total from
    // EVERY holding linked to it (sell_transaction_id) — so partial fills
    // accumulate correctly and the transaction only flips to "completed" once
    // every holding in the sell has actually settled.
    const txnIds = [...new Set(toSettle.map((h) => h.sell_transaction_id).filter(Boolean))];
    for (const txnId of txnIds) {
      try {
        const [group, txnRows] = await Promise.all([
          fetchSupabaseJson(`/rest/v1/stock_holdings_c?sell_transaction_id=eq.${encodeURIComponent(txnId)}&select=security_id,quantity,avg_exit,expected_exit,is_active`),
          fetchSupabaseJson(`/rest/v1/transactions?id=eq.${encodeURIComponent(txnId)}&select=user_id,status,store_reference`),
        ]);
        const all = group || [];
        if (!all.length) continue;
        const filled = all.filter((h) => Number(h.avg_exit) > 0);
        const realizedCents = filled.reduce((s, h) => s + Math.round(creditPerShareOf(h) * (Number(h.quantity) || 0)), 0);
        const allSettled = all.every((h) => h.is_active === false);
        const txn = txnRows && txnRows[0];
        const wasPending = txn?.status === 'pending';
        // Withdrawal breakdown for this sale. amount = NET credited (proceeds −
        // broker − custody + reserve + residual); the fee columns feed the CRM
        // fee cards / Finances. transaction fee is always 0 on a sell.
        const bd = breakdownByKey[txnId] || { proceedsCents: realizedCents, brokerCents: 0, custodyCents: 0, reserveCents: 0, residualCents: 0, netCents: realizedCents };
        await requestSupabaseJson(`/rest/v1/transactions?id=eq.${encodeURIComponent(txnId)}`, {
          method: 'PATCH',
          body: {
            amount: bd.netCents,
            base_amount_cents: bd.proceedsCents,
            broker_fee_cents: bd.brokerCents,
            isin_fee_cents: bd.custodyCents,
            transaction_fee_cents: 0,
            status: allSettled ? 'posted' : 'pending',
            updated_at: nowIso,
          },
        });
        // Email once, exactly on the pending -> fully-settled transition.
        if (allSettled && wasPending && txn?.user_id) {
          await sendSellSettledEmail({
            userId: txn.user_id,
            reference: txn.store_reference || txnId,
            lines: filled.map((h) => ({
              securityId: h.security_id,
              quantity: Number(h.quantity) || 0,
              amountCents: Math.round(creditPerShareOf(h) * (Number(h.quantity) || 0)),
            })),
            breakdown: bd,
          });
        }
      } catch (txErr) {
        console.error(`[settle-sell] transaction reconcile failed for ${txnId}:`, txErr?.message || txErr);
      }
    }

    // Legacy holdings sold before sell_transaction_id existed — best-effort
    // fallback to the old heuristic (most recent pending "Sell:" transaction).
    // Unlike the path above, this can't recompute from EVERY holding tied to
    // the transaction (no deterministic link), so if a legacy multi-security
    // sell is filled across separate CRM actions, only the FIRST batch flips
    // the transaction + sends the email — later batches still credit the
    // wallet correctly but silently skip (no pending row left to match).
    const legacy = toSettle.filter((h) => !h.sell_transaction_id);
    const legacyUserIds = [...new Set(legacy.filter((h) => !h.family_member_id).map((h) => h.user_id))];
    for (const uid of legacyUserIds) {
      const userLegacy = legacy.filter((h) => h.user_id === uid && !h.family_member_id);
      const netCents = Math.round(userLegacy.reduce((s, h) => s + creditPerShareOf(h) * (Number(h.quantity) || 0), 0));
      if (netCents <= 0) continue;
      const txns = await fetchSupabaseJson(
        `/rest/v1/transactions?user_id=eq.${encodeURIComponent(uid)}&status=eq.pending&name=like.Sell:*&select=id,store_reference&order=created_at.desc&limit=1`
      );
      const tx = txns && txns[0];
      if (tx) {
        const bd = breakdownByKey[`legacy:${uid}`] || { proceedsCents: netCents, brokerCents: 0, custodyCents: 0, reserveCents: 0, residualCents: 0, netCents };
        await requestSupabaseJson(`/rest/v1/transactions?id=eq.${encodeURIComponent(tx.id)}`, {
          method: 'PATCH', body: {
            status: 'posted',
            amount: bd.netCents,
            base_amount_cents: bd.proceedsCents,
            broker_fee_cents: bd.brokerCents,
            isin_fee_cents: bd.custodyCents,
            transaction_fee_cents: 0,
            updated_at: nowIso,
          },
        });
        // status=eq.pending in the query above means this match-and-flip only
        // ever happens once per transaction — safe to email unconditionally here.
        await sendSellSettledEmail({
          userId: uid,
          reference: tx.store_reference || tx.id,
          lines: userLegacy.map((h) => ({
            securityId: h.security_id,
            quantity: Number(h.quantity) || 0,
            amountCents: Math.round(creditPerShareOf(h) * (Number(h.quantity) || 0)),
          })),
          breakdown: bd,
        });
      }
    }
  } catch (err) {
    console.error('[settle-sell] failed:', err?.message || err);
  }
}

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

    // ── Role check: granular permission check for fill price edits ───────────
    const authResult = await requirePermission(req, res, 'orderbook', 'edit_fill_price');
    if (!authResult) return;
    
    // Master ★ and Dev accounts bypass the approval queue.
    if (!isMasterOrDev(authResult.member)) {
      return sendJson(res, 403, { error: 'Direct edits require Master ★ or Dev. Please submit an approval request.' });
    }
    
    const email = (authUser?.email || '').toLowerCase();
    if (!email) {
      return sendJson(res, 401, { error: 'Could not resolve user email from token' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const ids = Array.isArray(body.ids) ? body.ids.map((value) => String(value || '').trim()).filter(Boolean) : [];
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;

    if (!ids.length) {
      return sendJson(res, 400, { error: 'No ids provided' });
    }

    if (!payload || !Object.keys(payload).length) {
      return sendJson(res, 400, { error: 'No payload provided' });
    }

    // Stamp WHO authorized this fill (and when), server-side from the verified
    // token — so it can never be spoofed by the client. Applies to both the
    // broker-fills upload and the manual pencil (both POST here).
    if (Object.prototype.hasOwnProperty.call(payload, 'avg_fill')) {
      payload.fill_set_by = email;
      payload.fill_set_at = new Date().toISOString();
    }

    const updatedRows = await requestSupabaseJson(
      `/rest/v1/stock_holdings_c?id=in.(${buildInFilter(ids)})&select=id`,
      {
        method: 'PATCH',
        token,
        useServiceRoleAuth: true,
        body: payload,
        extraHeaders: {
          Prefer: 'return=representation'
        }
      }
    );

    const updatedCount = Array.isArray(updatedRows) ? updatedRows.length : 0;
    if (!updatedCount) {
      return sendJson(res, 409, {
        error: 'No rows were updated',
        ids
      });
    }

    // Legacy SELL rows can predate expected_exit. Use the confirmed exit as a
    // neutral baseline only where no quote exists, so the Expected and Actual
    // columns show values (R0 spread) instead of remaining as dashes.
    if (Object.prototype.hasOwnProperty.call(payload, 'avg_exit')) {
      await requestSupabaseJson(
        `/rest/v1/stock_holdings_c?id=in.(${buildInFilter(ids)})&expected_exit=is.null`,
        { method: 'PATCH', useServiceRoleAuth: true, body: { expected_exit: payload.avg_exit } }
      );
    }

    // If a fill price was set, reconcile the execution-reserve (8% buffer)
    // ledger for the affected transactions. Awaited so buffer_consumed_cents is
    // already up to date by the time the orderbook refreshes, but it can never
    // fail the request (the helper swallows its own errors).
    if (Object.prototype.hasOwnProperty.call(payload, 'avg_fill')) {
      await reconcileBufferDrawdowns(ids);
    }

    // If an exit price was set, realise the sell(s): close holding(s), credit
    // the client's wallet with net proceeds (gross − 8%), complete the txn.
    if (Object.prototype.hasOwnProperty.call(payload, 'avg_exit')) {
      await settleSellFills(ids);
    }

    return sendJson(res, 200, {
      ok: true,
      updatedCount,
      updatedIds: updatedRows.map((row) => row.id)
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: 'Could not update orderbook price',
      details: error?.message || 'Unknown error'
    });
  }
};

// Used only after a Master ★ approves a queued fill-price request. The stored
// request is applied with service-role access and runs the same reconciliation
// side effects as a direct Master edit.
module.exports.applyApprovedPriceUpdate = async ({ ids, payload, email }) => {
  const cleanIds = Array.isArray(ids) ? ids.map((v) => String(v || '').trim()).filter(Boolean) : [];
  if (!cleanIds.length) throw new Error('Approved fill request has no holding ids.');
  const src = payload && typeof payload === 'object' ? payload : {};
  const allowed = ['avg_fill', 'avg_exit', 'Fill_date', 'Exit_date', 'updated_at', 'as_of_date'];
  const cleanPayload = {};
  allowed.forEach((key) => { if (Object.prototype.hasOwnProperty.call(src, key)) cleanPayload[key] = src[key]; });
  if (!Object.prototype.hasOwnProperty.call(cleanPayload, 'avg_fill') && !Object.prototype.hasOwnProperty.call(cleanPayload, 'avg_exit')) {
    throw new Error('Approved request contains no fill or exit price.');
  }
  if (Object.prototype.hasOwnProperty.call(cleanPayload, 'avg_fill')) {
    cleanPayload.fill_set_by = String(email || '').toLowerCase();
    cleanPayload.fill_set_at = new Date().toISOString();
  }
  const rows = await requestSupabaseJson(
    `/rest/v1/stock_holdings_c?id=in.(${buildInFilter(cleanIds)})&select=id`,
    { method: 'PATCH', useServiceRoleAuth: true, body: cleanPayload, extraHeaders: { Prefer: 'return=representation' } }
  );
  if (!Array.isArray(rows) || !rows.length) throw new Error('Approved fill request updated no holdings.');
  if (Object.prototype.hasOwnProperty.call(cleanPayload, 'avg_exit')) {
    await requestSupabaseJson(
      `/rest/v1/stock_holdings_c?id=in.(${buildInFilter(cleanIds)})&expected_exit=is.null`,
      { method: 'PATCH', useServiceRoleAuth: true, body: { expected_exit: cleanPayload.avg_exit } }
    );
    await settleSellFills(cleanIds);
  }
  if (Object.prototype.hasOwnProperty.call(cleanPayload, 'avg_fill')) await reconcileBufferDrawdowns(cleanIds);
  return rows;
};
