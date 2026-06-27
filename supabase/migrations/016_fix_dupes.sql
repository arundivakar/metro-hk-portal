-- Delete duplicates from inventory_items keeping the one with max id (or min id)
DELETE FROM inventory_items
WHERE id IN (
  SELECT id
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY LOWER(name) ORDER BY created_at ASC) as row_num
    FROM inventory_items
  ) t
  WHERE t.row_num > 1
);

-- Delete orphans in rate_master
DELETE FROM rate_master
WHERE id NOT IN (SELECT rate_master_id FROM inventory_items);

-- Add unique constraint
ALTER TABLE inventory_items ADD CONSTRAINT uq_inventory_items_name UNIQUE (name);

-- Update fn_import_master_list to ignore duplicates
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

    -- Skip if item already exists (case-insensitive)
    IF EXISTS (SELECT 1 FROM inventory_items WHERE LOWER(name) = LOWER(v_item_name)) THEN
      CONTINUE;
    END IF;

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
