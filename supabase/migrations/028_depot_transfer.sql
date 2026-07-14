-- fn_transfer_to_depot
-- Called by MUTT SC to send stock from any source station to the physical Depot.
-- Deducts stock from the source station and writes a consumption_log entry
-- (matching the Inter-Station Transfer Out pattern so it is excluded from billing).
CREATE OR REPLACE FUNCTION fn_transfer_to_depot(
  p_source_station_id   uuid,
  p_item_id             uuid,
  p_quantity            numeric,
  p_transfer_date       date,
  p_source_station_code text,
  p_logged_by           uuid,
  p_remarks             text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_available numeric;
BEGIN
  -- Check available stock
  SELECT current_stock INTO v_available
  FROM station_inventory
  WHERE station_id = p_source_station_id AND item_id = p_item_id;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'No inventory record found for this item at the source station.';
  END IF;

  IF p_quantity > v_available THEN
    RAISE EXCEPTION 'Insufficient stock at %. Available: %', p_source_station_code, v_available;
  END IF;

  -- Deduct from source station
  UPDATE station_inventory
  SET current_stock = current_stock - p_quantity,
      last_updated  = now()
  WHERE station_id = p_source_station_id AND item_id = p_item_id;

  -- Write an audit consumption_log entry (excluded from billing via the remark prefix)
  INSERT INTO consumption_logs (station_id, item_id, quantity_used, consumption_date, remarks, logged_by)
  VALUES (
    p_source_station_id,
    p_item_id,
    p_quantity,
    p_transfer_date,
    CONCAT(
      'Depot Transfer Out',
      CASE WHEN p_remarks IS NOT NULL AND p_remarks <> '' THEN ' - ' || p_remarks ELSE '' END
    ),
    p_logged_by
  );
END;
$$;
