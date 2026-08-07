require('dotenv').config();
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing env vars');
  process.exit(1);
}
const email = 'mufaro.ncube@mymint.co.za';
fetch(`${supabaseUrl}/rest/v1/admin_team?email=eq.${encodeURIComponent(email)}`, {
  headers: { 'apikey': serviceRoleKey, 'Authorization': `Bearer ${serviceRoleKey}` }
}).then(r => r.json()).then(console.log).catch(console.error);
