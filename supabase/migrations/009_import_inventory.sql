-- Add RPC to Import Inventory from CSV/JSON and optionally Factory Reset

CREATE OR REPLACE FUNCTION fn_import_inventory(
  p_station_id uuid,
  p_wipe_existing boolean,
  p_payload jsonb
) RETURNS void AS $$
DECLARE
  rec jsonb;
  v_rm_id uuid;
  v_item_id uuid;
  v_rate numeric;
  v_min_level numeric;
  v_opening_stock numeric;
BEGIN
  -- 1. Wipe existing if requested
  IF p_wipe_existing THEN
    -- CASCADE will clear inventory_items, station_inventory, stock_received, consumption_logs, etc.
    -- It will NOT affect stations or users.
    TRUNCATE TABLE rate_master CASCADE;
  END IF;

  -- 2. Loop over JSON array
  FOR rec IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    -- Parse numbers safely
    BEGIN
      v_rate := COALESCE((rec->>'unit_rate')::numeric, 0);
    EXCEPTION WHEN OTHERS THEN v_rate := 0; END;

    BEGIN
      v_min_level := COALESCE((rec->>'min_level')::numeric, 0);
    EXCEPTION WHEN OTHERS THEN v_min_level := 0; END;

    BEGIN
      v_opening_stock := COALESCE((rec->>'opening_stock')::numeric, 0);
    EXCEPTION WHEN OTHERS THEN v_opening_stock := 0; END;

    -- Insert into rate_master
    INSERT INTO rate_master (
      item_name, category, unit, unit_rate, brand, tender_year
    ) VALUES (
      COALESCE(rec->>'item_name', 'Unknown Item'), 
      COALESCE(rec->>'category', 'Consumable'), 
      COALESCE(rec->>'unit', 'Nos'), 
      v_rate, 
      rec->>'brand', 
      rec->>'tender_year'
    ) RETURNING id INTO v_rm_id;

    -- Insert into inventory_items
    INSERT INTO inventory_items (
      rate_master_id, name, category, unit, min_stock_level
    ) VALUES (
      v_rm_id,
      COALESCE(rec->>'item_name', 'Unknown Item'), 
      COALESCE(rec->>'category', 'Consumable'), 
      COALESCE(rec->>'unit', 'Nos'),
      v_min_level
    ) RETURNING id INTO v_item_id;

    -- Initialize station_inventory stock if requested
    IF p_station_id IS NOT NULL AND v_opening_stock > 0 THEN
      -- Create the stock received log
      INSERT INTO stock_received (
        station_id, item_id, quantity, received_date, supplier, unit_rate
      ) VALUES (
        p_station_id,
        v_item_id,
        v_opening_stock,
        CURRENT_DATE,
        'Opening Stock Initialization',
        v_rate
      );
      
      -- Note: The trigger "trg_update_inventory_on_receive" on stock_received 
      -- automatically inserts/updates the station_inventory table for us.
    END IF;

  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
