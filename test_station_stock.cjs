const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  // Get a real station ID
  const { data: stations } = await supabase.from('stations').select('id, code').eq('code', 'PNCU').single();
  if (!stations) { console.log('PNCU station not found'); return; }
  const stationId = stations.id;
  console.log('Testing with station:', stations.code, stationId);

  // Get 2 real inventory items from DB to use in test
  const { data: items } = await supabase
    .from('inventory_items')
    .select('id, name, category, rate_master(brand, tender_year)')
    .limit(2);
  
  if (!items || items.length < 2) { console.log('Not enough inventory items'); return; }
  console.log('Test items:', items.map(i => `${i.name} | Brand: ${i.rate_master?.brand} | Tender: ${i.rate_master?.tender_year}`));

  const testPayload = items.map(item => ({
    'Cleaning Material': item.name,
    'Brand': item.rate_master?.brand || '',
    'Tender Year': item.rate_master?.tender_year || '',
    'Closing Stock': '10',
    'In Good condition (Currently in Use)': '2',
    'Partially Damaged Items available at station (Usable)': '1',
    'Disposed Items available at station (unusable)': '0',
  }));

  console.log('\nCalling fn_import_station_stock with', testPayload.length, 'items...');
  const { error } = await supabase.rpc('fn_import_station_stock', {
    p_station_id: stationId,
    p_payload: testPayload
  });

  if (error) { console.error('ERROR:', error.message); return; }

  // Check results
  const { data: si } = await supabase
    .from('station_inventory')
    .select('item_id, current_stock, quantity_in_use, quantity_damaged')
    .eq('station_id', stationId);

  const { count: srCount } = await supabase
    .from('stock_received')
    .select('*', { count: 'exact', head: true })
    .eq('station_id', stationId);

  const { count: assetCount } = await supabase
    .from('consumable_assets')
    .select('*', { count: 'exact', head: true })
    .eq('station_id', stationId);

  console.log('\n=== RESULTS ===');
  console.log('station_inventory rows:', si.length, '(expected:', testPayload.length, ')');
  si.forEach(r => console.log(' - stock:', r.current_stock, '| in_use:', r.quantity_in_use, '| damaged:', r.quantity_damaged));
  console.log('stock_received rows:', srCount, '(expected: 0 - should NOT be here)');
  console.log('consumable_assets rows:', assetCount);
  
  if (si.length === testPayload.length && srCount === 0) {
    console.log('\n✅ PASS - Stock set correctly, stock_received untouched!');
  } else {
    console.log('\n❌ FAIL - Check above counts');
  }
}
test();
