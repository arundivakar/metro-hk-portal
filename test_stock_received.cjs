const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data: stations } = await supabase.from('stations').select('id, code').eq('code', 'PNCU').single();
  const stationId = stations.id;

  // Check stock_received BEFORE the import
  const { count: beforeCount } = await supabase
    .from('stock_received')
    .select('*', { count: 'exact', head: true })
    .eq('station_id', stationId);
  console.log('stock_received BEFORE import:', beforeCount);

  // Run import
  const { data: items } = await supabase
    .from('inventory_items')
    .select('id, name, category, rate_master(brand, tender_year)')
    .limit(2);

  const testPayload = items.map(item => ({
    'Cleaning Material': item.name,
    'Brand': item.rate_master?.brand || '',
    'Tender Year': item.rate_master?.tender_year || '',
    'Closing Stock': '5',
    'In Good condition (Currently in Use)': '1',
    'Partially Damaged Items available at station (Usable)': '0',
    'Disposed Items available at station (unusable)': '0',
  }));

  const { error } = await supabase.rpc('fn_import_station_stock', {
    p_station_id: stationId,
    p_payload: testPayload
  });
  if (error) { console.error('ERROR:', error.message); return; }

  // Check stock_received AFTER the import
  const { count: afterCount } = await supabase
    .from('stock_received')
    .select('*', { count: 'exact', head: true })
    .eq('station_id', stationId);
  console.log('stock_received AFTER import: ', afterCount);

  if (beforeCount === afterCount) {
    console.log('\n✅ PASS - No new rows added to stock_received. Old rows are just pre-existing data.');
  } else {
    console.log('\n❌ FAIL - stock_received grew by', afterCount - beforeCount, 'rows during import!');
  }
}
test();
