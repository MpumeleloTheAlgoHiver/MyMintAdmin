'use strict';
/**
 * Gifting API — admin endpoint for viewing and managing investment gifts.
 * Queries both gift_authorizations (new registry-based gifts) and
 * gift_claims (legacy direct gifts), normalises them into a single shape,
 * and exposes fill / cancel / approve / reject actions.
 */
const { fetchSupabaseJson, requestSupabaseJson, sendJson } = require('./_orderbook');

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });

const enc = (v) => encodeURIComponent(String(v));

/** Verify that the bearer token is a valid Supabase session. */
async function verifyToken(token) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Supabase not configured');
  const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: serviceKey },
  });
  if (!resp.ok) throw new Error('Invalid or expired session');
  return resp.json();
}

/** Normalise a gift_authorizations row into a display record. */
function normalizeAuthorization(auth, itemsById, eventsById, profilesById) {
  const item = auth.registry_item_id ? itemsById[auth.registry_item_id] : null;
  const event = item?.gift_event_id ? eventsById[item.gift_event_id] : null;
  const gifterProfile = auth.gifter_user_id ? profilesById[auth.gifter_user_id] : null;
  const recipProfile = auth.recipient_user_id ? profilesById[auth.recipient_user_id] : null;

  const gifterName =
    [gifterProfile?.first_name, gifterProfile?.last_name].filter(Boolean).join(' ') ||
    auth.gifter_email ||
    'Unknown';
  const recipName = recipProfile
    ? [recipProfile.first_name, recipProfile.last_name].filter(Boolean).join(' ') || recipProfile.email
    : event?.beneficiary_display_name || null;

  return {
    _source: 'authorization',
    id: auth.id,
    created_at: auth.created_at,
    updated_at: auth.updated_at,
    gifter_user_id: auth.gifter_user_id,
    gifter_email: auth.gifter_email,
    gifter_name: gifterName,
    recipient_user_id: auth.recipient_user_id,
    recipient_name: recipName,
    isin: item?.isin || null,
    instrument_type: item?.instrument_type || null,
    asset_name: event?.title || item?.isin || null,
    occasion: event?.occasion || null,
    quantity: auth.quantity,
    live_price_cents: auth.live_price_cents,
    max_acceptable_fill_cents: auth.max_acceptable_fill_cents,
    drift_bps: auth.drift_bps,
    reserved_amount_cents: auth.reserved_amount_cents,
    paid_amount_cents: auth.paid_amount_cents,
    fill_price_cents: auth.fill_price_cents,
    fill_quantity: auth.fill_quantity,
    fill_reference: auth.fill_reference,
    status: auth.status,
    expires_at: auth.expires_at,
    pending_decision_deadline: auth.pending_decision_deadline,
  };
}

/** Normalise a legacy gift_claims row. */
function normalizeClaim(claim, profilesById) {
  const senderProfile = claim.sender_user_id ? profilesById[claim.sender_user_id] : null;
  const recipProfile = claim.recipient_user_id ? profilesById[claim.recipient_user_id] : null;

  const gifterName = senderProfile
    ? [senderProfile.first_name, senderProfile.last_name].filter(Boolean).join(' ') || senderProfile.email
    : 'Unknown';
  const recipName = recipProfile
    ? [recipProfile.first_name, recipProfile.last_name].filter(Boolean).join(' ') || recipProfile.email
    : claim.recipient_identifier || null;

  let status = 'AUTHORIZED';
  if (claim.cancelled_at || claim.status === 'cancelled') status = 'CANCELLED';
  else if (claim.status === 'claimed' || claim.claimed_at) status = 'FILLED';
  else if (claim.refunded_at) status = 'CANCELLED';
  else if (claim.status === 'expired' || (claim.expires_at && new Date(claim.expires_at).getTime() < Date.now())) status = 'EXPIRED';

  return {
    _source: 'claim',
    id: claim.id,
    created_at: claim.created_at,
    updated_at: claim.claimed_at || claim.refunded_at || claim.created_at,
    gifter_user_id: claim.sender_user_id,
    gifter_email: senderProfile?.email || null,
    gifter_name: gifterName,
    recipient_user_id: claim.recipient_user_id,
    recipient_name: recipName,
    isin: null,
    instrument_type: claim.asset_type || null,
    asset_name: claim.asset_name || null,
    occasion: null,
    quantity: null,
    live_price_cents: null,
    max_acceptable_fill_cents: null,
    drift_bps: null,
    reserved_amount_cents: claim.amount || null,
    paid_amount_cents: (claim.status === 'claimed' || claim.claimed_at) ? (claim.amount || null) : null,
    fill_price_cents: null,
    fill_quantity: null,
    fill_reference: null,
    status,
    expires_at: claim.expires_at,
    pending_decision_deadline: null,
  };
}

