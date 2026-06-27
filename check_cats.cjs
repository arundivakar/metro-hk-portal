const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await supabase.from('inventory_items').select('*');
  if (error) throw error;
  console.log(`Total items: ${data.length}`);
  const chem = data.filter(d => d.category === 'Chemical').length;
  const cons = data.filter(d => d.category === 'Consumable').length;
  console.log(`Chemicals: ${chem}, Consumables: ${cons}`);
}
check();
