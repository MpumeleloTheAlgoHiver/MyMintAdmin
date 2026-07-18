module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'Supabase not configured' }));
  }

  try {
    const sbH = {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
    };
    const sbGet = (path) =>
      fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: sbH }).then((r) => r.json());

    let [holdings, strategies] = await Promise.all([
      sbGet('stock_holdings_c?select=user_id,family_member_id,security_id,strategy_id,quantity,avg_fill,expected_fill:%22Expected_fill%22,market_value,transaction_id,created_at&is_active=eq.true&trade_side=eq.BUY'),
      sbGet('strategies_c?select=id,name,short_name,description,risk_level,sector'),
    ]);

    /* Exclude UAT/test accounts (profiles.is_test = true) from the investor list
       entirely — they must never show on investors.html. Filtering holdings here
       scopes userIds/secIds/famIds and everything fetched from them downstream. */
    let testIds = new Set();
    try {
      const testRows = await sbGet('profiles?select=id&is_test=eq.true');
      testIds = new Set((testRows || []).map((r) => r.id));
      if (testIds.size) holdings = (holdings || []).filter((h) => !testIds.has(h.user_id));
    } catch (e) { /* is_test column absent -> no filtering */ }

    /* Client cost basis per share, in CENTS, preferring Expected_fill (the price
       the client saw at buy time, in rands) over avg_fill (broker fill in cents,
       which carries MINT's spread). Guards legacy Expected_fill rows that were
       stored in cents (>5Ã— avg_fill/100). Mirrors the MINT app's
       costBasisRandsPerShare so the CRM and the client app agree to the cent. */
    const userIds  = [...new Set((holdings || []).map((r) => r.user_id).filter(Boolean))];
    const secIds   = [...new Set((holdings || []).map((r) => r.security_id).filter(Boolean))];
    const famIds   = [...new Set((holdings || []).map((r) => r.family_member_id).filter(Boolean))];

    /* Fetch per-investor NAV history from client_strategy_returns_c — keyed by user_id */
    const stratHistArrays = userIds.length
      ? await Promise.all(
          userIds.map((uid) =>
            sbGet(
              `client_strategy_returns_c?select=user_id,strategy_id,as_of_date,basket_value,1d_pct,5d_pct,1m_pct,6m_pct,ytd_pct,1y_pct,5y_pct,inception_pct,inception_pnl&user_id=eq.${uid}&order=as_of_date.asc`
            )
          )
        )
      : [];
    let stratHist = stratHistArrays.flat();

    /* Optional admin repair preview. The switch lives in app_settings and can
       only be changed by a master admin. Only a VALIDATED/APPROVED shadow run
       is accepted. Production return rows remain untouched and are the instant
       fallback when the switch is disabled or any validation lookup fails. */
    let repairPreview = { enabled: false };
    try {
      const settings = await sbGet('app_settings?key=eq.repair_preview&select=value&limit=1');
      const cfg = settings?.[0]?.value || {};
      if (cfg.enabled === true && cfg.run_id) {
        const runs = await sbGet(`return_repair_runs_c?id=eq.${encodeURIComponent(cfg.run_id)}&status=in.(VALIDATED,APPROVED,PROMOTED)&select=id,repair_key,status,scope&limit=1`);
        const run = runs?.[0];
        if (run) {
          const shadow = userIds.length
            ? await sbGet(`client_strategy_returns_shadow_c?run_id=eq.${run.id}&user_id=in.(${userIds.join(',')})&select=*&order=as_of_date.asc`)
            : [];
          const shadowGroups = new Map();
          const repairedSeriesKeys = new Set((shadow || []).map(row => `${row.user_id}:${row.strategy_id}`));
          stratHist = stratHist.filter(row => !repairedSeriesKeys.has(`${row.user_id}:${row.strategy_id}`));
          for (const row of shadow || []) {
            const key = `${row.user_id}:${row.family_member_id || ''}:${row.strategy_id}`;
            if (!shadowGroups.has(key)) shadowGroups.set(key, []);
            shadowGroups.get(key).push(row);
          }
          const periodReturn = (end, start) => {
            const endFactor = 1 + Number(end?.gross_strategy_twr_pct || 0) / 100;
            const startFactor = 1 + Number(start?.gross_strategy_twr_pct || 0) / 100;
            return start && startFactor > 0 ? (endFactor / startFactor - 1) * 100 : null;
          };
          for (const rows of shadowGroups.values()) rows.forEach((row, index) => {
            row._1d_pct = periodReturn(row, rows[index - 1]);
            row._5d_pct = periodReturn(row, rows[Math.max(0, index - 5)]);
            const cutoff = new Date(`${row.as_of_date}T00:00:00Z`); cutoff.setUTCDate(cutoff.getUTCDate() - 30);
            const monthBase = rows.slice(0, index).filter(x => new Date(`${x.as_of_date}T00:00:00Z`) <= cutoff).at(-1) || rows[0];
            row._1m_pct = periodReturn(row, monthBase);
            const openingGrossNav = Number(rows[0]?.complete_nav_cents || 0) + Number(rows[0]?.accrued_liability_cents || 0);
            row._strategy_pnl_cents = Math.round(openingGrossNav * Number(row.gross_strategy_twr_pct || 0) / 100);
          });
          for (const row of shadow || []) {
            const mapped = {
              user_id: row.user_id,
              strategy_id: row.strategy_id,
              as_of_date: row.as_of_date,
              basket_value: row.complete_nav_cents,
              portfolio_value: row.complete_nav_cents,
              total_value_cents: row.complete_nav_cents,
              ytd_pct: row.gross_strategy_twr_pct,
              inception_pct: row.gross_strategy_twr_pct,
              '1d_pct': row._1d_pct,
              '5d_pct': row._5d_pct,
              '1m_pct': row._1m_pct,
              inception_pnl: row._strategy_pnl_cents,
              cash_difference_cents: row.net_cash_pnl_cents,
              repair_preview: true,
              repair_full_history: row.source_evidence?.full_daily_history === true,
              repair_run_id: run.id,
              securities_value_cents: row.securities_value_cents,
              residual_cash_cents: row.residual_cash_cents,
              unused_reserve_cents: row.unused_reserve_cents,
              accrued_liability_cents: row.accrued_liability_cents,
              gross_strategy_twr_pct: row.gross_strategy_twr_pct,
              net_cash_return_pct: row.net_cash_return_pct,
              confidence: row.confidence,
            };
            stratHist.push(mapped);
          }
          stratHist.sort((a, b) => String(a.as_of_date).localeCompare(String(b.as_of_date)));
          repairPreview = { enabled: true, run_id: run.id, repair_key: run.repair_key, status: run.status, client_rows: (shadow || []).length };
        }
      }
    } catch (e) {
      repairPreview = { enabled: false, fallback: true, reason: 'Shadow preview unavailable; production values retained.' };
    }

    /* Recalculate inception_pnl and inception_pct using the client cost basis
       (Expected_fill, the price the client saw), NOT avg_fill — avg_fill carries
       MINT's spread. costBasisCentsPerShare returns cents, so Ã— quantity gives
       cents directly, matching basket_value (also cents). */
    /* Keep the return spine immutable in transit. A client may own multiple
       strategies, so recomputing one row from holdings grouped by user_id mixes
       unrelated basket cost bases (for example Yield + ETF) and fabricates an
       inception loss. Live holdings economics are calculated separately by the
       page; historical percentages remain exactly as stored until the
       chain-linked complete-NAV return engine replaces them. */

    const [profiles, secMeta, secReturns, secIntraday, txns, familyMembers, drawdowns, residuals, rebEvents, rebBatches, closedHoldings, aumFeeState, aumFeeTxns, aumSegments, wallets] = await Promise.all([
      userIds.length
        ? sbGet(`profiles?select=id,first_name,last_name,email,mint_number,computershare_number&id=in.(${userIds.join(',')})`)
        : Promise.resolve([]),
      secIds.length
        ? sbGet(`securities_c?select=id,symbol,name,sector,logo_url&id=in.(${secIds.join(',')})`)
        : Promise.resolve([]),
      secIds.length
        ? sbGet(`stock_returns_c?select=security_id,symbol,current_price,1d_pct,ytd_pct,1y_pct,as_of_date&security_id=in.(${secIds.join(',')})&order=as_of_date.desc`)
        : Promise.resolve([]),
      /* Live intraday prices — same source the orderbook uses for its Live
         Price + Client PnL columns. First-write-wins per security_id with
         desc ordering gives us the latest tick. */
      secIds.length
        ? sbGet(`stock_intraday_c?select=security_id,current_price,timestamp&security_id=in.(${secIds.join(',')})&order=timestamp.desc`)
        : Promise.resolve([]),
      /* Pull the fee + buffer breakdown columns too so the investors page
         can show the negative side of each client's activity: fees paid,
         buffer consumed, etc. — not just deposits. base_amount_cents +
         buffer_cents = the cash held during a buy; buffer_consumed_cents is
         how much of that buffer the actual fill needed. */
      userIds.length
        ? sbGet(`transactions?select=id,user_id,family_member_id,amount,direction,name,description,status,transaction_date,broker_fee_cents,isin_fee_cents,transaction_fee_cents,base_amount_cents,buffer_cents,buffer_consumed_cents&user_id=in.(${userIds.join(',')})&order=transaction_date.desc`)
        : Promise.resolve([]),
      famIds.length
        ? sbGet(`family_members?select=id,first_name,last_name,computershare_number&id=in.(${famIds.join(',')})`)
        : Promise.resolve([]),
      /* Execution-reserve (8% buffer) ledger — the per-event audit trail of how
         each transaction's buffer was consumed (slippage_drawdown / shortfall)
         or returned (cancel_refund / sale_refund). Admin-only on the CRM; the
         user-facing app never shows slippage. */
      userIds.length
        ? sbGet(`buffer_drawdowns_c?select=transaction_id,holding_id,user_id,family_member_id,event_type,delta_cents,expected_fill_cents,actual_fill_cents,quantity,created_at&user_id=in.(${userIds.join(',')})&order=created_at.desc`)
        : Promise.resolve([]),
      /* Per-strategy residual cash from rebalances. balance_cents is the leftover
         cash that stays in the strategy after a position swap. The investors page
         adds this to each client's value so the portfolio total isn't understated,
         and shows it broken out (holdings vs cash) in the detail. Service-role read
         bypasses the owner-only SELECT RLS so the admin sees every client's row. */
      userIds.length
        ? sbGet(`strategy_rebalance_residuals?select=user_id,strategy_id,family_member_id,balance_cents&user_id=in.(${userIds.join(',')})`)
        : Promise.resolve([]),
      /* Rebalance events + batch statuses — so the admin reconciliation can show
         rebalance fees (sell/buy brokerage + custody), which aren't written to the
         transactions table (a rebalance posts a R0 audit row). Admin-only. */
      userIds.length
        ? sbGet(`rebalance_event?select=id,user_id,family_member_id,batch_id,security_id,trade_side,quantity,price_at_commit,avg_fill,fill_date,closed_reason,strategy_name_snapshot,created_at,updated_at&user_id=in.(${userIds.join(',')})`)
        : Promise.resolve([]),
      sbGet(`rebalance_batch?select=id,strategy_id,status,effective_date,sell_security_id,buy_security_id,extra_buy_security_id,sell_isin_code,buy_isin_code,extra_buy_isin_code,net_proceeds,strategy_name_snapshot,created_at,settled_at,settlement_effective_at,updated_at,is_reversed,holdings_snapshot_before,holdings_snapshot_planned,holdings_snapshot_after,wallet_snapshot_before`),
      /* Closed positions (rebalance sells) carry REALISED P&L: (avg_exit −
         avg_fill) × qty. Needed so a client's live P&L row stays stable across
         rebalances instead of shrinking when sold shares leave the cost basis. */
      userIds.length
        ? sbGet(`stock_holdings_c?select=user_id,family_member_id,strategy_id,quantity,avg_fill,avg_exit&is_active=eq.false&user_id=in.(${userIds.join(',')})`)
        : Promise.resolve([]),
      /* AUM management fee taken from each strategy's cash sleeve (cumulative).
         Subtracted from the held 8% buffer when valuing a position so the CRM's
         portfolio value matches the app. Kept separate from broker slippage. */
      userIds.length
        ? sbGet(`strategy_aum_fee_state?select=user_id,family_member_id,strategy_id,aum_fee_consumed_cents,aum_fee_receivable_cents,low_cash_flag&user_id=in.(${userIds.join(',')})`)
        : Promise.resolve([]),
      /* Settled AUM fee ledger — one row per user/strategy/month. Source for the
         Finances "AUM fee collected" card + per-investor AUM totals. */
      userIds.length
        ? sbGet(`aum_fee_transactions?select=user_id,family_member_id,strategy_id,fee_amount_cents,deducted_from_cash_cents,fee_receivable_cents,period_start,period_end,settled_at&user_id=in.(${userIds.join(',')})`)
        : Promise.resolve([]),
      /* In-progress accrual segments — the fee building up THIS month before it
         settles. Open segments (segment_end_date is null) hold the running accrual. */
      userIds.length
        ? sbGet(`aum_fee_accrual_segments?select=user_id,family_member_id,strategy_id,period_month,accrued_fee_cents,days_in_segment,value_basis_cents,segment_end_date&user_id=in.(${userIds.join(',')})&segment_end_date=is.null`)
        : Promise.resolve([]),
      /* Spendable wallet cash per investor (RANDS) — the free cash outside of
         invested positions / the 8% sleeve / rebalance residual. Powers the
         per-investor balance breakdown on Finances. */
      userIds.length
        ? sbGet(`wallets?select=user_id,balance,status&user_id=in.(${userIds.join(',')})`)
        : Promise.resolve([]),
    ]);

    /* Merge intraday current_price (cents) into secLive rows so the client
       gets one shape. Intraday wins when present; stock_returns_c fills the
       gap for securities without an intraday tick. */
    const intradayByid = {};
    (Array.isArray(secIntraday) ? secIntraday : []).forEach((row) => {
      if (!row?.security_id) return;
      if (intradayByid[row.security_id]) return; // first (latest) wins
      if (row.current_price != null) intradayByid[row.security_id] = Number(row.current_price);
    });
    const secLive = (Array.isArray(secReturns) ? secReturns : []).map((r) => {
      const intraCents = intradayByid[r.security_id];
      if (Number.isFinite(intraCents) && intraCents > 0) {
        return { ...r, current_price: intraCents };
      }
      return r;
    });
    /* Surface intraday-only securities (no stock_returns_c row) too. */
    const returnsIds = new Set((secReturns || []).map((r) => r.security_id));
    Object.entries(intradayByid).forEach(([sid, cents]) => {
      if (returnsIds.has(sid)) return;
      secLive.push({ security_id: sid, current_price: cents });
    });

    /* UAT/test activity — kept SEPARATE from the real-account aggregates above so
       totals/investors/AUM stay real-only, but surfaced (with names) so the
       Finances activity feed can show test buys/sells behind a "UAT" badge. */
    let uatTxns = [], uatProfiles = [], uatFamilyMembers = [];
    const testIdArr = [...testIds];
    if (testIdArr.length) {
      [uatTxns, uatProfiles] = await Promise.all([
        sbGet(`transactions?select=id,user_id,family_member_id,amount,direction,name,status,transaction_date&user_id=in.(${testIdArr.join(',')})&order=transaction_date.desc&limit=500`),
        sbGet(`profiles?select=id,first_name,last_name,email&id=in.(${testIdArr.join(',')})`),
      ]);
      const uatFamIds = [...new Set((uatTxns || []).map((t) => t.family_member_id).filter(Boolean))];
      uatFamilyMembers = uatFamIds.length
        ? await sbGet(`family_members?select=id,first_name,last_name&id=in.(${uatFamIds.join(',')})`)
        : [];
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ holdings, strategies, stratHist, profiles, secMeta, secLive, txns, familyMembers, drawdowns, residuals, rebEvents, rebBatches, closedHoldings, aumFeeState, aumFeeTxns, aumSegments, wallets, uatTxns, uatProfiles, uatFamilyMembers, repairPreview }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
};
