import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: ccuv } = await supabase.from('stations').select('id').eq('code', 'CCUV').single();
  const { data: items } = await supabase.from('inventory_items').select('id, name').ilike('name', '%power pad%');
  
  const itemIds = items.map(i => i.id);

  const { data: logs } = await supabase
    .from('stock_received')
    .select('id, quantity, received_date, supplier, item_id')
    .eq('station_id', ccuv.id)
    .in('item_id', itemIds);

  console.log("All Power Pad logs for CCUV:", logs);
  
  if (logs && logs.length > 0) {
    const logToFix = logs.find(l => l.received_date === '2026-07-13' && l.supplier === 'KDS');
    if (logToFix) {
       console.log("Found target log:", logToFix);
       const klmtId = (await supabase.from('stations').select('id').eq('code', 'KLMT').single()).data.id;
       await supabase.from('stock_received').update({ supplier: 'KLMT', source_station_id: klmtId }).eq('id', logToFix.id);
       
       const { data: klmtInv } = await supabase.from('station_inventory').select('current_stock').eq('station_id', klmtId).eq('item_id', logToFix.item_id);
       if (klmtInv && klmtInv.length > 0) {
          await supabase.from('station_inventory').update({ current_stock: klmtInv[0].current_stock - logToFix.quantity }).eq('station_id', klmtId).eq('item_id', logToFix.item_id);
       } else {
          await supabase.from('station_inventory').insert({ station_id: klmtId, item_id: logToFix.item_id, current_stock: -logToFix.quantity });
       }
       await supabase.from('consumption_logs').insert({
          station_id: klmtId,
          item_id: logToFix.item_id,
          quantity_used: logToFix.quantity,
          consumption_date: logToFix.received_date,
          remarks: 'Inter-station Transfer to CCUV'
       });
       console.log("Fixed!");
    } else {
       console.log("Could not find log for 2026-07-13 from KDS");
    }
  }
}
run();
