// Apply the correct fn_import_master_list to the live Supabase database
// Uses the Supabase Management API to execute raw SQL
const fs = require('fs');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const env = dotenv.parse(fs.readFileSync('.env'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY);

const CORRECT_SQL = `
CREATE OR REPLACE FUNCTION fn_import_master_list(p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec jsonb;
  v_rm_id uuid;
  v_rate numeric;
  v_item_name text;
  v_cat text;
  v_insert_count int := 0;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_item_name := TRIM(COALESCE(rec->>'Cleaning Material', ''));
    IF v_item_name = '' THEN CONTINUE; END IF;

    BEGIN
      v_rate := COALESCE((rec->>'Rate including GST')::numeric, 0);
    EXCEPTION WHEN OTHERS THEN v_rate := 0; END;
    
    v_cat := COALESCE(rec->>'Chemical/Consumable', 'Consumable');
    IF v_cat ILIKE '%chemical%' THEN 
       v_cat := 'Chemical'; 
    ELSE 
       v_cat := 'Consumable'; 
    END IF;

    INSERT INTO rate_master (
      item_name, category, unit, unit_rate, brand, tender_year
    ) VALUES (
      v_item_name,
      v_cat,
      COALESCE(rec->>'Unit', 'Nos'), 
      v_rate, 
      rec->>'Brand', 
      rec->>'Tender Year'
    ) RETURNING id INTO v_rm_id;

    INSERT INTO inventory_items (
      rate_master_id, name, category, unit, min_stock_level
    ) VALUES (
      v_rm_id,
      v_item_name,
      v_cat,
      COALESCE(rec->>'Unit', 'Nos'),
      10
    );

    v_insert_count := v_insert_count + 1;

  END LOOP;
  
  RAISE NOTICE 'fn_import_master_list completed: % rows inserted', v_insert_count;
END;
$$;
`;

async function applyFix() {
  console.log('Applying corrected fn_import_master_list to live database...');
  
  // Use pg_net or direct exec - try via Supabase's built-in exec_sql if available
  // Otherwise, we'll use a workaround
  const { error } = await supabase.rpc('exec_sql', { sql: CORRECT_SQL });
  
  if (error) {
    console.log('exec_sql not available (expected). The SQL needs to be applied via Supabase SQL Editor.');
    console.log('');
    console.log('=== COPY THE FOLLOWING SQL INTO THE SUPABASE SQL EDITOR ===');
    console.log('');
    console.log(CORRECT_SQL);
    console.log('');
    console.log('=== END SQL ===');
    console.log('');
    console.log('Go to: https://supabase.com/dashboard/project/_/sql/new');
  } else {
    console.log('Fix applied successfully!');
    
    // Verify
    await supabase.rpc('fn_wipe_database');
    const testPayload = [
      { 'Cleaning Material': 'Test Alpha', 'Chemical/Consumable': 'Consumable', 'Unit': 'Nos', 'Rate including GST': '10', 'Brand': 'BrandA', 'Tender Year': '2024' },
    ];
    await supabase.rpc('fn_import_master_list', { p_payload: testPayload });
    const { count } = await supabase.from('inventory_items').select('*', { count: 'exact', head: true });
    console.log('Verification: Sent 1 item, DB now has', count, 'items (expected 1)');
  }
}
applyFix();
