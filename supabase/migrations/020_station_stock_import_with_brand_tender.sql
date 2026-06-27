-- 020_station_stock_import_with_brand_tender.sql
-- Full reset per station. Matches on Name + Brand + Tender Year.
-- Does NOT insert into stock_received (avoids trigger double-counting).
-- Populates consumable_assets and asset_lifecycle_logs for Consumable items.

CREATE OR REPLACE FUNCTION fn_import_station_stock(p_station_id uuid, p_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  rec           jsonb;
  v_item_name   text;
  v_brand       text;
  v_tender_year text;
  v_item_id     uuid;
  v_category    text;
  v_closing     numeric;
  v_in_use      numeric;
  v_damaged     numeric;
  v_disposed    numeric;
BEGIN
  -- Full reset: clear existing stock data for this station before importing
  DELETE FROM asset_lifecycle_logs WHERE station_id = p_station_id;
  DELETE FROM consumable_assets     WHERE station_id = p_station_id;
  DELETE FROM station_inventory     WHERE station_id = p_station_id;

  FOR rec IN SELECT * FROM jsonb_array_elements(p_payload)
  LOOP
    v_item_name   := TRIM(COALESCE(rec->>'Cleaning Material', ''));
    IF v_item_name = '' THEN CONTINUE; END IF;

    v_brand       := TRIM(COALESCE(rec->>'Brand', ''));
    v_tender_year := TRIM(COALESCE(rec->>'Tender Year', ''));

    -- Match on Name + Brand + Tender Year (falls back gracefully if blank)
    SELECT ii.id, ii.category
      INTO v_item_id, v_category
      FROM inventory_items ii
      JOIN rate_master rm ON rm.id = ii.rate_master_id
     WHERE LOWER(ii.name) = LOWER(v_item_name)
       AND (v_brand       = '' OR LOWER(COALESCE(rm.brand, ''))       = LOWER(v_brand))
       AND (v_tender_year = '' OR LOWER(COALESCE(rm.tender_year, '')) = LOWER(v_tender_year))
     LIMIT 1;

    IF v_item_id IS NULL THEN CONTINUE; END IF;

    BEGIN v_closing  := COALESCE((rec->>'Closing Stock')::numeric, 0);                                         EXCEPTION WHEN OTHERS THEN v_closing  := 0; END;
    BEGIN v_in_use   := COALESCE((rec->>'In Good condition (Currently in Use)')::numeric, 0);                  EXCEPTION WHEN OTHERS THEN v_in_use   := 0; END;
    BEGIN v_damaged  := COALESCE((rec->>'Partially Damaged Items available at station (Usable)')::numeric, 0); EXCEPTION WHEN OTHERS THEN v_damaged  := 0; END;
    BEGIN v_disposed := COALESCE((rec->>'Disposed Items available at station (unusable)')::numeric, 0);        EXCEPTION WHEN OTHERS THEN v_disposed := 0; END;

    -- Set stock directly, not via stock_received
    INSERT INTO station_inventory (
      station_id, item_id, current_stock, quantity_in_use, quantity_damaged, quantity_disposed, last_updated
    ) VALUES (
      p_station_id, v_item_id, v_closing, v_in_use, v_damaged, v_disposed, NOW()
    )
    ON CONFLICT (station_id, item_id) DO UPDATE SET
      current_stock     = EXCLUDED.current_stock,
      quantity_in_use   = EXCLUDED.quantity_in_use,
      quantity_damaged  = EXCLUDED.quantity_damaged,
      quantity_disposed = EXCLUDED.quantity_disposed,
      last_updated      = NOW();

    -- Populate asset lifecycle for Consumable items only
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

  END LOOP;
END;
$func$;
