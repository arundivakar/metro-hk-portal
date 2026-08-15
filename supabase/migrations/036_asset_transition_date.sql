-- =============================================================================
-- Metro Housekeeping Inventory Portal
-- Migration: 036_asset_transition_date.sql
-- Description: Add transition_date to asset_lifecycle_logs and update RPCs
-- =============================================================================

-- 1. Add transition_date column (defaults to current date for backwards compat)
ALTER TABLE asset_lifecycle_logs 
  ADD COLUMN IF NOT EXISTS transition_date date DEFAULT CURRENT_DATE;

-- Back-fill existing rows so transition_date mirrors the log creation date
UPDATE asset_lifecycle_logs 
  SET transition_date = created_at::date 
  WHERE transition_date IS NULL;

-- 2. Re-create fn_transition_asset_bucket to accept optional transition date
CREATE OR REPLACE FUNCTION fn_transition_asset_bucket(
    p_station_id uuid, 
    p_item_id uuid, 
    p_from_status text, 
    p_to_status text, 
    p_quantity numeric, 
    p_remarks text, 
    p_user_id uuid,
    p_transition_date date DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inventory record;
BEGIN
  SELECT * INTO v_inventory FROM station_inventory 
  WHERE station_id = p_station_id AND item_id = p_item_id 
  FOR UPDATE;
  
  IF v_inventory IS NULL THEN
    RAISE EXCEPTION 'Inventory record not found.';
  END IF;

  IF p_from_status = 'in_use' THEN
      IF v_inventory.quantity_in_use < p_quantity THEN
          RAISE EXCEPTION 'Insufficient Good Condition stock to transition.';
      END IF;
      UPDATE station_inventory SET quantity_in_use = quantity_in_use - p_quantity, last_updated = now() 
      WHERE station_id = p_station_id AND item_id = p_item_id;
  ELSIF p_from_status = 'partially_damaged' THEN
      IF COALESCE(v_inventory.quantity_damaged, 0) < p_quantity THEN
          RAISE EXCEPTION 'Insufficient Damaged stock to transition.';
      END IF;
      UPDATE station_inventory SET quantity_damaged = quantity_damaged - p_quantity, last_updated = now() 
      WHERE station_id = p_station_id AND item_id = p_item_id;
  ELSIF p_from_status = 'disposed' THEN
      IF COALESCE(v_inventory.quantity_disposed, 0) < p_quantity THEN
          RAISE EXCEPTION 'Insufficient Disposed stock to transition.';
      END IF;
      UPDATE station_inventory SET quantity_disposed = quantity_disposed - p_quantity, last_updated = now() 
      WHERE station_id = p_station_id AND item_id = p_item_id;
  ELSE
      RAISE EXCEPTION 'Invalid source status.';
  END IF;

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

  INSERT INTO asset_lifecycle_logs 
    (station_id, item_id, quantity, from_status, to_status, remarks, logged_by, transition_date)
  VALUES 
    (p_station_id, p_item_id, p_quantity, p_from_status, p_to_status, p_remarks, p_user_id,
     COALESCE(p_transition_date, CURRENT_DATE));
END;
$$;

-- 3. Re-create fn_edit_asset_log to also allow editing transition_date
CREATE OR REPLACE FUNCTION fn_edit_asset_log(
    p_log_id uuid, 
    p_new_quantity numeric, 
    p_remarks text,
    p_transition_date date DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_log record; v_diff numeric;
BEGIN
    SELECT * INTO v_log FROM asset_lifecycle_logs WHERE id = p_log_id FOR UPDATE;
    v_diff := p_new_quantity - v_log.quantity;
    
    IF v_log.from_status = 'in_use' THEN UPDATE station_inventory SET quantity_in_use = quantity_in_use - v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.from_status = 'partially_damaged' THEN UPDATE station_inventory SET quantity_damaged = quantity_damaged - v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.from_status = 'disposed' THEN UPDATE station_inventory SET quantity_disposed = quantity_disposed - v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    END IF;

    IF v_log.to_status = 'partially_damaged' THEN UPDATE station_inventory SET quantity_damaged = COALESCE(quantity_damaged, 0) + v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.to_status = 'disposed' THEN UPDATE station_inventory SET quantity_disposed = COALESCE(quantity_disposed, 0) + v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.to_status = 'scrapped' THEN UPDATE station_inventory SET quantity_scrapped = COALESCE(quantity_scrapped, 0) + v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    END IF;
    
    UPDATE asset_lifecycle_logs 
      SET quantity = p_new_quantity, 
          remarks = p_remarks,
          transition_date = COALESCE(p_transition_date, transition_date)
      WHERE id = p_log_id;
END;
$$;
