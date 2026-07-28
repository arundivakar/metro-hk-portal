const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function fix() {
  console.log('Fetching all inventory items...');
  const { data: items, error: fetchErr } = await supabase.from('inventory_items').select('id, name, created_at').order('created_at', { ascending: true });
  
  if (fetchErr) {
    console.error('Fetch error:', fetchErr);
    return;
  }

  const nameMap = new Map();
  const duplicateIds = [];

  for (const item of items) {
    const lowerName = item.name.toLowerCase().trim();
    if (nameMap.has(lowerName)) {
      duplicateIds.push(item.id);
    } else {
      nameMap.set(lowerName, item.id);
    }
  }

  console.log(`Found ${duplicateIds.length} duplicates. Deleting...`);
  if (duplicateIds.length > 0) {
    const { error: delErr } = await supabase.from('inventory_items').delete().in('id', duplicateIds);
    if (delErr) {
      console.error('Delete error:', delErr);
    } else {
      console.log('Successfully deleted duplicates.');
    }
  }
}
fix();
