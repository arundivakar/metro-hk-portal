-- 019_update_station_stock_import.sql
-- Removes the stock_received insertion to prevent double-counting via triggers
-- Adds initial entries to consumable_assets and asset_lifecycle_logs for in_use, damaged, and disposed items.

CREATE OR REPLACE FUNCTION fn_import_station_stock(p_station_id uuid, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec jsonb;
  v_item_name text;
  v_item_id uuid;
  v_category text;
  
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
    SELECT id, category INTO v_item_id, v_category FROM inventory_items WHERE LOWER(name) = LOWER(v_item_name) LIMIT 1;

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

      -- DO NOT insert into stock_received. 
      -- The trigger on stock_received was causing double-counting of current_stock!
      -- Only manual entries should go to stock_received.

      -- Add to consumable_assets and asset_lifecycle_logs if there are items in use/damaged/disposed
      IF v_category = 'Consumable' THEN
        IF v_in_use > 0 THEN
          INSERT INTO consumable_assets (station_id, item_id, quantity, status, issued_date, remarks)
          VALUES (p_station_id, v_item_id, v_in_use, 'in_use', CURRENT_DATE, 'Initial Stock Upload');
          
          INSERT INTO asset_lifecycle_logs (station_id, item_id, quantity, from_status, to_status, remarks)
          VALUES (p_station_id, v_item_id, v_in_use, 'Stock', 'in_use', 'Initial Stock Upload');
        END IF;

        IF v_damaged > 0 THEN
          INSERT INTO consumable_assets (station_id, item_id, quantity, status, issued_date, remarks)
          VALUES (p_station_id, v_item_id, v_damaged, 'partially_damaged', CURRENT_DATE, 'Initial Stock Upload');
          
          INSERT INTO asset_lifecycle_logs (station_id, item_id, quantity, from_status, to_status, remarks)
          VALUES (p_station_id, v_item_id, v_damaged, 'Stock', 'partially_damaged', 'Initial Stock Upload');
        END IF;

        IF v_disposed > 0 THEN
          INSERT INTO consumable_assets (station_id, item_id, quantity, status, issued_date, remarks)
          VALUES (p_station_id, v_item_id, v_disposed, 'disposed', CURRENT_DATE, 'Initial Stock Upload');
          
          INSERT INTO asset_lifecycle_logs (station_id, item_id, quantity, from_status, to_status, remarks)
          VALUES (p_station_id, v_item_id, v_disposed, 'Stock', 'disposed', 'Initial Stock Upload');
        END IF;
      END IF;

    END IF;

  END LOOP;
END;
$$;
