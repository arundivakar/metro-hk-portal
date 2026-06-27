const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function applyMigration() {
  const sql = fs.readFileSync('./supabase/migrations/017_fix_import_fn.sql', 'utf8');
  const { error } = await supabase.rpc('exec_sql', { query: sql }).catch(() => ({ error: { message: 'exec_sql not available' } }));
  
  if (error) {
    // Try via REST
    const url = `${env.VITE_SUPABASE_URL}/rest/v1/rpc/exec_sql`;
    console.log('exec_sql not available, please run this SQL manually in Supabase SQL Editor:');
    console.log('\n--- SQL TO RUN ---\n');
    console.log(sql);
    console.log('\n--- END SQL ---\n');
  } else {
    console.log('Migration applied successfully!');
  }
}
applyMigration();
