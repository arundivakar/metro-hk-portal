import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Starting full inventory sync (Corrected Math)...");

  const { data: inventoryList, error } = await supabase
    .from('station_inventory')
    .select('station_id, item_id, current_stock');

  if (error) {
    console.error("Error fetching inventory:", error);
    return;
  }

  let discrepancies = 0;

  for (const inv of inventoryList) {
    // Sum receipts
    const { data: receipts } = await supabase
      .from('stock_received')
      .select('quantity')
      .eq('station_id', inv.station_id)
      .eq('item_id', inv.item_id);

    const totalReceived = receipts ? receipts.reduce((sum, r) => sum + Number(r.quantity), 0) : 0;

    // Sum consumptions
    const { data: consumptions } = await supabase
      .from('consumption_logs')
      .select('quantity_used')
      .eq('station_id', inv.station_id)
      .eq('item_id', inv.item_id);

    const totalConsumed = consumptions ? consumptions.reduce((sum, c) => sum + Number(c.quantity_used), 0) : 0;

    // Calculate the true physical stock
    // Since quantity_in_use is decremented upon consumption, current_stock only changes from receipts and consumption!
    const trueStock = totalReceived - totalConsumed;

    // If there's a discrepancy, fix it!
    if (trueStock !== Number(inv.current_stock)) {
      console.log(`Discrepancy at Station ${inv.station_id}, Item ${inv.item_id}: DB says ${inv.current_stock}, but true math is ${trueStock}`);
      
      await supabase
        .from('station_inventory')
        .update({ current_stock: trueStock })
        .eq('station_id', inv.station_id)
        .eq('item_id', inv.item_id);
      
      discrepancies++;
    }
  }

  console.log(`Sync complete. Fixed ${discrepancies} out of sync inventory records.`);
}

run();
