import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Fixing the previous reconciliation script...");
  
  // 1. Fetch all stock_received logs that are inter-station transfers
  const { data: transfers, error: trErr } = await supabase
    .from('stock_received')
    .select('*, stations!stock_received_station_id_fkey(code)')
    .not('source_station_id', 'is', null);

  if (trErr) {
    console.error("Error fetching transfers:", trErr);
    return;
  }
  
  let fixedCount = 0;

  for (const transfer of transfers) {
    // 2. Check if the source station has a corresponding consumption log
    const { data: cLogs, error: cErr } = await supabase
      .from('consumption_logs')
      .select('id')
      .eq('station_id', transfer.source_station_id)
      .eq('item_id', transfer.item_id)
      .eq('consumption_date', transfer.received_date)
      .eq('quantity_used', transfer.quantity)
      .ilike('remarks', 'Inter-%');
      
    if (cErr) {
      console.error("Error checking consumption logs:", cErr);
      continue;
    }
    
    // If we have a matching log, this transfer is healthy!
    if (cLogs && cLogs.length > 0) {
      continue;
    }
    
    console.log(`Fixing transfer ${transfer.id} (Item: ${transfer.item_id}, Source: ${transfer.source_station_id}, Qty: ${transfer.quantity})`);
    
    // 3. Reverse the incorrect manual deduction (add stock back)
    const { data: inv } = await supabase
      .from('station_inventory')
      .select('current_stock')
      .eq('station_id', transfer.source_station_id)
      .eq('item_id', transfer.item_id)
      .limit(1);
      
    if (inv && inv.length > 0) {
      const restoredStock = inv[0].current_stock + transfer.quantity;
      await supabase
        .from('station_inventory')
        .update({ current_stock: restoredStock })
        .eq('station_id', transfer.source_station_id)
        .eq('item_id', transfer.item_id);
    }
    
    // 4. Create the consumption log (the trigger will now safely deduct the stock again)
    const destStationCode = transfer.stations?.code || 'Another Station';
    const { error: insertErr } = await supabase.from('consumption_logs').insert({
      station_id: transfer.source_station_id,
      item_id: transfer.item_id,
      quantity_used: transfer.quantity,
      consumption_date: transfer.received_date,
      remarks: `Inter-Station Transfer Out to ${destStationCode}`, // Use correct capitalization so UI picks it up
      logged_by: transfer.received_by
    });
    
    if (insertErr) {
      console.error("Failed to insert consumption log for", transfer.id, insertErr);
      // Rollback the restoration if insert fails
      if (inv && inv.length > 0) {
          await supabase
            .from('station_inventory')
            .update({ current_stock: inv[0].current_stock })
            .eq('station_id', transfer.source_station_id)
            .eq('item_id', transfer.item_id);
      }
    } else {
      console.log(`Successfully fixed source log!`);
      fixedCount++;
    }
  }
  
  console.log(`\nReconciliation fixed! Repaired ${fixedCount} broken historical transfers.`);
}

run();
