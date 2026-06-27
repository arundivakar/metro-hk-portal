const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await supabase.rpc('fn_get_func_def');
  // just read from pg_proc
  const { data: procs, error: err } = await supabase
    .from('pg_proc')
    .select('prosrc')
    .eq('proname', 'fn_import_station_stock');
  console.log(procs || err);
}
check();
