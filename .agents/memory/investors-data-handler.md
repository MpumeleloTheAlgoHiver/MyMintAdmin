---
name: investors-data-handler
description: Why server.js delegates /api/investors/data to api/investors/data.js and what breaks if duplicated inline
---

# investors-data-handler

## The rule
`server.js` must NOT contain an inline implementation of `/api/investors/data`. It must delegate:
```javascript
if (req.url === '/api/investors/data' && req.method === 'GET') {
  await require('./api/investors/data')(req, res);
  return;
}
```

**Why:** A stale inline copy existed in server.js that omitted `transaction_id`, `family_member_id`, `expected_fill` from the holdings select, and omitted `id`, `buffer_cents`, `buffer_consumed_cents` from the transactions select. This made all investors show R0 cash (buffer cash calculation silently failed). The canonical implementation lives in `api/investors/data.js`.

**How to apply:** If buffer cash / spreadsheet cash ever shows R0, first check whether server.js has re-introduced an inline handler that shadows api/investors/data.js.

## Test accounts
MPUMELELO MASWANGANYE (user_id `b215eb9a-4017-45f1-a460-6056b1db0c4d`) has `is_test = true` in profiles. The canonical handler filters test users out of investors.html by design (per replit.md). If they need to be visible, set `is_test = false` in Supabase.
