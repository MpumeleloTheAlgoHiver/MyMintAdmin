// Guarded per-owner strategy return publisher.
// Safe by default: callers must pass apply=true to write.

const { requestSupabaseJson } = require('./_orderbook');

const NIL = '00000000-0000-0000-0000-000000000000';
const q = (value) => encodeURIComponent(String(value));
const base = (symbol) => String(symbol || '').trim().toUpperCase().replace(/\.JO$/, '');
const ownerKey = (userId, familyId, strategyId) => `${userId}|${familyId || NIL}|${strategyId}`;
const sameSnapshot = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

async function publishClientEodReturns({ asOfDate, apply = false, includeUat = false, includeTestUsers = false } = {}) {
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);
  const strategies = await requestSupabaseJson(
    '/rest/v1/strategies_c?select=id,name,investor_environment&status=eq.active', { method: 'GET' }
  );
  const strategyById = Object.fromEntries((strategies || []).map((row) => [row.id, row]));

  const holdings = await requestSupabaseJson(
    '/rest/v1/stock_holdings_c?select=id,user_id,family_member_id,strategy_id,security_id,quantity,transaction_id,rebalance_batch_id,created_at,Fill_date&is_active=eq.true&quantity=gt.0',
    { method: 'GET' }
  );
  let testUserIds = new Set();
  if (!includeTestUsers) {
    // Match the CRM's UAT classification exactly. Fail closed if either source
    // cannot be read; a test owner must never leak into production publication.
    const [testProfiles, testWallets] = await Promise.all([
      requestSupabaseJson('/rest/v1/profiles?select=id&is_test=eq.true', { method: 'GET' }),
      requestSupabaseJson('/rest/v1/wallets?select=user_id&status=eq.test', { method: 'GET' })
    ]);
    testUserIds = new Set([
      ...(testProfiles || []).map((row) => String(row.id)),
      ...(testWallets || []).map((row) => String(row.user_id))
    ]);
  }
  const eligible = (holdings || []).filter((row) => {
    const strategy = strategyById[row.strategy_id];
    if (!row.user_id || !strategy || (!includeTestUsers && testUserIds.has(String(row.user_id)))) return false;
    return includeUat || String(strategy.investor_environment || 'LIVE').toUpperCase() !== 'UAT';
  });
  if (!eligible.length) return { ok: true, asOf, apply, summary: { published: 0, skipped: 0, failed: 0, total: 0 }, results: [] };

  const securityIds = [...new Set(eligible.map((row) => row.security_id).filter(Boolean))];
  const securities = await requestSupabaseJson(
    `/rest/v1/securities_c?select=id,symbol&id=in.(${securityIds.map(q).join(',')})`, { method: 'GET' }
  );
  const securityById = Object.fromEntries((securities || []).map((row) => [row.id, row]));
  const symbols = [...new Set((securities || []).flatMap((row) => [base(row.symbol), `${base(row.symbol)}.JO`]))];
  const since = new Date(new Date(`${asOf}T23:59:59Z`).getTime() - 4 * 86400000).toISOString();
  const intraday = await requestSupabaseJson(
    `/rest/v1/stock_intraday_c?select=symbol,current_price,timestamp&symbol=in.(${symbols.map(q).join(',')})&timestamp=gte.${q(since)}&order=timestamp.desc`,
    { method: 'GET' }
  ).catch(() => []);
  const priceBySymbol = new Map();
  for (const row of (intraday || [])) {
    const symbol = base(row.symbol);
    if (!priceBySymbol.has(symbol) && Number(row.current_price) > 0) {
      priceBySymbol.set(symbol, { cents: Number(row.current_price), timestamp: row.timestamp });
    }
  }

  const groups = new Map();
  for (const row of eligible) {
    const key = ownerKey(row.user_id, row.family_member_id, row.strategy_id);
    if (!groups.has(key)) groups.set(key, { userId: row.user_id, familyId: row.family_member_id || null, strategyId: row.strategy_id, rows: [] });
    groups.get(key).rows.push(row);
  }

  const userIds = [...new Set(eligible.map((row) => row.user_id))];
  const strategyIds = [...new Set(eligible.map((row) => row.strategy_id))];
  const transactionIds = [...new Set(eligible.map((row) => row.transaction_id).filter(Boolean))];
  const [residuals, transactions, liabilities, previousRows, seedRows, recentBatches, recentEvents] = await Promise.all([
    requestSupabaseJson(`/rest/v1/strategy_rebalance_residuals?select=user_id,family_member_id,strategy_id,balance_cents&user_id=in.(${userIds.map(q).join(',')})&strategy_id=in.(${strategyIds.map(q).join(',')})`, { method: 'GET' }).catch(() => []),
    transactionIds.length ? requestSupabaseJson(`/rest/v1/transactions?select=id,buffer_cents,buffer_consumed_cents,status,reversed&id=in.(${transactionIds.map(q).join(',')})`, { method: 'GET' }).catch(() => []) : [],
    requestSupabaseJson(`/rest/v1/aum_fee_accrual_segments?select=user_id,family_member_id,strategy_id,accrued_fee_cents&user_id=in.(${userIds.map(q).join(',')})&strategy_id=in.(${strategyIds.map(q).join(',')})&segment_end_date=is.null`, { method: 'GET' }).catch(() => []),
    requestSupabaseJson(`/rest/v1/client_strategy_return_publication_audit_c?select=*&user_id=in.(${userIds.map(q).join(',')})&strategy_id=in.(${strategyIds.map(q).join(',')})&order=as_of_date.desc`, { method: 'GET' }).catch(() => []),
    requestSupabaseJson(`/rest/v1/client_strategy_returns_effective_latest_c?select=*&user_id=in.(${userIds.map(q).join(',')})&strategy_id=in.(${strategyIds.map(q).join(',')})`, { method: 'GET' }).catch(() => []),
    requestSupabaseJson(`/rest/v1/rebalance_batch?select=id,strategy_id,status,settled_at,settlement_effective_at&strategy_id=in.(${strategyIds.map(q).join(',')})&status=eq.SETTLED&order=updated_at.desc&limit=200`, { method: 'GET' }).catch(() => []),
    requestSupabaseJson(`/rest/v1/rebalance_event?select=batch_id,user_id,family_member_id&user_id=in.(${userIds.map(q).join(',')})&order=updated_at.desc&limit=1000`, { method: 'GET' }).catch(() => [])
  ]);

  const residualByKey = new Map((residuals || []).map((row) => [ownerKey(row.user_id, row.family_member_id, row.strategy_id), Math.max(0, Math.round(Number(row.balance_cents) || 0))]));
  const txById = new Map((transactions || []).map((row) => [row.id, row]));
  const liabilityByKey = new Map();
  for (const row of (liabilities || [])) {
    const key = ownerKey(row.user_id, row.family_member_id, row.strategy_id);
    liabilityByKey.set(key, (liabilityByKey.get(key) || 0) + Math.max(0, Math.round(Number(row.accrued_fee_cents) || 0)));
  }
  const previousByKey = new Map();
  for (const row of (previousRows || [])) {
    const key = ownerKey(row.user_id, row.family_member_id, row.strategy_id);
    if (!previousByKey.has(key)) previousByKey.set(key, row);
  }
  const seedByKey = new Map((seedRows || []).map((row) => [ownerKey(row.user_id, row.family_member_id, row.strategy_id), row]));
  const batchById = new Map((recentBatches || []).map((row) => [row.id, row]));
  const boundaryBatchesByOwner = new Map();
  for (const event of (recentEvents || [])) {
    const batch = batchById.get(event.batch_id);
    if (!batch || batch.status !== 'SETTLED') continue;
    const key = ownerKey(event.user_id, event.family_member_id, batch.strategy_id);
    if (!boundaryBatchesByOwner.has(key)) boundaryBatchesByOwner.set(key, []);
    boundaryBatchesByOwner.get(key).push(batch);
  }

  const results = [];
  let published = 0; let skipped = 0; let failed = 0;
  for (const [key, group] of groups.entries()) {
    const strategy = strategyById[group.strategyId];
    try {
      const aggregated = new Map();
      for (const holding of group.rows) {
        const security = securityById[holding.security_id];
        if (!security) throw new Error(`unknown security ${holding.security_id}`);
        const current = aggregated.get(holding.security_id) || { security_id: holding.security_id, symbol: base(security.symbol), quantity: 0 };
        current.quantity += Number(holding.quantity) || 0;
        aggregated.set(holding.security_id, current);
      }
      const snapshot = [...aggregated.values()].filter((row) => row.quantity > 0)
        .sort((a, b) => a.security_id.localeCompare(b.security_id));
      let securitiesCents = 0; let oldestPriceAt = null;
      const missing = [];
      for (const holding of snapshot) {
        const quote = priceBySymbol.get(holding.symbol);
        if (!quote) { missing.push(holding.symbol); continue; }
        securitiesCents += Math.round(holding.quantity * quote.cents);
        if (!oldestPriceAt || new Date(quote.timestamp) < new Date(oldestPriceAt)) oldestPriceAt = quote.timestamp;
      }
      if (missing.length) throw new Error(`missing prices: ${missing.join(',')}`);
      if (!oldestPriceAt || new Date(oldestPriceAt) < new Date(`${asOf}T00:00:00Z`).getTime() - 86400000) {
        throw new Error('stale prices (non-trading day?)');
      }

      const residualCents = residualByKey.get(key) || 0;
      const distinctTx = new Set(group.rows.map((row) => row.transaction_id).filter(Boolean));
      let reserveCents = 0;
      for (const id of distinctTx) {
        const tx = txById.get(id);
        if (!tx || String(tx.status) !== 'posted' || tx.reversed) continue;
        reserveCents += Math.max(0, Math.round(Number(tx.buffer_cents) || 0) - Math.round(Number(tx.buffer_consumed_cents) || 0));
      }
      const liabilityCents = liabilityByKey.get(key) || 0;
      const performanceNavCents = Math.round(securitiesCents) + residualCents + reserveCents;
      const completeNavCents = performanceNavCents - liabilityCents;
      if (completeNavCents < 0) throw new Error('accrued liability exceeds the client performance NAV');
      const previous = previousByKey.get(key);
      const seed = seedByKey.get(key);
      if (previous && String(previous.as_of_date) === asOf) {
        results.push({ client: group.userId, strategy: strategy.name, action: 'skip', reason: 'already published today' }); skipped++; continue;
      }
      const isGenuineNewAllocation = !previous && !seed
        && group.rows.length > 0
        && group.rows.every((row) => String(row.Fill_date || row.created_at || '').slice(0, 10) === asOf)
        && group.rows.every((row) => row.transaction_id && String(txById.get(row.transaction_id)?.status || '') === 'posted'
          && !txById.get(row.transaction_id)?.reversed);
      if (!previous && !seed && !isGenuineNewAllocation) {
        results.push({ client: group.userId, strategy: strategy.name, action: 'skip', reason: 'no trusted return seed' }); skipped++; continue;
      }

      let chainFactor; let twr; let openingPerformanceNav; let externalContribution;
      let mode; let dailyPct = null; let boundaryBatchId = null;
      if (isGenuineNewAllocation) {
        // A first filled allocation starts at 0%, never at an invented historical
        // return. From tomorrow onward the same cash-neutral chain compounds its
        // actual market performance. Requiring same-day holdings plus posted,
        // unreversed transactions prevents an old unseeded account being reset.
        twr = 0;
        chainFactor = 1;
        openingPerformanceNav = performanceNavCents;
        externalContribution = completeNavCents;
        mode = 'new-allocation-inception';
      } else if (!previous) {
        twr = Number(seed.ytd_pct || seed.inception_pct || 0);
        chainFactor = 1 + twr / 100;
        openingPerformanceNav = Math.round(Number(seed.opening_performance_nav_cents) || (performanceNavCents / chainFactor));
        externalContribution = seed.net_cash_pnl_cents == null ? completeNavCents : completeNavCents - Math.round(Number(seed.net_cash_pnl_cents));
        mode = `seed:${seed.source_kind || 'effective'}`;
      } else {
        chainFactor = Number(previous.chain_factor);
        openingPerformanceNav = Number(previous.opening_performance_nav_cents);
        externalContribution = previous.external_contribution_cents == null ? null : Number(previous.external_contribution_cents);
        if (!sameSnapshot(previous.holdings_snapshot, snapshot)) {
          const boundary = (boundaryBatchesByOwner.get(key) || []).find((batch) => {
            const date = String(batch.settlement_effective_at || batch.settled_at || '').slice(0, 10);
            return date && date > String(previous.as_of_date) && date <= asOf;
          });
          if (!boundary) throw new Error('composition changed without a settled rebalance boundary');
          boundaryBatchId = boundary.id;
          twr = (chainFactor - 1) * 100;
          mode = 'rebalance-boundary';
        } else {
          const previousCash = Math.round(Number(previous.residual_cash_cents) || 0) + Math.round(Number(previous.unused_reserve_cents) || 0);
          const previousPerformance = Math.round(Number(previous.performance_nav_cents) || 0);
          if (previousPerformance <= 0) throw new Error('previous performance NAV is not positive');
          dailyPct = ((securitiesCents + previousCash) / previousPerformance - 1) * 100;
          chainFactor *= (1 + dailyPct / 100);
          twr = (chainFactor - 1) * 100;
          mode = 'market-chain-cash-neutral';
        }
      }

      const inceptionPnlCents = Math.round(openingPerformanceNav * twr / 100);
      const netCashPnlCents = externalContribution == null ? null : completeNavCents - externalContribution;
      const netCashReturnPct = externalContribution > 0 ? (netCashPnlCents / externalContribution) * 100 : null;
      const params = {
        p_user_id: group.userId, p_family_member_id: group.familyId, p_strategy_id: group.strategyId,
        p_as_of_date: asOf, p_securities_value_cents: Math.round(securitiesCents),
        p_residual_cash_cents: residualCents, p_unused_reserve_cents: reserveCents,
        p_accrued_liability_cents: liabilityCents, p_performance_nav_cents: performanceNavCents,
        p_complete_nav_cents: completeNavCents, p_opening_performance_nav_cents: Math.round(openingPerformanceNav),
        p_external_contribution_cents: externalContribution == null ? null : Math.round(externalContribution),
        p_gross_strategy_twr_pct: twr, p_chain_factor: chainFactor,
        p_inception_pnl_cents: inceptionPnlCents, p_net_cash_pnl_cents: netCashPnlCents,
        p_net_cash_return_pct: netCashReturnPct, p_covered_holdings: snapshot.length,
        p_expected_holdings: snapshot.length, p_oldest_price_at: oldestPriceAt,
        p_holdings_snapshot: snapshot, p_boundary_batch_id: boundaryBatchId,
        p_checks: { source: 'client_eod_cron', mode, cash_neutral: mode === 'market-chain-cash-neutral', daily_pct: dailyPct }
      };
      if (apply) {
        await requestSupabaseJson('/rest/v1/rpc/publish_guarded_client_strategy_return', {
          method: 'POST', body: params, extraHeaders: { Prefer: 'return=representation' }
        });
      }
      results.push({ client: group.userId, strategy: strategy.name, action: apply ? 'published' : 'plan', mode, nav: completeNavCents, twr: Number(twr.toFixed(6)), daily: dailyPct == null ? null : Number(dailyPct.toFixed(6)) });
      published++;
    } catch (error) {
      results.push({ client: group.userId, strategy: strategy?.name || group.strategyId, action: 'failed', error: error?.message || 'unknown' });
      failed++;
    }
  }
  return { ok: true, asOf, apply, summary: { published, skipped, failed, total: groups.size }, results };
}

module.exports = { publishClientEodReturns };
