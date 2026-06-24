-- 1. Add the new column for tracking items issued to cleaners
ALTER TABLE station_inventory ADD COLUMN IF NOT EXISTS quantity_in_use numeric(10,3) DEFAULT 0;

-- 2. Update the Consumption trigger to transfer stock to the new bucket
CREATE OR REPLACE FUNCTION fn_check_and_update_stock_on_consumption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_available numeric(10,3);
BEGIN
  -- Lock the row to prevent concurrent race conditions
  SELECT current_stock
    INTO v_available
    FROM station_inventory
   WHERE station_id = NEW.station_id
     AND item_id    = NEW.item_id
   FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'No stock record found for this item at the station. Available: 0, Requested: %', NEW.quantity_used;
  END IF;

  IF NEW.quantity_used > v_available THEN
    RAISE EXCEPTION 'Insufficient store room stock. Available: %, Requested: %', v_available, NEW.quantity_used;
  END IF;

  -- Deduct store room stock, increment in-use stock
  UPDATE station_inventory
     SET current_stock = current_stock - NEW.quantity_used,
         quantity_in_use = COALESCE(quantity_in_use, 0) + NEW.quantity_used,
         last_updated  = now()
   WHERE station_id = NEW.station_id
     AND item_id    = NEW.item_id;

  RETURN NEW;
END;
$$;

-- 3. Update the Consumption Edit RPC to adjust BOTH buckets
CREATE OR REPLACE FUNCTION fn_edit_consumption(p_log_id uuid, p_new_quantity numeric, p_new_date date, p_remarks text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_log record; v_diff numeric;
BEGIN
    SELECT * INTO v_log FROM consumption_logs WHERE id = p_log_id FOR UPDATE;
    v_diff := p_new_quantity - v_log.quantity_used;
    
    UPDATE station_inventory SET 
        current_stock = current_stock - v_diff,
        quantity_in_use = COALESCE(quantity_in_use, 0) + v_diff
    WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    
    UPDATE consumption_logs SET quantity_used = p_new_quantity, consumption_date = p_new_date, remarks = p_remarks WHERE id = p_log_id;
END;
$$;

-- 4. Update the Consumption Delete RPC to adjust BOTH buckets
CREATE OR REPLACE FUNCTION fn_delete_consumption(p_log_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_log record;
BEGIN
    SELECT * INTO v_log FROM consumption_logs WHERE id = p_log_id FOR UPDATE;
    
    UPDATE station_inventory SET 
        current_stock = current_stock + v_log.quantity_used,
        quantity_in_use = GREATEST(COALESCE(quantity_in_use, 0) - v_log.quantity_used, 0)
    WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    
    DELETE FROM consumption_logs WHERE id = p_log_id;
END;
$$;

-- 5. Update Asset Bucket Transitions to pull from quantity_in_use
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
      IF v_inventory.quantity_in_use < p_quantity THEN
          RAISE EXCEPTION 'Insufficient In-Use stock to transition.';
      END IF;
      -- Decrement In-Use
      UPDATE station_inventory SET quantity_in_use = quantity_in_use - p_quantity, last_updated = now() 
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

-- 6. Update Asset Log Editing to pull from quantity_in_use
CREATE OR REPLACE FUNCTION fn_edit_asset_log(p_log_id uuid, p_new_quantity numeric, p_remarks text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_log record; v_diff numeric;
BEGIN
    SELECT * INTO v_log FROM asset_lifecycle_logs WHERE id = p_log_id FOR UPDATE;
    v_diff := p_new_quantity - v_log.quantity;
    
    IF v_log.from_status = 'in_use' THEN UPDATE station_inventory SET quantity_in_use = quantity_in_use - v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.from_status = 'partially_damaged' THEN UPDATE station_inventory SET quantity_damaged = quantity_damaged - v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id; END IF;

    IF v_log.to_status = 'partially_damaged' THEN UPDATE station_inventory SET quantity_damaged = COALESCE(quantity_damaged, 0) + v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.to_status = 'disposed' THEN UPDATE station_inventory SET quantity_disposed = COALESCE(quantity_disposed, 0) + v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id; END IF;
    
    UPDATE asset_lifecycle_logs SET quantity = p_new_quantity, remarks = p_remarks WHERE id = p_log_id;
END;
$$;

-- 7. Update Asset Log Deleting to pull from quantity_in_use
CREATE OR REPLACE FUNCTION fn_delete_asset_log(p_log_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_log record;
BEGIN
    SELECT * INTO v_log FROM asset_lifecycle_logs WHERE id = p_log_id FOR UPDATE;
    
    IF v_log.from_status = 'in_use' THEN UPDATE station_inventory SET quantity_in_use = quantity_in_use + v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.from_status = 'partially_damaged' THEN UPDATE station_inventory SET quantity_damaged = quantity_damaged + v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id; END IF;

    IF v_log.to_status = 'partially_damaged' THEN UPDATE station_inventory SET quantity_damaged = COALESCE(quantity_damaged, 0) - v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.to_status = 'disposed' THEN UPDATE station_inventory SET quantity_disposed = COALESCE(quantity_disposed, 0) - v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id; END IF;
    
    DELETE FROM asset_lifecycle_logs WHERE id = p_log_id;
END;
$$;
