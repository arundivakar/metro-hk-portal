import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: stations } = await supabase.from('stations').select('id, code').in('code', ['CCUV', 'KLMT']);
  const ccuvId = stations.find(s => s.code === 'CCUV').id;
  const klmtId = stations.find(s => s.code === 'KLMT').id;

  const { data: items } = await supabase.from('inventory_items').select('id, name').eq('name', 'Power Pad');
  const itemId = items[0].id;

  // Let's just find ALL logs for Power Pad at CCUV that came from KDS to see what's there
  const { data: logs, error: logErr } = await supabase
    .from('stock_received')
    .select('id, quantity, received_date')
    .eq('station_id', ccuvId)
    .eq('item_id', itemId)
    .eq('supplier', 'KDS');

  console.log("Found logs:", logs);

  if (logs && logs.length > 0) {
    const logToUpdate = logs[0]; // just take the first one
    console.log("Updating log:", logToUpdate.id);
    
    await supabase.from('stock_received').update({
      supplier: 'KLMT',
      source_station_id: klmtId
    }).eq('id', logToUpdate.id);

    const { data: klmtInv } = await supabase.from('station_inventory').select('current_stock').eq('station_id', klmtId).eq('item_id', itemId);
    
    if (klmtInv && klmtInv.length > 0) {
      await supabase.from('station_inventory').update({ current_stock: klmtInv[0].current_stock - logToUpdate.quantity }).eq('station_id', klmtId).eq('item_id', itemId);
    } else {
      await supabase.from('station_inventory').insert({ station_id: klmtId, item_id: itemId, current_stock: -logToUpdate.quantity });
    }

    await supabase.from('consumption_logs').insert({
      station_id: klmtId,
      item_id: itemId,
      quantity_used: logToUpdate.quantity,
      consumption_date: logToUpdate.received_date,
      remarks: 'Inter-station Transfer to CCUV',
      logged_by: '00000000-0000-0000-0000-000000000000' // fallback if needed, or null if allowed
    });

    console.log("Fixed!");
  }
}
run();
