/**
 * RBAC / Permissions unit tests
 * Covers the pure logic from access-guard.js and api/team.js.
 * Zero live network calls — no DB, no Supabase, no Resend.
 */

'use strict';

const assert = require('assert');

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${label}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract pure logic from access-guard.js (mirrored exactly — do not drift)
// ─────────────────────────────────────────────────────────────────────────────

const NAV_PAGE_MAP = {
  '/index.html':      'clients',
  '/dashboard.html':  'dashboard',
  '/strategies.html': 'strategies',
  '/factsheets.html': 'factsheets',
  '/factsheet.html':  'factsheets',
  '/investors.html':  'investors',
  '/eft.html':        'eft',
  '/orderbook.html':  'orderbook',
  '/settings.html':    'settings',
  '/cyber-compliance.html': 'cyber-compliance',
  '/team.html':             '__admin_only__',
};

/** Mirrors buildPermHelper in access-guard.js */
function buildPermHelper(permissions, approverTier) {
  return (section, field) => {
    if (approverTier === 'dev') return true;
    if (!permissions || typeof permissions !== 'object') return false;
    const sec = permissions[section];
    if (!sec || typeof sec !== 'object') return false;
    return sec[field] !== undefined ? sec[field] : false;
  };
}

/** Mirrors the PAGE_KEY access check in access-guard.js run() */
function isPageAllowed(PAGE_KEY, role, pageAccess) {
  if (!PAGE_KEY) return true;
  return PAGE_KEY === '__admin_only__'
    ? role === 'admin'
    : role === 'admin' || pageAccess.includes(PAGE_KEY);
}

