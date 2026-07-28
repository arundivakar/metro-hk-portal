import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixGarbageCover() {
  console.log('Fixing Plastic garbage cover (Small)...');
  
  // Update rate_master where name like garbage cover (small)
  const { data, error } = await supabase
    .from('rate_master')
    .update({ 
      unit: 'Nos', 
      nos_per_kg: 30 
    })
    .ilike('item_name', '%garbage%small%')
    .select();

  if (error) {
    console.error('Error updating rate_master:', error);
  } else {
    console.log('Updated rate_master:', data);
  }

  // Also update inventory_items to sync unit
  const { data: invData, error: invError } = await supabase
    .from('inventory_items')
    .update({ unit: 'Nos' })
    .ilike('name', '%garbage%small%')
    .select();

  if (invError) {
    console.error('Error updating inventory_items:', invError);
  } else {
    console.log('Updated inventory_items:', invData);
  }
}

fixGarbageCover();
