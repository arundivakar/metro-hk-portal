-- STEP 1: Drop ALL existing overloads of fn_import_master_list
DROP FUNCTION IF EXISTS fn_import_master_list(jsonb);
DROP FUNCTION IF EXISTS fn_import_master_list(p_payload jsonb);

-- STEP 2: Recreate it cleanly — inserts ONLY the plain item name, never appends brand
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
    -- Use ONLY the "Cleaning Material" column as the item name. Never append brand.
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

    -- One row in rate_master per CSV row
    INSERT INTO rate_master (item_name, category, unit, unit_rate, brand, tender_year)
    VALUES (v_item_name, v_cat, COALESCE(rec->>'Unit', 'Nos'), v_rate, rec->>'Brand', rec->>'Tender Year')
    RETURNING id INTO v_rm_id;

    -- One matching row in inventory_items per rate_master row
    INSERT INTO inventory_items (rate_master_id, name, category, unit, min_stock_level)
    VALUES (v_rm_id, v_item_name, v_cat, COALESCE(rec->>'Unit', 'Nos'), 10);

    v_insert_count := v_insert_count + 1;
  END LOOP;
  
  RAISE NOTICE 'fn_import_master_list: % rows inserted', v_insert_count;
END;
$$;

-- STEP 3: Verify the function exists with correct signature
SELECT proname, pronargs, proargnames, prosrc 
FROM pg_proc 
WHERE proname = 'fn_import_master_list';
