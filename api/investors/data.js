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
      sbGet('stock_holdings_c?select=user_id,security_id,strategy_id,quantity,avg_fill,market_value,created_at&is_active=eq.true&trade_side=eq.BUY'),
      sbGet('strategies_c?select=id,name,short_name,description,risk_level,sector'),
    ]);

    const userIds  = [...new Set((holdings || []).map((r) => r.user_id).filter(Boolean))];
    const secIds   = [...new Set((holdings || []).map((r) => r.security_id).filter(Boolean))];

    /* Fetch NAV history per strategy in parallel — each gets its own 1000-row budget */
    const stratIds = [...new Set((holdings || []).map((r) => r.strategy_id).filter(Boolean))];
    const stratHistArrays = stratIds.length
      ? await Promise.all(
          stratIds.map((sid) =>
            sbGet(
              `strategies_returns_c?select=strategy_id,as_of_date,basket_value,1d_pct,5d_pct,1m_pct,6m_pct,ytd_pct,1y_pct,5y_pct,all_pct&strategy_id=eq.${sid}&order=as_of_date.asc`
            )
          )
        )
      : [];
    const stratHist = stratHistArrays.flat();

    const [profiles, secMeta, secLive, txns] = await Promise.all([
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
    ]);

    res.statusCode = 200;
    res.end(JSON.stringify({ holdings, strategies, stratHist, profiles, secMeta, secLive, txns }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
};
