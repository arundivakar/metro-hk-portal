-- 013_csv_import_rpcs.sql

-- 1. Wipe database (Factory Reset)
CREATE OR REPLACE FUNCTION fn_wipe_database()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- We just truncate rate_master CASCADE.
  -- This will cascade and delete from inventory_items, station_inventory,
  -- consumable_assets, asset_lifecycle_logs, stock_received, consumption_logs, consumable_requests.
  TRUNCATE TABLE rate_master CASCADE;
END;
$$;


-- 2. Import Master List
CREATE OR REPLACE FUNCTION fn_import_master_list(p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec jsonb;
  v_rm_id uuid;
  v_item_id uuid;
  v_rate numeric;
  v_item_name text;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_item_name := TRIM(COALESCE(rec->>'Cleaning Material', 'Unknown Item'));
    IF v_item_name = '' OR v_item_name = 'Unknown Item' THEN CONTINUE; END IF;

    -- Parse rate safely
    BEGIN
      v_rate := COALESCE((rec->>'Rate including GST')::numeric, 0);
    EXCEPTION WHEN OTHERS THEN v_rate := 0; END;

    -- Insert into rate_master
    INSERT INTO rate_master (
      item_name, category, unit, unit_rate, brand, tender_year
    ) VALUES (
      v_item_name,
      COALESCE(rec->>'Chemical/Consumable', 'Consumable'), 
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
      COALESCE(rec->>'Chemical/Consumable', 'Consumable'), 
      COALESCE(rec->>'Unit', 'Nos'),
      10 -- default min stock level
    ) RETURNING id INTO v_item_id;

  END LOOP;
END;
$$;


-- 3. Import Station Stock
CREATE OR REPLACE FUNCTION fn_import_station_stock(p_station_id uuid, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec jsonb;
  v_item_name text;
  v_item_id uuid;
  
  v_closing numeric;
  v_in_use numeric;
  v_damaged numeric;
  v_disposed numeric;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_item_name := TRIM(COALESCE(rec->>'Cleaning Material', 'Unknown Item'));
    IF v_item_name = '' OR v_item_name = 'Unknown Item' THEN CONTINUE; END IF;

    -- Find item by exact name (case insensitive)
    SELECT id INTO v_item_id FROM inventory_items WHERE LOWER(name) = LOWER(v_item_name) LIMIT 1;

    IF v_item_id IS NOT NULL THEN
      -- Safely parse quantities
      BEGIN v_closing := COALESCE((rec->>'Closing Stock')::numeric, 0); EXCEPTION WHEN OTHERS THEN v_closing := 0; END;
      BEGIN v_in_use := COALESCE((rec->>'In Good condition (Currently in Use)')::numeric, 0); EXCEPTION WHEN OTHERS THEN v_in_use := 0; END;
      BEGIN v_damaged := COALESCE((rec->>'Partially Damaged Items available at station (Usable)')::numeric, 0); EXCEPTION WHEN OTHERS THEN v_damaged := 0; END;
      BEGIN v_disposed := COALESCE((rec->>'Disposed Items available at station (unusable)')::numeric, 0); EXCEPTION WHEN OTHERS THEN v_disposed := 0; END;

      -- Upsert station_inventory directly
      INSERT INTO station_inventory (
        station_id, item_id, current_stock, quantity_in_use, quantity_damaged, quantity_disposed, last_updated
      ) VALUES (
        p_station_id, v_item_id, v_closing, v_in_use, v_damaged, v_disposed, NOW()
      )
      ON CONFLICT (station_id, item_id) DO UPDATE SET
        current_stock = station_inventory.current_stock + EXCLUDED.current_stock,
        quantity_in_use = station_inventory.quantity_in_use + EXCLUDED.quantity_in_use,
        quantity_damaged = station_inventory.quantity_damaged + EXCLUDED.quantity_damaged,
        quantity_disposed = station_inventory.quantity_disposed + EXCLUDED.quantity_disposed,
        last_updated = NOW();

      -- Create an initialization record in stock_received if closing > 0
      IF v_closing > 0 THEN
        INSERT INTO stock_received (
          station_id, item_id, quantity, received_date, supplier, unit_rate
        ) VALUES (
          p_station_id, v_item_id, v_closing, CURRENT_DATE, 'Opening Stock Init', 0
        );
      END IF;

    END IF;

  END LOOP;
END;
$$;
