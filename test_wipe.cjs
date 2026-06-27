const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);
async function test() {
  const { error } = await supabase.rpc('fn_wipe_database');
  console.log('Wipe error:', error);
  const { count } = await supabase.from('inventory_items').select('*', { count: 'exact', head: true });
  console.log('Count after wipe:', count);
}
test();
