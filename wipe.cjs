const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function fix() {
  console.log('Wiping database...');
  const { error: wipeErr } = await supabase.rpc('fn_wipe_database');
  console.log('Wipe result:', wipeErr || 'Success');
}
fix();
