// Direct test: wipe, then call fn_import_master_list with exactly 3 known items
// Then check if DB has 3 or 6 items (to confirm if double-insert is happening)
const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

const TEST_PAYLOAD = [
  { 'Cleaning Material': 'Test Item Alpha', 'Chemical/Consumable': 'Consumable', 'Unit': 'Nos', 'Rate including GST': '10', 'Brand': 'BrandA', 'Tender Year': '2024' },
  { 'Cleaning Material': 'Test Item Beta', 'Chemical/Consumable': 'Chemical', 'Unit': 'Ltr', 'Rate including GST': '20', 'Brand': 'BrandB', 'Tender Year': '2024' },
  { 'Cleaning Material': 'Test Item Gamma', 'Chemical/Consumable': 'Consumable', 'Unit': 'Nos', 'Rate including GST': '30', 'Brand': 'BrandC', 'Tender Year': '2024' },
];

async function runTest() {
  console.log('[TEST] Step 1 — Wiping database...');
  const { error: wipeErr } = await supabase.rpc('fn_wipe_database');
  if (wipeErr) { console.error('[TEST] Wipe failed:', wipeErr); return; }
  
  const { count: countAfterWipe } = await supabase.from('inventory_items').select('*', { count: 'exact', head: true });
  console.log('[TEST] Count after wipe:', countAfterWipe, '(expected: 0)');

  console.log('[TEST] Step 2 — Calling fn_import_master_list with', TEST_PAYLOAD.length, 'rows (SINGLE call)...');
  const { data, error: importErr } = await supabase.rpc('fn_import_master_list', { p_payload: TEST_PAYLOAD });
  if (importErr) { console.error('[TEST] Import failed:', importErr); return; }
  console.log('[TEST] RPC returned:', data);

  const { count: finalCount } = await supabase.from('inventory_items').select('*', { count: 'exact', head: true });
  console.log('[TEST] Step 3 — Final count in DB:', finalCount, '(expected:', TEST_PAYLOAD.length, ')');
  
  if (finalCount === TEST_PAYLOAD.length) {
    console.log('[TEST] ✅ PASS — DB count matches payload. No double-insert at database level.');
    console.log('[TEST] The problem is likely in the FRONTEND making 2 RPC calls.');
  } else if (finalCount === TEST_PAYLOAD.length * 2) {
    console.log('[TEST] ❌ FAIL — DB has DOUBLE the expected rows. The fn_import_master_list function itself is double-inserting!');
  } else {
    console.log('[TEST] ❌ FAIL — Unexpected count:', finalCount);
  }
}
runTest();
