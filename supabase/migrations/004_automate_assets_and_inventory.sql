-- 1. Replace the view to CROSS JOIN stations and inventory_items
-- This ensures all items show up with 0 quantity if they have no stock record yet.
DROP VIEW IF EXISTS v_station_inventory_summary;

CREATE OR REPLACE VIEW v_station_inventory_summary AS
SELECT
  s.code                                   AS station_code,
  s.name                                   AS station_name,
  ii.name                                  AS item_name,
  ii.category,
  ii.unit,
  COALESCE(si.current_stock, 0)            AS current_stock,
  ii.min_stock_level,
  (COALESCE(si.current_stock, 0) <= ii.min_stock_level) AS is_low_stock,
  si.last_updated
FROM inventory_items ii
CROSS JOIN stations s
LEFT JOIN station_inventory si ON si.station_id = s.id AND si.item_id = ii.id
WHERE s.is_active = true
ORDER BY s.code, ii.category, ii.name;

COMMENT ON VIEW v_station_inventory_summary IS
  'Station x item stock summary. Uses CROSS JOIN to show 0-stock items. RLS enforced via underlying tables for clients querying it properly.';

-- 2. Upgrade fn_check_and_update_stock_on_consumption
-- It now checks if the item is a "Consumable" and automatically inserts into Asset Lifecycle
CREATE OR REPLACE FUNCTION fn_check_and_update_stock_on_consumption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_available numeric(10,3);
  v_category text;
BEGIN
  -- Lock the row to prevent concurrent race conditions and fetch category
  SELECT si.current_stock, ii.category
    INTO v_available, v_category
    FROM station_inventory si
    JOIN inventory_items ii ON ii.id = si.item_id
   WHERE si.station_id = NEW.station_id
     AND si.item_id    = NEW.item_id
   FOR UPDATE OF si;

  IF v_available IS NULL THEN
    RAISE EXCEPTION
      'No stock record found for this item at the station. Available: 0, Requested: %',
      NEW.quantity_used;
  END IF;

  IF NEW.quantity_used > v_available THEN
    RAISE EXCEPTION
      'Insufficient stock. Available: %, Requested: %',
      v_available, NEW.quantity_used;
  END IF;

  -- Deduct stock atomically in the same BEFORE trigger
  UPDATE station_inventory
     SET current_stock = current_stock - NEW.quantity_used,
         last_updated  = now()
   WHERE station_id = NEW.station_id
     AND item_id    = NEW.item_id;

  -- Automation: If category is 'Consumable', instantly push to Asset Lifecycle
  IF v_category = 'Consumable' THEN
    INSERT INTO consumable_assets (station_id, item_id, quantity, status, issued_date, updated_by, remarks)
    VALUES (NEW.station_id, NEW.item_id, NEW.quantity_used, 'in_use', NEW.consumption_date, NEW.logged_by, 'Auto-issued via Consumption Log');

    INSERT INTO asset_lifecycle_logs (station_id, item_id, quantity, from_status, to_status, remarks, logged_by)
    VALUES (NEW.station_id, NEW.item_id, NEW.quantity_used, 'Stock', 'in_use', 'Auto-issued via Consumption Log', NEW.logged_by);
  END IF;

  RETURN NEW;
END;
$$;
