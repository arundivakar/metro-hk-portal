import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Fixing orphaned transfer log at VYTA...");
  
  // Find orphaned "Inter-Station Transfer Out" logs that do NOT have a corresponding stock_received log
  // Because they deleted it at VAKK.
  // The item is "TOILET CLEANER R6", date 21-07-2026, qty 1.00 Ltr.
  // Let's find it.
  
  const { data: logs, error: err1 } = await supabase
    .from('consumption_logs')
    .select('*, stations(code)')
    .eq('consumption_date', '2026-07-21')
    .ilike('remarks', 'Inter-Station Transfer Out to VAKK')
    .eq('quantity_used', 1000); // 1.00 Ltr

  if (err1) {
    console.error("Error finding log:", err1);
    return;
  }
  
  if (!logs || logs.length === 0) {
    console.log("No orphaned log found matching criteria.");
  }

  for (const log of logs) {
    console.log(`Found orphaned log ${log.id} at station ${log.station_id}`);
    
    // Add stock back to VYTA
    const { data: inv, error: err2 } = await supabase
      .from('station_inventory')
      .select('current_stock')
      .eq('station_id', log.station_id)
      .eq('item_id', log.item_id)
      .limit(1);
      
    if (inv && inv.length > 0) {
      const restoredStock = inv[0].current_stock + log.quantity_used;
      await supabase
        .from('station_inventory')
        .update({ current_stock: restoredStock })
        .eq('station_id', log.station_id)
        .eq('item_id', log.item_id);
      console.log(`Restored stock to ${restoredStock}`);
    }
    
    // Delete the log
    await supabase.from('consumption_logs').delete().eq('id', log.id);
    console.log(`Deleted orphaned log.`);
  }
}
run();
