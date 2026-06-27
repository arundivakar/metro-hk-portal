const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env'));

// Use Supabase Management API to run SQL directly
async function runSQL(sql) {
  const projectRef = env.VITE_SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');
  
  // Try via REST using service role - pg_catalog query via a raw query approach
  const resp = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/exec_raw_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.VITE_SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.VITE_SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ sql })
  });
  const text = await resp.text();
  return { status: resp.status, body: text };
}

async function checkOverloads() {
  // Check how many fn_import_master_list overloads exist by checking what happens 
  // when we call it and trace the inserts
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

  // Wipe
  await supabase.rpc('fn_wipe_database');
  
  // Insert ONE item with a very specific name that won't have brand appended
  const testPayload = [
    { 'Cleaning Material': 'XTEST_ITEM_001', 'Chemical/Consumable': 'Consumable', 'Unit': 'Nos', 'Rate including GST': '5', 'Brand': 'XBRAND', 'Tender Year': '2024' }
  ];
  
  console.log('Calling fn_import_master_list with 1 item...');
  const { data, error } = await supabase.rpc('fn_import_master_list', { p_payload: testPayload });
  if (error) { console.error('Error:', error); return; }
  
  // Check both tables
  const { data: rm } = await supabase.from('rate_master').select('id, item_name, brand, created_at');
  const { data: ii } = await supabase.from('inventory_items').select('id, name, rate_master_id, created_at');
  
  console.log('\n--- rate_master (' + rm.length + ' rows) ---');
  rm.forEach(r => console.log(' ', r.item_name, '| brand:', r.brand));
  
  console.log('\n--- inventory_items (' + ii.length + ' rows) ---');
  ii.forEach(r => console.log(' ', r.name, '| rate_master_id:', r.rate_master_id));
  
  // Check if the rate_master_id is the same for both inventory_items (should be)
  if (ii.length === 2) {
    console.log('\nBoth inventory_items linked to same rate_master?', ii[0].rate_master_id === ii[1].rate_master_id);
    console.log('This means the function body itself creates 2 inventory_items per 1 rate_master row.');
    console.log('\n>>> The DROP did NOT work. The old function is STILL alive.');
    console.log('>>> You need to run this in Supabase SQL Editor:');
    console.log(`
SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args, p.oid
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'fn_import_master_list' AND n.nspname = 'public';
`);
    console.log('This will show ALL overloads. Share the output here.');
  }
}
checkOverloads();
