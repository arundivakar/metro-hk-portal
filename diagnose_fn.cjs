// Use Supabase REST API to query pg_proc for the function source
const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env'));

async function getFunctionSource() {
  const response = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/get_fn_source`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.VITE_SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.VITE_SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ func_name: 'fn_import_master_list' })
  });
  
  // Instead use direct REST query to pg_catalog via PostgREST
  const resp2 = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/`, {
    headers: {
      'apikey': env.VITE_SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.VITE_SUPABASE_SERVICE_ROLE_KEY}`,
    }
  });

  // Actually, the best way is to run a SELECT via RPC that returns the prosrc
  // Let's use the SQL Editor approach via the management API
  console.log('The live function cannot be read via REST without a custom RPC.');
  console.log('Running a targeted diagnostic instead...');
  
  // Call with a single item and check if we get 1 or 2 back
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);
  
  await supabase.rpc('fn_wipe_database');
  
  const singleItem = [
    { 'Cleaning Material': 'DIAGNOSTIC_TEST_ITEM', 'Chemical/Consumable': 'Consumable', 'Unit': 'Nos', 'Rate including GST': '1', 'Brand': 'TestBrand', 'Tender Year': '2024' }
  ];
  
  console.log('Calling fn_import_master_list with exactly 1 item...');
  await supabase.rpc('fn_import_master_list', { p_payload: singleItem });
  
  const { data: items } = await supabase.from('inventory_items').select('id, name, created_at').order('created_at');
  console.log('inventory_items count:', items.length);
  console.log('inventory_items rows:', items);
  
  const { data: rm } = await supabase.from('rate_master').select('id, item_name, created_at').order('created_at');
  console.log('rate_master count:', rm.length);
  console.log('rate_master rows:', rm);
}
getFunctionSource();