/** Mirrors applyNavVisibility in access-guard.js */
function visibleNavLinks(role, pageAccess) {
  const isAdmin = role === 'admin';
  const visible = [];
  for (const [path, key] of Object.entries(NAV_PAGE_MAP)) {
    if (key === '__admin_only__') {
      if (isAdmin) visible.push(path);
    } else if (isAdmin || pageAccess.includes(key)) {
      visible.push(path);
    }
  }
  return visible;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extract pure validation logic from api/team.js (mirrored exactly)
// ─────────────────────────────────────────────────────────────────────────────

const VALID_TIERS = [null, '', 'master', 'dev'];

function sanitizeTier(approver_tier) {
  return VALID_TIERS.includes(approver_tier) ? (approver_tier || null) : null;
}

function sanitizePermissions(permissions) {
  return permissions && typeof permissions === 'object' && !Array.isArray(permissions)
    ? permissions
    : {};
}

function sanitizePageAccess(role, page_access) {
  const safeRole = role === 'admin' ? 'admin' : 'staff';
  return safeRole === 'admin' ? [] : (Array.isArray(page_access) ? page_access : []);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — buildPermHelper / mintCan
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Suite 1: buildPermHelper (mintCan logic) ──');

test('dev approver_tier bypasses all checks → always true', () => {
  const can = buildPermHelper({}, 'dev');
  assert.strictEqual(can('orderbook', 'edit_fill_price'), true);
  assert.strictEqual(can('eft', 'approve_deposits'), true);
  assert.strictEqual(can('nonexistent', 'field'), true);
});

test('master approver_tier does NOT bypass — follows permissions', () => {
  const perms = { orderbook: { send_confirmation: 'direct' } };
  const can = buildPermHelper(perms, 'master');
  assert.strictEqual(can('orderbook', 'send_confirmation'), 'direct');
  assert.strictEqual(can('orderbook', 'edit_fill_price'), false);
});

test('null permissions → all fields return false', () => {
  const can = buildPermHelper(null, null);
  assert.strictEqual(can('eft', 'approve_deposits'), false);
  assert.strictEqual(can('dashboard', 'sync_fundamentals'), false);
});

test('empty permissions object → unknown section returns false', () => {
  const can = buildPermHelper({}, null);
  assert.strictEqual(can('strategies', 'manage_strategies'), false);
});

test('known section, known field → returns stored value', () => {
  const perms = {
    eft: { approve_deposits: 'pending', manual_funds: false },
    dashboard: { view_financials: true, sync_fundamentals: false, commit_rebalance: 'direct' },
  };
  const can = buildPermHelper(perms, null);
  assert.strictEqual(can('eft', 'approve_deposits'), 'pending');
  assert.strictEqual(can('eft', 'manual_funds'), false);
  assert.strictEqual(can('dashboard', 'view_financials'), true);
  assert.strictEqual(can('dashboard', 'sync_fundamentals'), false);
  assert.strictEqual(can('dashboard', 'commit_rebalance'), 'direct');
});

test('known section, unknown field → returns false', () => {
  const perms = { eft: { approve_deposits: true } };
  const can = buildPermHelper(perms, null);
  assert.strictEqual(can('eft', 'nonexistent_field'), false);
});

test('permissions is an array (malformed) → all return false', () => {
  const can = buildPermHelper([{ eft: true }], null);
  assert.strictEqual(can('eft', 'approve_deposits'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Page-level access check
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Suite 2: isPageAllowed (page_access enforcement) ──');

test('null PAGE_KEY → always allowed (auth-only guard)', () => {
  assert.strictEqual(isPageAllowed(null, 'staff', []), true);
  assert.strictEqual(isPageAllowed(null, 'admin', []), true);
});

test('__admin_only__ + admin role → allowed', () => {
  assert.strictEqual(isPageAllowed('__admin_only__', 'admin', []), true);
});

test('__admin_only__ + staff role → blocked', () => {
  assert.strictEqual(isPageAllowed('__admin_only__', 'staff', ['clients', 'eft']), false);
});

test('regular page key + admin role → allowed regardless of page_access', () => {
  assert.strictEqual(isPageAllowed('orderbook', 'admin', []), true);
  assert.strictEqual(isPageAllowed('eft', 'admin', ['clients']), true);
});

test('regular page key + staff with key in page_access → allowed', () => {
  assert.strictEqual(isPageAllowed('eft', 'staff', ['clients', 'eft', 'orderbook']), true);
});

test('regular page key + staff without key in page_access → blocked', () => {
  assert.strictEqual(isPageAllowed('eft', 'staff', ['clients', 'dashboard']), false);
  assert.strictEqual(isPageAllowed('orderbook', 'staff', []), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Nav visibility
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Suite 3: visibleNavLinks (nav hiding) ──');

test('admin sees ALL nav links including team.html', () => {
  const visible = visibleNavLinks('admin', []);
  assert.ok(visible.includes('/team.html'), 'admin sees team.html');
  assert.ok(visible.includes('/index.html'), 'admin sees index.html');
  assert.ok(visible.includes('/orderbook.html'), 'admin sees orderbook.html');
});

test('staff with no page_access sees NO nav links (and NOT team.html)', () => {
  const visible = visibleNavLinks('staff', []);
  assert.strictEqual(visible.length, 0);
});

test('staff with page_access sees only their allowed links (never team.html)', () => {
  const visible = visibleNavLinks('staff', ['eft', 'orderbook']);
  assert.ok(visible.includes('/eft.html'), 'sees eft');
  assert.ok(visible.includes('/orderbook.html'), 'sees orderbook');
  assert.ok(!visible.includes('/team.html'), 'does NOT see team.html');
  assert.ok(!visible.includes('/index.html'), 'does NOT see clients');
  assert.ok(!visible.includes('/dashboard.html'), 'does NOT see dashboard');
});

test('factsheet.html and factsheets.html share the "factsheets" key', () => {
  const visible = visibleNavLinks('staff', ['factsheets']);
  assert.ok(visible.includes('/factsheets.html'));
  assert.ok(visible.includes('/factsheet.html'));
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Server-side sanitization (api/team.js)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Suite 4: Server-side input sanitization ──');

test('sanitizeTier: valid tiers pass through', () => {
  assert.strictEqual(sanitizeTier('dev'), 'dev');
  assert.strictEqual(sanitizeTier('master'), 'master');
  assert.strictEqual(sanitizeTier(null), null);
  assert.strictEqual(sanitizeTier(''), null);   // empty string normalised to null
});

test('sanitizeTier: invalid tiers coerced to null', () => {
  assert.strictEqual(sanitizeTier('def'), null);       // historical typo
  assert.strictEqual(sanitizeTier('superadmin'), null);
  assert.strictEqual(sanitizeTier('owner'), null);
  assert.strictEqual(sanitizeTier('admin'), null);
  assert.strictEqual(sanitizeTier(42), null);
  assert.strictEqual(sanitizeTier(undefined), null);
});

test('sanitizePermissions: plain object passes through unchanged', () => {
  const p = { eft: { approve_deposits: true } };
  assert.deepStrictEqual(sanitizePermissions(p), p);
});

test('sanitizePermissions: array → coerced to {}', () => {
  assert.deepStrictEqual(sanitizePermissions([1, 2, 3]), {});
});

test('sanitizePermissions: string → coerced to {}', () => {
  assert.deepStrictEqual(sanitizePermissions('true'), {});
});

test('sanitizePermissions: null → coerced to {}', () => {
  assert.deepStrictEqual(sanitizePermissions(null), {});
});

test('sanitizePermissions: undefined → coerced to {}', () => {
  assert.deepStrictEqual(sanitizePermissions(undefined), {});
});

test('sanitizePageAccess: admin role forces page_access to []', () => {
  assert.deepStrictEqual(sanitizePageAccess('admin', ['eft', 'orderbook']), []);
  assert.deepStrictEqual(sanitizePageAccess('admin', null), []);
});

test('sanitizePageAccess: staff role preserves valid array', () => {
  assert.deepStrictEqual(sanitizePageAccess('staff', ['eft', 'clients']), ['eft', 'clients']);
});

test('sanitizePageAccess: staff with non-array page_access → coerced to []', () => {
  assert.deepStrictEqual(sanitizePageAccess('staff', null), []);
  assert.deepStrictEqual(sanitizePageAccess('staff', 'eft'), []);
  assert.deepStrictEqual(sanitizePageAccess('staff', 123), []);
});

test('sanitizePageAccess: unknown role treated as staff', () => {
  assert.deepStrictEqual(sanitizePageAccess('superadmin', ['eft']), ['eft']);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — mintCan integration contracts (page-level expectations)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Suite 5: mintCan integration contracts ──');

test('eft approve_deposits: false → isApprover must be false', () => {
  const can = buildPermHelper({ eft: { approve_deposits: false } }, null);
  const isApprover = !!can('eft', 'approve_deposits');
  assert.strictEqual(isApprover, false);
});

test('eft approve_deposits: "direct" → isApprover is truthy', () => {
  const can = buildPermHelper({ eft: { approve_deposits: 'direct' } }, null);
  const isApprover = !!can('eft', 'approve_deposits');
  assert.strictEqual(isApprover, true);
});

test('eft approve_deposits: "pending" → isApprover is truthy (pending still shows button)', () => {
  const can = buildPermHelper({ eft: { approve_deposits: 'pending' } }, null);
  const isApprover = !!can('eft', 'approve_deposits');
  assert.strictEqual(isApprover, true);
});

test('dashboard commit_rebalance: false → rebPermBlocked should be set', () => {
  const can = buildPermHelper({ dashboard: { commit_rebalance: false } }, null);
  const rebPerm = can('dashboard', 'commit_rebalance');
  assert.strictEqual(rebPerm === false, true);
});

test('dashboard commit_rebalance: "direct" → rebPermBlocked must NOT be set', () => {
  const can = buildPermHelper({ dashboard: { commit_rebalance: 'direct' } }, null);
  const rebPerm = can('dashboard', 'commit_rebalance');
  assert.notStrictEqual(rebPerm, false);
});

test('strategies manage_strategies: false → submit button disabled', () => {
  const can = buildPermHelper({ strategies: { manage_strategies: false } }, null);
  assert.strictEqual(can('strategies', 'manage_strategies'), false);
});

test('strategies change_visibility: "pending" → Public checkbox disabled with pending message', () => {
  const can = buildPermHelper({ strategies: { change_visibility: 'pending' } }, null);
  const visPerm = can('strategies', 'change_visibility');
  assert.strictEqual(visPerm, 'pending');
  const shouldDisable = !visPerm || visPerm === 'pending';
  assert.strictEqual(shouldDisable, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(52)}`);
if (failed === 0) {
  console.log(`✅  All ${passed} tests passed.`);
} else {
  console.log(`❌  ${failed} failed, ${passed} passed (${passed + failed} total)`);
  process.exit(1);
}
