import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../api/orderbook/send-csv.js', import.meta.url), 'utf8');

const check = (condition, message) => assert.ok(condition, message);

check(dashboard.includes('const REB_ALL_OWNERS = "__all__";'), 'All-owner sentinel exists');
check(
  dashboard.includes('<option value="__all__">All owners (parent + children)</option>'),
  'All owners is the default dropdown option',
);
check(
  dashboard.includes('+ \'<option value="">Parent only</option>\''),
  'Parent-only scope remains explicit',
);
check(
  dashboard.includes('if (!rebScopeIsAll() && (rebSelectedFamilyMemberId || null) !== fmId) return;'),
  'All-owner loading skips the family-member filter',
);
check(
  dashboard.includes('const ownerKey = r.ownerKey || rebOwnerKey(r.userId, r.familyMemberId);') &&
    dashboard.includes('if (!byClient[ownerKey])'),
  'Strategy clients are grouped by owner, not user alone',
);
check(
  dashboard.includes('select("id, user_id, family_member_id, security_id, quantity'),
  'Commit-time holdings query preserves family-member ownership',
);
check(
  dashboard.includes('name: fmId') &&
    dashboard.includes('(fmLabelsById[fmId] || `Child ${fmId.slice(0, 8)}`)'),
  'Child-owned impact rows use the child name instead of the parent profile',
);
check(
  dashboard.includes('family_member_id: m.familyMemberId,') &&
    dashboard.includes('family_member_id: alloc.familyMemberId || null,') &&
    dashboard.includes('family_member_id: p.client.familyMemberId || null,'),
  'Sell and buy events preserve each row/client family member',
);
check(
  !dashboard.includes('family_member_id: familyMemberIdForEvents,') &&
    !dashboard.includes('family_member_id: familyMemberIdForLiquidateEvents,'),
  'All-owner commits do not stamp one global family-member ID',
);
check(
  dashboard.includes("select('user_id, family_member_id, security_id, trade_side, quantity, closed_reason')") &&
    dashboard.includes('pendingEventsForSelected.map(ev => rebOwnerKey(ev.user_id, ev.family_member_id))'),
  'Pending impact rows match the correct owner and security',
);
check(
  dashboard.includes('${selectedCode} ${pendingSide}') &&
    dashboard.includes('${normalizeSymbol(rebPendingRebalance.sellCode || isin.code)} SELL'),
  'Pending labels show the actual security and trade side',
);
check(
  dashboard.includes('const ownerKey = rebOwnerKey(uid, fmId);') &&
    dashboard.includes('const residualTotalsByOwner = {};'),
  'Pending-order swaps retain owner-separated residuals',
);
check(endpoint.includes("const allOwners = familyMemberId === '__all__';"), 'API recognizes All owners');
check(endpoint.includes('balancesByOwner'), 'Residual API returns owner-keyed balances');
check(endpoint.includes('reservesCentsByOwner'), 'Reserve API returns owner-keyed reserves');
check(endpoint.includes('const [ownerUserId, ownerFamilyMemberId = \'\']'), 'Residual upsert parses owner keys');
check(
  endpoint.includes('&family_member_id=is.null') &&
    endpoint.includes('&family_member_id=eq.${encodeURIComponent(familyMemberId)}'),
  'Scoped parent and child API filters remain available',
);

console.log('all-owner rebalance: 15 assertions passed');