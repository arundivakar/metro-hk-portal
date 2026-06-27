const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);
async function check() {
  const { data, error } = await supabase.from('inventory_items').select('name').order('name');
  if (error) throw error;
  
  // Count frequency of each name
  const counts = {};
  data.forEach(r => { counts[r.name] = (counts[r.name] || 0) + 1; });
  
  const mult = Object.entries(counts).filter(([n, c]) => c > 1);
  console.log('Total items in DB:', data.length);
  console.log('Unique names in DB:', Object.keys(counts).length);
  console.log('Items with frequency > 1:', mult.length);
  console.log(mult.slice(0, 10));
}
check();
