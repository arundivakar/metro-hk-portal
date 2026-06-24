-- RPC to transition asset quantities between buckets (Good, Damaged, Disposed)
CREATE OR REPLACE FUNCTION fn_transition_asset_bucket(
    p_station_id uuid, 
    p_item_id uuid, 
    p_from_status text, 
    p_to_status text, 
    p_quantity numeric, 
    p_remarks text, 
    p_user_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inventory record;
BEGIN
  -- Lock row for update
  SELECT * INTO v_inventory FROM station_inventory 
  WHERE station_id = p_station_id AND item_id = p_item_id 
  FOR UPDATE;
  
  IF v_inventory IS NULL THEN
    RAISE EXCEPTION 'Inventory record not found.';
  END IF;

  -- Validate source quantity
  IF p_from_status = 'in_use' THEN
      IF v_inventory.current_stock < p_quantity THEN
          RAISE EXCEPTION 'Insufficient Good Condition stock to transition.';
      END IF;
      -- Decrement Good
      UPDATE station_inventory SET current_stock = current_stock - p_quantity, last_updated = now() 
      WHERE station_id = p_station_id AND item_id = p_item_id;
  ELSIF p_from_status = 'partially_damaged' THEN
      IF v_inventory.quantity_damaged < p_quantity THEN
          RAISE EXCEPTION 'Insufficient Damaged stock to transition.';
      END IF;
      -- Decrement Damaged
      UPDATE station_inventory SET quantity_damaged = quantity_damaged - p_quantity, last_updated = now() 
      WHERE station_id = p_station_id AND item_id = p_item_id;
  ELSE
      RAISE EXCEPTION 'Invalid source status.';
  END IF;

  -- Increment target quantity
  IF p_to_status = 'partially_damaged' THEN
      UPDATE station_inventory SET quantity_damaged = COALESCE(quantity_damaged, 0) + p_quantity 
      WHERE station_id = p_station_id AND item_id = p_item_id;
  ELSIF p_to_status = 'disposed' THEN
      UPDATE station_inventory SET quantity_disposed = COALESCE(quantity_disposed, 0) + p_quantity 
      WHERE station_id = p_station_id AND item_id = p_item_id;
  ELSE
      RAISE EXCEPTION 'Invalid target status.';
  END IF;

  -- Log to history
  INSERT INTO asset_lifecycle_logs (station_id, item_id, quantity, from_status, to_status, remarks, logged_by)
  VALUES (p_station_id, p_item_id, p_quantity, p_from_status, p_to_status, p_remarks, p_user_id);
END;
$$;
