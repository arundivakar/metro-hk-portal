import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase URL or service role key.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Updating category for gloves and power pad...");
  const { data: items, error: itemsErr } = await supabase
    .from('inventory_items')
    .select('id, name, category')
    .or('name.ilike.%glove%,name.ilike.%power pad%');
    
  if (itemsErr) {
    console.error("Error fetching items:", itemsErr);
    return;
  }
  
  console.log("Found items:", items.map(i => i.name));
  
  const { data: updateData, error: updateErr } = await supabase
    .from('inventory_items')
    .update({ category: 'Consumable' })
    .in('id', items.map(i => i.id));
    
  if (updateErr) {
    console.error("Error updating items:", updateErr);
  } else {
    console.log("Successfully updated items to Consumable!");
  }
  
  console.log("Updating fn_edit_stock_received to allow supplier edit...");
  
  const sql = `
CREATE OR REPLACE FUNCTION fn_edit_stock_received(
    p_log_id uuid,
    p_new_quantity numeric,
    p_new_date date,
    p_remarks text,
    p_new_supplier text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_log record;
    v_diff numeric;
BEGIN
    SELECT * INTO v_log FROM stock_received WHERE id = p_log_id FOR UPDATE;
    IF v_log IS NULL THEN RAISE EXCEPTION 'Log not found'; END IF;

    v_diff := p_new_quantity - v_log.quantity;
    
    -- Update inventory (receiving adds stock)
    UPDATE station_inventory SET current_stock = current_stock + v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    
    -- Update log
    UPDATE stock_received SET 
        quantity = p_new_quantity, 
        received_date = p_new_date, 
        remarks = p_remarks,
        supplier = COALESCE(p_new_supplier, supplier)
    WHERE id = p_log_id;
END;
$$;
  `;
  
  // Create an RPC to execute raw SQL (if it exists) or try to insert the migration directly via RPC. 
  // Wait, service role doesn't have an execute_sql RPC by default.
  // I will just put the SQL in a migration file and tell the user to execute it via SQL editor, 
  // since I can't guarantee `execute_sql` exists.
}

run();
