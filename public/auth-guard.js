/**
 * auth-guard.js
 *
 * Include on every protected page AFTER the Supabase script tag.
 * Usage:
 *   <script>const PAGE_KEY = 'dashboard';</script>
 *   <script src="/auth-guard.js"></script>
 *
 * PAGE_KEY must match one of:
 *   profiles | dashboard | strategies | factsheets | investors | eft | orderbook | settings | team
 *
 * Behaviour:
 *  - No session → redirect to /signin.html
 *  - No admin_profiles row → redirect to /signin.html (not an admin user)
 *  - role === 'admin' → full access always
 *  - role === 'staff' && page not in page_permissions → redirect to first permitted page
 *
 * Exposes window.__adminProfile = { user_id, email, full_name, role, page_permissions }
 */

(async () => {
  const SUPABASE_URL = 'https://mfxnghmuccevsxwcetej.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1meG5naG11Y2NldnN4d2NldGVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTI1ODAsImV4cCI6MjA4NDQyODU4MH0.lktfglzBMaHd79hLFDRH1HHSwsEwZ56Tv6e287kQiFg';

  const PAGE_ORDER = ['profiles', 'dashboard', 'strategies', 'factsheets', 'investors', 'eft', 'orderbook', 'settings', 'team'];
  const PAGE_URLS = {
    profiles:   '/index.html',
    dashboard:  '/dashboard.html',
    strategies: '/strategies.html',
    factsheets: '/factsheets.html',
    investors:  '/investors.html',
    eft:        '/eft.html',
    orderbook:  '/orderbook.html',
    settings:   '/settings.html',
    team:       '/team.html',
  };

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  console.log('[auth-guard] Checking session...');
  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    console.error('[auth-guard] No session found, redirecting to signin');
    document.body.innerHTML = '<h1 style="padding:20px;font-family:monospace;">No session found. Redirecting to signin in 5 seconds...</h1><p style="padding:20px;font-family:monospace;">Check console logs above ↑</p>';
    await new Promise(r => setTimeout(r, 5000));
    window.location.replace('/signin.html');
    return;
  }

  console.log('[auth-guard] Session found for user:', session.user.id);
  const { data: profile, error } = await client
    .from('admin_profiles')
    .select('user_id, email, full_name, role, page_permissions')
    .eq('user_id', session.user.id)
    .single();

  if (error) {
    console.error('[auth-guard] Query error:', error);
    document.body.innerHTML = `<h1 style="padding:20px;font-family:monospace;color:red;">Error loading profile: ${error.message}</h1><p style="padding:20px;font-family:monospace;">Check console logs above ↑</p><p style="padding:20px;font-family:monospace;">Redirecting in 5 seconds...</p>`;
    await new Promise(r => setTimeout(r, 5000));
    await client.auth.signOut();
    window.location.replace('/signin.html');
    return;
  }
  if (!profile) {
    console.error('[auth-guard] No admin_profiles row found, signing out');
    document.body.innerHTML = '<h1 style="padding:20px;font-family:monospace;color:red;">User not in admin_profiles table</h1><p style="padding:20px;font-family:monospace;">Check console logs above ↑</p><p style="padding:20px;font-family:monospace;">Redirecting in 5 seconds...</p>';
    await new Promise(r => setTimeout(r, 5000));
    await client.auth.signOut();
    window.location.replace('/signin.html');
    return;
  }
  console.log('[auth-guard] Profile loaded:', profile);

  window.__adminProfile = profile;

  // Admins bypass all page checks
  if (profile.role === 'admin') {
    revealPage();
    renderSidebar(profile);
    return;
  }

  // Staff: check current page permission
  const currentPage = typeof PAGE_KEY !== 'undefined' ? PAGE_KEY : null;
  if (currentPage && !profile.page_permissions.includes(currentPage)) {
    // Redirect to the first page they have access to
    const first = PAGE_ORDER.find(p => profile.page_permissions.includes(p));
    window.location.replace(first ? PAGE_URLS[first] : '/signin.html');
    return;
  }

  revealPage();
  renderSidebar(profile);

  function revealPage() {
    document.documentElement.style.opacity = '1';
  }

  function renderSidebar(profile) {
    // Hide nav links the user can't access (staff only)
    if (profile.role === 'staff') {
      Object.entries(PAGE_URLS).forEach(([key, url]) => {
        if (!profile.page_permissions.includes(key)) {
          const link = document.querySelector(`.nav-icon[href="${url}"]`);
          if (link) link.style.display = 'none';
        }
      });
    }

    // Update sidebar role label
    const roleEl = document.querySelector('.sidebar-user-role');
    if (roleEl) {
      roleEl.textContent = profile.role === 'admin' ? 'Administrator' : 'Staff';
    }

    // Update sidebar email + avatar initial
    const emailEl = document.getElementById('sidebarUserEmail');
    const avatarEl = document.getElementById('sidebarAvatarInitials');
    const display = profile.full_name || profile.email || '';
    if (emailEl && display) emailEl.textContent = display;
    if (avatarEl && display) avatarEl.textContent = display.charAt(0).toUpperCase();
  }
})();