module.exports = async function giftingHandler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return sendJson(res, 401, { error: 'Unauthorized' });

  try {
    await verifyToken(token);
  } catch (e) {
    return sendJson(res, 401, { error: e.message || 'Unauthorized' });
  }

  const urlObj = new URL(req.url, 'http://localhost');
  const action = urlObj.searchParams.get('action') || 'list';

  // ── GET /api/gifting?action=list ─────────────────────────────────────────
  if (req.method === 'GET' && action === 'list') {
    try {
      // 1. gift_authorizations (new registry-based gifts)
      let authorizations = [];
      try {
        const rows = await fetchSupabaseJson(
          '/rest/v1/gift_authorizations?' +
          'select=id,gifter_user_id,gifter_email,quantity,live_price_cents,' +
          'max_acceptable_fill_cents,drift_bps,reserved_amount_cents,paid_amount_cents,' +
          'fill_price_cents,fill_quantity,fill_reference,status,expires_at,' +
          'pending_decision_deadline,created_at,updated_at,registry_item_id,recipient_user_id' +
          '&order=created_at.desc&limit=1000'
        );
        if (Array.isArray(rows)) authorizations = rows;
      } catch (e) {
        console.warn('[gifting] gift_authorizations unavailable:', e.message);
      }

      // 2. gift_claims (legacy direct gifts)
      let claims = [];
      try {
        const rows = await fetchSupabaseJson(
          '/rest/v1/gift_claims?' +
          'select=id,sender_user_id,recipient_user_id,recipient_identifier,' +
          'amount,asset_type,asset_name,status,expires_at,reserved_at,' +
          'refunded_at,created_at,claimed_at,cancelled_at' +
          '&order=created_at.desc&limit=1000'
        );
        if (Array.isArray(rows)) claims = rows;
      } catch (e) {
        console.warn('[gifting] gift_claims unavailable:', e.message);
      }

      // 3. registry items for authorizations
      const itemsById = {};
      const itemIds = [...new Set(authorizations.map((a) => a.registry_item_id).filter(Boolean))];
      if (itemIds.length) {
        try {
          const items = await fetchSupabaseJson(
            `/rest/v1/gift_registry_items?id=in.(${itemIds.map(enc).join(',')})` +
            '&select=id,gift_event_id,isin,instrument_type,target_quantity,price_snapshot_cents'
          );
          (items || []).forEach((item) => { itemsById[item.id] = item; });
        } catch (e) {
          console.warn('[gifting] gift_registry_items unavailable:', e.message);
        }
      }

      // 4. gift events
      const eventsById = {};
      const eventIds = [...new Set(Object.values(itemsById).map((i) => i.gift_event_id).filter(Boolean))];
      if (eventIds.length) {
        try {
          const events = await fetchSupabaseJson(
            `/rest/v1/gift_events?id=in.(${eventIds.map(enc).join(',')})` +
            '&select=id,title,occasion,beneficiary_display_name,beneficiary_type'
          );
          (events || []).forEach((ev) => { eventsById[ev.id] = ev; });
        } catch (e) {
          console.warn('[gifting] gift_events unavailable:', e.message);
        }
      }

      // 5. profiles for all user IDs
      const profilesById = {};
      const allUserIds = [
        ...new Set([
          ...authorizations.flatMap((a) => [a.gifter_user_id, a.recipient_user_id]),
          ...claims.flatMap((c) => [c.sender_user_id, c.recipient_user_id]),
        ].filter(Boolean)),
      ];
      if (allUserIds.length) {
        try {
          const profiles = await fetchSupabaseJson(
            `/rest/v1/profiles?id=in.(${allUserIds.map(enc).join(',')})` +
            '&select=id,first_name,last_name,email'
          );
          (profiles || []).forEach((p) => { profilesById[p.id] = p; });
        } catch (e) {
          console.warn('[gifting] profiles unavailable:', e.message);
        }
      }

      // 6. Normalise + combine + sort
      const gifts = [
        ...authorizations.map((a) => normalizeAuthorization(a, itemsById, eventsById, profilesById)),
        ...claims.map((c) => normalizeClaim(c, profilesById)),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // 7. Compute stats
      const stats = {
        total: gifts.length,
        pending: 0,
        needs_approval: 0,
        filled: 0,
        cancelled: 0,
        expired: 0,
        total_reserved_cents: 0,
      };
      gifts.forEach((g) => {
        if (['AUTHORIZED', 'PARKED', 'WORKING'].includes(g.status)) stats.pending++;
        else if (g.status === 'PENDING_GIFTER_APPROVAL') stats.needs_approval++;
        else if (g.status === 'FILLED') stats.filled++;
        else if (['CANCELLED', 'AUTO_CANCELLED', 'REJECTED', 'FAILED'].includes(g.status)) stats.cancelled++;
        else if (g.status === 'EXPIRED') stats.expired++;
        if (g.reserved_amount_cents) stats.total_reserved_cents += Number(g.reserved_amount_cents);
      });

      return sendJson(res, 200, { gifts, stats });
    } catch (err) {
      console.error('[gifting] list error:', err);
      return sendJson(res, 500, { error: err.message || 'Internal error' });
    }
  }

  // ── POST mutations ───────────────────────────────────────────────────────
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  let body;
  try { body = await readBody(req); }
  catch (e) { return sendJson(res, 400, { error: 'Invalid request body' }); }

  const { id } = body || {};
  if (!id) return sendJson(res, 400, { error: 'id is required' });

  const now = new Date().toISOString();

  // FILL — admin enters actual fill price + qty
  if (action === 'fill') {
    const { fill_price_cents, fill_quantity } = body;
    if (!fill_price_cents || !fill_quantity)
      return sendJson(res, 400, { error: 'fill_price_cents and fill_quantity are required' });
    try {
      await requestSupabaseJson(`/rest/v1/gift_authorizations?id=eq.${enc(id)}`, {
        method: 'PATCH',
        body: {
          status: 'FILLED',
          fill_price_cents: Number(fill_price_cents),
          fill_quantity: Number(fill_quantity),
          paid_amount_cents: Math.round(Number(fill_price_cents) * Number(fill_quantity)),
          updated_at: now,
        },
      });
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || 'Fill failed' });
    }
  }

  // CANCEL — admin cancels a pending gift
  if (action === 'cancel') {
    try {
      await requestSupabaseJson(`/rest/v1/gift_authorizations?id=eq.${enc(id)}`, {
        method: 'PATCH',
        body: { status: 'CANCELLED', updated_at: now },
      });
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || 'Cancel failed' });
    }
  }

  // APPROVE — admin approves a PENDING_GIFTER_APPROVAL fill (fills above ceiling)
  if (action === 'approve') {
    const { fill_price_cents, fill_quantity } = body;
    try {
      const patch = { status: 'FILLED', updated_at: now };
      if (fill_price_cents) patch.fill_price_cents = Number(fill_price_cents);
      if (fill_quantity) patch.fill_quantity = Number(fill_quantity);
      if (fill_price_cents && fill_quantity)
        patch.paid_amount_cents = Math.round(Number(fill_price_cents) * Number(fill_quantity));
      await requestSupabaseJson(`/rest/v1/gift_authorizations?id=eq.${enc(id)}`, {
        method: 'PATCH',
        body: patch,
      });
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || 'Approve failed' });
    }
  }

  // REJECT — admin rejects a PENDING_GIFTER_APPROVAL (cancels the gift)
  if (action === 'reject') {
    try {
      await requestSupabaseJson(`/rest/v1/gift_authorizations?id=eq.${enc(id)}`, {
        method: 'PATCH',
        body: { status: 'CANCELLED', updated_at: now },
      });
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || 'Reject failed' });
    }
  }

  return sendJson(res, 400, { error: `Unknown action: ${action}` });
};
