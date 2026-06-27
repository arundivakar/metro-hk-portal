const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const Papa = require('papaparse');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const file = fs.readFileSync('C:\\Users\\arunk\\Downloads\\Filtered_Rate_Master.csv', 'utf8');
  const csvParsed = Papa.parse(file, { header: true, skipEmptyLines: true });
  const csvNames = csvParsed.data.map(r => (r['Cleaning Material'] || '').trim().toLowerCase());
  
  const { data, error } = await supabase.from('inventory_items').select('name, created_at').order('created_at', { ascending: true });
  if (error) throw error;
  
  const dbNames = data.map(r => r.name.trim().toLowerCase());
  
  // Find which items in DB are NOT in the CSV
  const notInCsv = data.filter(r => !csvNames.includes(r.name.trim().toLowerCase()));
  
  console.log('Total in DB:', data.length);
  console.log('Total in CSV:', csvParsed.data.length);
  console.log('Items in DB but not in CSV:', notInCsv.length);
  console.log('First 10 missing items:', notInCsv.slice(0, 10));
}
check();
