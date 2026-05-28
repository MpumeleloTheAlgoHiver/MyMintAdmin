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

    const [holdings, strategies] = await Promise.all([
      sbGet('stock_holdings_c?select=user_id,family_member_id,security_id,strategy_id,quantity,avg_fill,Expected_fill,market_value,created_at&is_active=eq.true&trade_side=eq.BUY'),
      sbGet('strategies_c?select=id,name,short_name,description,risk_level,sector'),
    ]);

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
    const stratHist = stratHistArrays.flat();

    /* Recalculate inception_pnl and inception_pct on the LATEST row per user.
       Cost basis per share = higher of (avg_fill / 100) and Expected_fill,
       both in rands. Guard against legacy rows that stored Expected_fill in
       cents (>5x avg_fill-in-rands → /100). Then × 100 to keep investedByUser
       in cents because client_strategy_returns_c.basket_value is in cents. */
    const costBasisRandsPerShare = (h) => {
      const avgRands = (Number(h.avg_fill) || 0) / 100;
      let expRands = Number(h.Expected_fill);
      if (!Number.isFinite(expRands) || expRands <= 0) expRands = 0;
      if (expRands > 0 && avgRands > 0 && expRands > avgRands * 5) {
        expRands = expRands / 100;
      }
      return Math.max(avgRands, expRands);
    };
    const investedByUser = {};
    (holdings || []).forEach(h => {
      const uid = h.user_id;
      const costCents = costBasisRandsPerShare(h) * Number(h.quantity) * 100;
      if (uid && costCents > 0) investedByUser[uid] = (investedByUser[uid] || 0) + costCents;
    });
    const latestRowByUser = {};
    stratHist.forEach(r => { latestRowByUser[r.user_id] = r; });
    Object.values(latestRowByUser).forEach(r => {
      const invested = investedByUser[r.user_id];
      if (invested > 0) {
        r.inception_pnl = r.basket_value - invested;
        r.inception_pct = (r.inception_pnl / invested) * 100;
      }
    });

    const [profiles, secMeta, secLive, txns, familyMembers] = await Promise.all([
      userIds.length
        ? sbGet(`profiles?select=id,first_name,last_name,email,mint_number&id=in.(${userIds.join(',')})`)
        : Promise.resolve([]),
      secIds.length
        ? sbGet(`securities_c?select=id,symbol,name,sector,logo_url&id=in.(${secIds.join(',')})`)
        : Promise.resolve([]),
      secIds.length
        ? sbGet(`stock_returns_c?select=security_id,symbol,current_price,1d_pct,ytd_pct,1y_pct,as_of_date&security_id=in.(${secIds.join(',')})&order=as_of_date.desc`)
        : Promise.resolve([]),
      userIds.length
        ? sbGet(`transactions?select=user_id,amount,direction,name,description,status,transaction_date&user_id=in.(${userIds.join(',')})&order=transaction_date.desc`)
        : Promise.resolve([]),
      famIds.length
        ? sbGet(`family_members?select=id,first_name,last_name&id=in.(${famIds.join(',')})`)
        : Promise.resolve([]),
    ]);

    res.statusCode = 200;
    res.end(JSON.stringify({ holdings, strategies, stratHist, profiles, secMeta, secLive, txns, familyMembers }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
};
