const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function clean() {
  // Delete all stock_received rows that were auto-inserted by the old import function
  // They have supplier = 'Opening Stock Init'
  const { error, count } = await supabase
    .from('stock_received')
    .delete({ count: 'exact' })
    .eq('supplier', 'Opening Stock Init');

  if (error) { console.error('Error:', error.message); return; }
  console.log('Deleted', count, 'old "Opening Stock Init" rows from stock_received.');

  const { count: remaining } = await supabase
    .from('stock_received')
    .select('*', { count: 'exact', head: true });
  console.log('Remaining stock_received rows (manual entries):', remaining);
}
clean();
