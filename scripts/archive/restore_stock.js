import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Restoring artificially deducted stock...");

  const fixedTransfers = new Set([
    '5f89888d-731a-454c-b4be-fd6817684107',
    '27ab2afb-d0aa-4684-8dde-9247d42e0d17',
    '327926bf-b853-4768-855f-a3b01fd4a09c',
    '2bcdff5f-a0d9-472b-9f34-1423559fd991',
    '2fa7c727-21b7-4254-8cde-41f4cf880496'
  ]);

  const logContent = fs.readFileSync('C:/Users/arunk/.gemini/antigravity/brain/31de92fa-d0e1-421c-b9fc-fcdf9141cd46/.system_generated/tasks/task-7768.log', 'utf8');
  
  const regex = /Missing source log for transfer ([\w-]+) \(Item: ([\w-]+), Source: ([\w-]+), Qty: (\d+), Date:/g;
  let match;
  let restoredCount = 0;

  while ((match = regex.exec(logContent)) !== null) {
    const transferId = match[1];
    const itemId = match[2];
    const sourceId = match[3];
    const qty = parseInt(match[4], 10);

    if (fixedTransfers.has(transferId)) {
      continue;
    }

    // Restore stock
    const { data: inv } = await supabase
      .from('station_inventory')
      .select('current_stock')
      .eq('station_id', sourceId)
      .eq('item_id', itemId)
      .limit(1);

    if (inv && inv.length > 0) {
      const newStock = inv[0].current_stock + qty;
      await supabase
        .from('station_inventory')
        .update({ current_stock: newStock })
        .eq('station_id', sourceId)
        .eq('item_id', itemId);
        
      console.log(`Restored ${qty} to item ${itemId} at station ${sourceId}. New stock: ${newStock}`);
      restoredCount++;
    }
  }

  console.log(`Successfully restored stock for ${restoredCount} transfers!`);
}

run();
