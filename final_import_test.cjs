const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const Papa = require('papaparse');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function importFull() {
  const file = fs.readFileSync('C:\\Users\\arunk\\Downloads\\Filtered_Rate_Master.csv', 'utf8');
  const results = Papa.parse(file, { header: true, skipEmptyLines: true });
  
  const normalizeKeys = (row) => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      if (!key) continue;
      const lowerKey = key.toLowerCase().trim();
      if (lowerKey.includes('cleaning material')) normalized['Cleaning Material'] = value;
      else if (lowerKey.includes('chemical') || lowerKey.includes('category')) {
        const cat = (value || '').toLowerCase().trim();
        normalized['Chemical/Consumable'] = cat.includes('chemical') ? 'Chemical' : 'Consumable';
      }
      else if (lowerKey.includes('rate')) normalized['Rate including GST'] = value;
      else if (lowerKey.includes('brand')) normalized['Brand'] = value;
      else if (lowerKey.includes('tender')) normalized['Tender Year'] = value;
      else if (lowerKey === 'unit') normalized['Unit'] = value;
      else normalized[key] = value;
    }
    return normalized;
  };

  const payload = results.data.map(normalizeKeys);
  console.log('CSV rows parsed:', payload.length);

  // Wipe
  console.log('Wiping database...');
  const { error: wipeErr } = await supabase.rpc('fn_wipe_database');
  if (wipeErr) throw wipeErr;

  // Import
  console.log('Importing', payload.length, 'rows...');
  const { error: importErr } = await supabase.rpc('fn_import_master_list', { p_payload: payload });
  if (importErr) throw importErr;

  // Verify
  const { count } = await supabase.from('inventory_items').select('*', { count: 'exact', head: true });
  console.log('\n============================');
  console.log('CSV rows sent :', payload.length);
  console.log('DB rows created:', count);
  if (count === payload.length) {
    console.log('✅ PERFECT MATCH!');
  } else {
    console.log('❌ MISMATCH — expected', payload.length, 'got', count);
  }
  console.log('============================');
}
importFull();
