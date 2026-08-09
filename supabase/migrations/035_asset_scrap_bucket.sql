-- 1. Add quantity_scrapped column
ALTER TABLE station_inventory ADD COLUMN IF NOT EXISTS quantity_scrapped numeric(10,3) DEFAULT 0;

-- 2. Update Transition RPC to handle disposed -> scrapped
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
          RAISE EXCEPTION 'Insufficient Good Condition stock to transition.';
      END IF;
      -- Decrement Good
      UPDATE station_inventory SET quantity_in_use = quantity_in_use - p_quantity, last_updated = now() 
      WHERE station_id = p_station_id AND item_id = p_item_id;
  ELSIF p_from_status = 'partially_damaged' THEN
      IF COALESCE(v_inventory.quantity_damaged, 0) < p_quantity THEN
          RAISE EXCEPTION 'Insufficient Damaged stock to transition.';
      END IF;
      -- Decrement Damaged
      UPDATE station_inventory SET quantity_damaged = quantity_damaged - p_quantity, last_updated = now() 
      WHERE station_id = p_station_id AND item_id = p_item_id;
  ELSIF p_from_status = 'disposed' THEN
      IF COALESCE(v_inventory.quantity_disposed, 0) < p_quantity THEN
          RAISE EXCEPTION 'Insufficient Disposed stock to transition.';
      END IF;
      -- Decrement Disposed
      UPDATE station_inventory SET quantity_disposed = quantity_disposed - p_quantity, last_updated = now() 
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
  ELSIF p_to_status = 'scrapped' THEN
      UPDATE station_inventory SET quantity_scrapped = COALESCE(quantity_scrapped, 0) + p_quantity 
      WHERE station_id = p_station_id AND item_id = p_item_id;
  ELSE
      RAISE EXCEPTION 'Invalid target status.';
  END IF;

  -- Log to history
  INSERT INTO asset_lifecycle_logs (station_id, item_id, quantity, from_status, to_status, remarks, logged_by)
  VALUES (p_station_id, p_item_id, p_quantity, p_from_status, p_to_status, p_remarks, p_user_id);
END;
$$;

-- 3. Update Edit RPC
CREATE OR REPLACE FUNCTION fn_edit_asset_log(p_log_id uuid, p_new_quantity numeric, p_remarks text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_log record; v_diff numeric;
BEGIN
    SELECT * INTO v_log FROM asset_lifecycle_logs WHERE id = p_log_id FOR UPDATE;
    v_diff := p_new_quantity - v_log.quantity;
    
    -- Reverse source
    IF v_log.from_status = 'in_use' THEN UPDATE station_inventory SET quantity_in_use = quantity_in_use - v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.from_status = 'partially_damaged' THEN UPDATE station_inventory SET quantity_damaged = quantity_damaged - v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.from_status = 'disposed' THEN UPDATE station_inventory SET quantity_disposed = quantity_disposed - v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    END IF;

    -- Reverse target
    IF v_log.to_status = 'partially_damaged' THEN UPDATE station_inventory SET quantity_damaged = COALESCE(quantity_damaged, 0) + v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.to_status = 'disposed' THEN UPDATE station_inventory SET quantity_disposed = COALESCE(quantity_disposed, 0) + v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.to_status = 'scrapped' THEN UPDATE station_inventory SET quantity_scrapped = COALESCE(quantity_scrapped, 0) + v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    END IF;
    
    UPDATE asset_lifecycle_logs SET quantity = p_new_quantity, remarks = p_remarks WHERE id = p_log_id;
END;
$$;

-- 4. Update Delete RPC
CREATE OR REPLACE FUNCTION fn_delete_asset_log(p_log_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_log record;
BEGIN
    SELECT * INTO v_log FROM asset_lifecycle_logs WHERE id = p_log_id FOR UPDATE;
    
    -- Refund source
    IF v_log.from_status = 'in_use' THEN UPDATE station_inventory SET quantity_in_use = quantity_in_use + v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.from_status = 'partially_damaged' THEN UPDATE station_inventory SET quantity_damaged = quantity_damaged + v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.from_status = 'disposed' THEN UPDATE station_inventory SET quantity_disposed = quantity_disposed + v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    END IF;

    -- Deduct target
    IF v_log.to_status = 'partially_damaged' THEN UPDATE station_inventory SET quantity_damaged = COALESCE(quantity_damaged, 0) - v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.to_status = 'disposed' THEN UPDATE station_inventory SET quantity_disposed = COALESCE(quantity_disposed, 0) - v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.to_status = 'scrapped' THEN UPDATE station_inventory SET quantity_scrapped = COALESCE(quantity_scrapped, 0) - v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    END IF;
    
    DELETE FROM asset_lifecycle_logs WHERE id = p_log_id;
END;
$$;

-- 5. Update ALS override RPC
CREATE OR REPLACE FUNCTION fn_als_adjust_asset_buckets(
    p_station_id uuid,
    p_item_id uuid,
    p_in_use numeric,
    p_damaged numeric,
    p_disposed numeric,
    p_scrapped numeric DEFAULT NULL,
    p_remarks text DEFAULT '',
    p_user_id uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_old_in_use numeric;
    v_old_damaged numeric;
    v_old_disposed numeric;
    v_old_scrapped numeric;
BEGIN
    -- 1. Grab current values
    SELECT COALESCE(quantity_in_use, 0), COALESCE(quantity_damaged, 0), COALESCE(quantity_disposed, 0), COALESCE(quantity_scrapped, 0)
      INTO v_old_in_use, v_old_damaged, v_old_disposed, v_old_scrapped
      FROM station_inventory
     WHERE station_id = p_station_id AND item_id = p_item_id;

    -- If no record exists yet, the select above returned NULLs, so treat as 0
    IF NOT FOUND THEN
       v_old_in_use := 0; v_old_damaged := 0; v_old_disposed := 0; v_old_scrapped := 0;
       
       INSERT INTO station_inventory (station_id, item_id, quantity_in_use, quantity_damaged, quantity_disposed, quantity_scrapped, current_stock)
       VALUES (p_station_id, p_item_id, p_in_use, p_damaged, p_disposed, COALESCE(p_scrapped, 0), 0);
    ELSE
       -- 2. Update the row directly
       UPDATE station_inventory
          SET quantity_in_use   = p_in_use,
              quantity_damaged  = p_damaged,
              quantity_disposed = p_disposed,
              quantity_scrapped = COALESCE(p_scrapped, quantity_scrapped, 0),
              last_updated      = now()
        WHERE station_id = p_station_id AND item_id = p_item_id;
    END IF;

    -- 3. Log the forceful override if any bucket changed
    IF (v_old_in_use <> p_in_use) OR (v_old_damaged <> p_damaged) OR (v_old_disposed <> p_disposed) OR (p_scrapped IS NOT NULL AND v_old_scrapped <> p_scrapped) THEN
       INSERT INTO asset_lifecycle_logs (
           station_id, item_id, quantity, 
           from_status, to_status, 
           remarks, logged_by
       ) VALUES (
           p_station_id, p_item_id, 0,
           'override', 'override',
           'ALS Override. ' ||
           'In-Use: ' || v_old_in_use || '->' || p_in_use || '. ' ||
           'Damaged: ' || v_old_damaged || '->' || p_damaged || '. ' ||
           'Disposed: ' || v_old_disposed || '->' || p_disposed || '. ' ||
           'Scrapped: ' || v_old_scrapped || '->' || COALESCE(p_scrapped, v_old_scrapped) || '. ' ||
           'Reason: ' || p_remarks,
           p_user_id
       );
    END IF;
END;
$$;
