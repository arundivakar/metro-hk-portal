CREATE OR REPLACE FUNCTION fn_import_master_list(p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec jsonb;
  v_rm_id uuid;
  v_item_id uuid;
  v_rate numeric;
  v_item_name text;
  v_cat text;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_item_name := TRIM(COALESCE(rec->>'Cleaning Material', 'Unknown Item'));
    IF v_item_name = '' OR v_item_name = 'Unknown Item' THEN CONTINUE; END IF;

    -- Parse rate safely
    BEGIN
      v_rate := COALESCE((rec->>'Rate including GST')::numeric, 0);
    EXCEPTION WHEN OTHERS THEN v_rate := 0; END;
    
    v_cat := COALESCE(rec->>'Chemical/Consumable', 'Consumable');
    IF v_cat ILIKE '%chemical%' THEN 
       v_cat := 'Chemical'; 
    ELSE 
       v_cat := 'Consumable'; 
    END IF;

    -- Insert into rate_master
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

    -- Insert into inventory_items
    INSERT INTO inventory_items (
      rate_master_id, name, category, unit, min_stock_level
    ) VALUES (
      v_rm_id,
      v_item_name,
      v_cat,
      COALESCE(rec->>'Unit', 'Nos'),
      10 -- default min stock level
    ) RETURNING id INTO v_item_id;

  END LOOP;
END;
$$;
