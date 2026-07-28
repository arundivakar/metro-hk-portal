import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Starting reconciliation of historical inter-station transfers...");
  
  // 1. Fetch all stock_received logs that are inter-station transfers
  const { data: transfers, error: trErr } = await supabase
    .from('stock_received')
    .select('*, stations!stock_received_station_id_fkey(code)')
    .not('source_station_id', 'is', null);

  if (trErr) {
    console.error("Error fetching transfers:", trErr);
    return;
  }
  
  console.log(`Found ${transfers.length} inter-station transfers to check.`);

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
      .like('remarks', 'Inter-station Transfer%');
      
    if (cErr) {
      console.error("Error checking consumption logs:", cErr);
      continue;
    }
    
    // If we have a matching log, this transfer is healthy!
    if (cLogs && cLogs.length > 0) {
      continue;
    }
    
    console.log(`Missing source log for transfer ${transfer.id} (Item: ${transfer.item_id}, Source: ${transfer.source_station_id}, Qty: ${transfer.quantity}, Date: ${transfer.received_date})`);
    
    // 3. Fix it: Deduct stock from the source station
    const { data: inv, error: invErr } = await supabase
      .from('station_inventory')
      .select('current_stock')
      .eq('station_id', transfer.source_station_id)
      .eq('item_id', transfer.item_id)
      .limit(1);
      
    if (invErr) {
      console.error("Error fetching inventory:", invErr);
      continue;
    }
    
    if (inv && inv.length > 0) {
      const newStock = inv[0].current_stock - transfer.quantity;
      await supabase
        .from('station_inventory')
        .update({ current_stock: newStock })
        .eq('station_id', transfer.source_station_id)
        .eq('item_id', transfer.item_id);
    } else {
      await supabase
        .from('station_inventory')
        .insert({
          station_id: transfer.source_station_id,
          item_id: transfer.item_id,
          current_stock: -transfer.quantity
        });
    }
    
    // 4. Create the missing consumption log at the source station
    const destStationCode = transfer.stations?.code || 'Another Station';
    await supabase.from('consumption_logs').insert({
      station_id: transfer.source_station_id,
      item_id: transfer.item_id,
      quantity_used: transfer.quantity,
      consumption_date: transfer.received_date,
      remarks: `Inter-station Transfer to ${destStationCode}`,
      logged_by: transfer.received_by
    });
    
    console.log(`Fixed missing transfer record for source station!`);
    fixedCount++;
  }
  
  console.log(`\nReconciliation complete! Repaired ${fixedCount} broken historical transfers.`);
}

run();
