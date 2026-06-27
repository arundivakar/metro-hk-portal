const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: items } = await supabase.from('inventory_items').select('id, name');
  console.log('Total inventory_items:', items ? items.length : 'error');
  
  const { data: si } = await supabase.from('station_inventory').select('id');
  console.log('Total station_inventory rows:', si ? si.length : 'error');
  
  const { data: view } = await supabase.from('v_station_inventory_summary').select('item_id');
  console.log('Total view rows:', view ? view.length : 'error');
}
check();
