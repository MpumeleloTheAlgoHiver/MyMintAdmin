// Page-level access guard for the Mint admin portal.
// Each protected page sets `window.PAGE_ACCESS_KEY` and includes this script
// to enforce that only signed-in team members with the right role/page_access
// can view the page. It also hides nav links the user can't access.
//
// Public pages (signin, signup, forgot-password, reset-password) must NOT
// include this script.

(function () {
  const PAGE_KEY = window.PAGE_ACCESS_KEY || null;

  const NAV_PAGE_MAP = {
    '/index.html':      'clients',
    '/studio.html':     'studio',
    '/dashboard.html':  'dashboard',
    '/strategies.html': 'strategies',
    '/factsheets.html': 'factsheets',
    '/factsheet.html':  'factsheets',
    '/investors.html':  'investors',
    '/eft.html':        'eft',
    '/orderbook.html':  'orderbook',
    '/gifting.html':    'gifting',
    '/dividends.html':  'dividends',
    '/finances.html':   'finances',
    '/settings.html':    'settings',
    '/repair.html':      '__admin_only__',
    '/cyber-compliance.html': 'cyber-compliance',
    '/standup.html':          'standup',
    '/team.html':             '__admin_only__'
  };

  const getStoredToken = () => {
    try {
      const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      if (!key) return null;
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed?.access_token || null;
    } catch { return null; }
  };

  const redirectToSignIn = (reason) => {
    const target = '/signin.html' + (reason ? ('?reason=' + reason) : '');
    if (window.location.pathname !== '/signin.html') window.location.replace(target);
  };

  const applyNavVisibility = (role, pageAccess, approverTier) => {
    const isMasterAdmin = role === 'master_admin' || approverTier === 'master' || approverTier === 'dev';
    const isAdmin = role === 'admin' || isMasterAdmin;
    document.querySelectorAll('.nav-icon, [data-nav-page]').forEach(link => {
      const href = link.getAttribute('href') || '';
      const path = href.split('?')[0].split('#')[0];
      const key = link.getAttribute('data-nav-page') || NAV_PAGE_MAP[path];
      if (!key) return;
      if (key === '__admin_only__') {
        link.style.display = isMasterAdmin ? '' : 'none';
      } else if (!isAdmin && !pageAccess.includes(key)) {
        link.style.display = 'none';
      }
    });
  };

  // Helper available to page JS: check a granular permission.
  // Usage: window.mintCan('orderbook', 'edit_fill_price') → false | 'pending' | 'direct' | true
  const buildPermHelper = (permissions, approverTier, role) => {
    const isMasterAdmin = role === 'master_admin' || approverTier === 'master';
    return (section, field) => {
      // Master Admins and Devs bypass everything
      if (approverTier === 'dev' || isMasterAdmin) return true;
      if (!permissions || typeof permissions !== 'object') return false;
      const sec = permissions[section];
      if (!sec || typeof sec !== 'object') return false;
      return sec[field] !== undefined ? sec[field] : false;
    };
  };

  const run = async () => {
    const token = getStoredToken();
    if (!token) { redirectToSignIn('signin-required'); return; }

    let me;
    try {
      const r = await fetch('/api/team?action=me', { headers: { Authorization: 'Bearer ' + token } });
      me = await r.json();
    } catch {
      redirectToSignIn('network');
      return;
    }

    if (!me || !me.ok) {
      try {
        const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
        if (key) localStorage.removeItem(key);
      } catch {}
      redirectToSignIn(me?.error === 'Not a team member' ? 'not-a-member' : 'signin-required');
      return;
    }

    const role = me.role;
    const pageAccess = Array.isArray(me.page_access) ? me.page_access : [];
    const approverTier = me.approver_tier || null;
    const permissions = me.permissions || {};
    const isMasterAdmin = role === 'master_admin' || approverTier === 'master' || approverTier === 'dev';
    const isAdmin = role === 'admin' || isMasterAdmin;

    applyNavVisibility(role, pageAccess, approverTier);

    // Expose permission helper to page scripts
    window.mintCan = buildPermHelper(permissions, approverTier, role);
    window.mintMe = { role, pageAccess, approverTier, permissions, email: me.email };

    if (PAGE_KEY) {
      // '__admin_only__' = only master_admin or dev can access page level
      const allowed = PAGE_KEY === '__admin_only__'
        ? isMasterAdmin
        : isAdmin || pageAccess.includes(PAGE_KEY);
      if (!allowed) {
        document.title = 'Access Restricted';
        Array.from(document.body.children).forEach(child => {
          if (child.tagName !== 'ASIDE' && child.tagName !== 'SCRIPT' && child.id !== 'mint-sidebar-css') {
            child.style.display = 'none';
          }
        });
        
        const msgDiv = document.createElement('div');
        msgDiv.style.cssText = 'position:fixed;top:0;left:220px;right:0;bottom:0;display:flex;align-items:center;justify-content:center;background:#f2f2f7;z-index:999;flex-direction:column;gap:12px;';
        msgDiv.innerHTML = `
          <div style="background:#fff;padding:40px;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,0.05);text-align:center;max-width:400px;">
            <svg viewBox="0 0 24 24" style="width:48px;height:48px;fill:#ef4444;margin:0 auto 16px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.41 0 8 3.59 8 8 0 1.85-.63 3.55-1.69 4.9z"/></svg>
            <h2 style="font-size:20px;font-weight:600;color:#1c1c1e;margin-bottom:8px;font-family:-apple-system,sans-serif;">Access Restricted</h2>
            <p style="font-size:14px;color:#8e8e93;line-height:1.5;font-family:-apple-system,sans-serif;">You do not have access to this page. Please request access from an admin.</p>
          </div>
        `;
        document.body.appendChild(msgDiv);
        try { document.documentElement.style.opacity = '1'; } catch {}
        window.dispatchEvent(new CustomEvent('access-guard:ready', {
          detail: { role, page_access: pageAccess, approver_tier: approverTier, permissions, email: me.email }
        }));
        return;
      }
    }

    try { document.documentElement.style.opacity = '1'; } catch {}
    window.dispatchEvent(new CustomEvent('access-guard:ready', {
      detail: { role, page_access: pageAccess, approver_tier: approverTier, permissions, email: me.email }
    }));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
