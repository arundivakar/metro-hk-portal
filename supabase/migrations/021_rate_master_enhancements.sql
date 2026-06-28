-- =============================================================================
-- 021_rate_master_enhancements.sql
-- Purpose:
--   1. Add base_rate, gst_percent, supplier columns to rate_master
--   2. Recreate fn_import_master_list as SAFE UPSERT (NO wipe, NO delete)
--      Match on (item_name, brand, tender_year) — update master fields only.
--      station_inventory, consumption_logs, stock_received etc are NEVER touched.
--   3. Add ALS UPDATE RLS policies on rate_master and inventory_items
-- =============================================================================

-- Step 1: Add new columns to rate_master
ALTER TABLE rate_master
  ADD COLUMN IF NOT EXISTS base_rate   numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_percent numeric(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier    text;

-- Step 2: Recreate fn_import_master_list as safe upsert
DROP FUNCTION IF EXISTS fn_import_master_list(jsonb);
DROP FUNCTION IF EXISTS fn_import_master_list(p_payload jsonb);

CREATE OR REPLACE FUNCTION fn_import_master_list(p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  rec           jsonb;
  v_rm_id       uuid;
  v_item_id     uuid;
  v_rate        numeric;
  v_base_rate   numeric;
  v_gst_percent numeric;
  v_item_name   text;
  v_brand       text;
  v_tender_year text;
  v_cat         text;
  v_unit        text;
  v_min_stock   numeric;
  v_supplier    text;
  v_insert_count int := 0;
  v_update_count int := 0;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_item_name := TRIM(COALESCE(rec->>'Cleaning Material', ''));
    IF v_item_name = '' THEN CONTINUE; END IF;

    v_brand       := TRIM(COALESCE(rec->>'Brand', ''));
    v_tender_year := TRIM(COALESCE(rec->>'Tender Year', ''));
    v_unit        := COALESCE(NULLIF(TRIM(rec->>'Unit'), ''), 'Nos');
    v_supplier    := NULLIF(TRIM(COALESCE(rec->>'Supplier', '')), '');

    BEGIN v_rate        := COALESCE((rec->>'Rate including GST')::numeric, 0); EXCEPTION WHEN OTHERS THEN v_rate := 0; END;
    BEGIN v_base_rate   := COALESCE((rec->>'Base Rate')::numeric, 0);          EXCEPTION WHEN OTHERS THEN v_base_rate := 0; END;
    BEGIN v_gst_percent := COALESCE((rec->>'GST %')::numeric, 0);              EXCEPTION WHEN OTHERS THEN v_gst_percent := 0; END;

    IF v_rate = 0 AND v_base_rate > 0 AND v_gst_percent > 0 THEN
      v_rate := ROUND(v_base_rate * (1 + v_gst_percent / 100), 2);
    END IF;
    IF v_base_rate = 0 AND v_rate > 0 AND v_gst_percent > 0 THEN
      v_base_rate := ROUND(v_rate / (1 + v_gst_percent / 100), 2);
    END IF;

    v_cat := COALESCE(rec->>'Chemical/Consumable', 'Consumable');
    IF v_cat ILIKE '%chemical%' THEN v_cat := 'Chemical'; ELSE v_cat := 'Consumable'; END IF;

    v_min_stock := CASE v_unit WHEN 'g' THEN 1000 WHEN 'ml' THEN 5000 ELSE 2 END;

    -- UPSERT rate_master
    SELECT id INTO v_rm_id FROM rate_master
     WHERE LOWER(item_name) = LOWER(v_item_name)
       AND LOWER(COALESCE(brand, ''))       = LOWER(v_brand)
       AND LOWER(COALESCE(tender_year, '')) = LOWER(v_tender_year)
     LIMIT 1;

    IF v_rm_id IS NOT NULL THEN
      UPDATE rate_master SET
        category    = v_cat,
        unit        = v_unit,
        unit_rate   = v_rate,
        base_rate   = v_base_rate,
        gst_percent = v_gst_percent,
        supplier    = COALESCE(v_supplier, supplier),
        updated_at  = NOW()
      WHERE id = v_rm_id;
      v_update_count := v_update_count + 1;
    ELSE
      INSERT INTO rate_master (item_name, category, unit, unit_rate, brand, tender_year, base_rate, gst_percent, supplier)
      VALUES (v_item_name, v_cat, v_unit, v_rate, v_brand, v_tender_year, v_base_rate, v_gst_percent, v_supplier)
      RETURNING id INTO v_rm_id;
      v_insert_count := v_insert_count + 1;
    END IF;

    -- UPSERT inventory_items (keyed on rate_master_id)
    SELECT id INTO v_item_id FROM inventory_items WHERE rate_master_id = v_rm_id LIMIT 1;

    IF v_item_id IS NOT NULL THEN
      UPDATE inventory_items SET name = v_item_name, category = v_cat, unit = v_unit WHERE id = v_item_id;
    ELSE
      INSERT INTO inventory_items (rate_master_id, name, category, unit, min_stock_level)
      VALUES (v_rm_id, v_item_name, v_cat, v_unit, v_min_stock);
    END IF;

  END LOOP;
  RAISE NOTICE 'fn_import_master_list (safe upsert): % inserted, % updated', v_insert_count, v_update_count;
END;
$func$;

-- Step 3: ALS UPDATE policies
DROP POLICY IF EXISTS "ALS can update rate_master" ON rate_master;
CREATE POLICY "ALS can update rate_master" ON rate_master
  FOR UPDATE USING (EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'ALS'));

DROP POLICY IF EXISTS "ALS can update inventory_items" ON inventory_items;
CREATE POLICY "ALS can update inventory_items" ON inventory_items
  FOR UPDATE USING (EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'ALS'));

-- Verify columns
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'rate_master' ORDER BY ordinal_position;
