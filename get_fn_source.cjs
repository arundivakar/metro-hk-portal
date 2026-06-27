// Dump the source of fn_import_master_list from the live DB
const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function getSource() {
  // Query pg_proc directly via rpc
  const { data, error } = await supabase
    .from('pg_proc')
    .select('prosrc')
    .eq('proname', 'fn_import_master_list');
  
  if (error) {
    console.log('Cannot read pg_proc directly:', error.message);
    // Try via supabase rpc
    const { data: d2, error: e2 } = await supabase.rpc('fn_get_function_source', { func_name: 'fn_import_master_list' });
    console.log('rpc result:', d2, e2);
  } else {
    console.log('Source:\n', data);
  }
}
getSource();
