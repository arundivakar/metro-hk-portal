import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
  const { data, error } = await supabase
    .from('station_inventory')
    .select('current_stock, item_id, stations(code), inventory_items(name, unit)')
    .eq('stations.code', 'PNCU')
    .gt('current_stock', 0);
    
  console.log(JSON.stringify(data, null, 2));
}

check();
