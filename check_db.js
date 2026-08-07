require('dotenv').config();
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const email = 'mufaro.ncube@mymint.co.za';
fetch(`${SUPABASE_URL}/rest/v1/admin_team?email=eq.${encodeURIComponent(email)}`, {
  headers: {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  }
}).then(r => r.json()).then(console.log).catch(console.error);
