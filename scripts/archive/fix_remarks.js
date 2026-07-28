import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Fixing remarks formatting...");

  const { data: logs, error } = await supabase
    .from('consumption_logs')
    .select('id, remarks')
    .ilike('remarks', 'Inter-station Transfer to%'); // case-insensitive

  if (error) {
    console.error("Error fetching logs:", error);
    return;
  }

  let count = 0;
  for (const log of logs) {
    // We want exactly "Inter-Station Transfer Out to"
    // So we just replace case-insensitively
    const newRemarks = log.remarks.replace(/Inter-station Transfer to/i, 'Inter-Station Transfer Out to');
    
    // Only update if it actually changed to avoid redundant writes
    if (newRemarks !== log.remarks) {
      await supabase.from('consumption_logs').update({ remarks: newRemarks }).eq('id', log.id);
      count++;
    }
  }

  console.log(`Updated ${count} logs to fix frontend filtering.`);
}
run();
