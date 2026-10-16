-- 037_fix_depot_transfer.sql
-- Fixes the double-deduction and quantity_in_use inflation bugs for Depot Transfers.

-- 1. Patch Depot Transfer RPC to remove the manual current_stock deduction.
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

  -- Write an audit consumption_log entry
  -- This natively triggers fn_check_and_update_stock_on_consumption for the single deduction
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


-- 2. Patch consumption trigger function to skip quantity_in_use inflation for Depot Transfers.
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

  -- Deduct store room stock, and conditionally increment in-use stock
  UPDATE station_inventory
     SET current_stock = current_stock - NEW.quantity_used,
         quantity_in_use = CASE 
             WHEN NEW.remarks LIKE 'Depot Transfer Out%' THEN COALESCE(quantity_in_use, 0)
             ELSE COALESCE(quantity_in_use, 0) + NEW.quantity_used
         END,
         last_updated  = now()
   WHERE station_id = NEW.station_id
     AND item_id    = NEW.item_id;

  RETURN NEW;
END;
$$;


-- 3. Patch consumption deletion to skip quantity_in_use deflation for Depot Transfers.
CREATE OR REPLACE FUNCTION fn_delete_consumption(p_log_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE 
    v_log record;
    v_to_code text;
    v_to_id uuid;
    v_paired_log record;
BEGIN
    SELECT * INTO v_log FROM consumption_logs WHERE id = p_log_id FOR UPDATE;
    IF v_log IS NULL THEN RAISE EXCEPTION 'Log not found'; END IF;
    
    -- Refund source inventory and conditionally deflate quantity_in_use
    UPDATE station_inventory SET 
        current_stock = current_stock + v_log.quantity_used,
        quantity_in_use = CASE
            WHEN v_log.remarks LIKE 'Depot Transfer Out%' THEN COALESCE(quantity_in_use, 0)
            ELSE COALESCE(quantity_in_use, 0) - v_log.quantity_used
        END
    WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    
    -- Check if it's an Inter-Station transfer
    IF v_log.remarks LIKE 'Inter-Station Transfer Out to %' THEN
        v_to_code := substring(v_log.remarks from 31);
        SELECT id INTO v_to_id FROM stations WHERE code = v_to_code;
        
        -- Find matching stock_received log
        IF v_to_id IS NOT NULL THEN
            SELECT * INTO v_paired_log FROM stock_received
            WHERE station_id = v_to_id 
              AND item_id = v_log.item_id 
              AND quantity = v_log.quantity_used 
              AND received_date = v_log.consumption_date 
              AND supplier LIKE 'Station Transfer from %'
            LIMIT 1;
            
            IF v_paired_log IS NOT NULL THEN
                -- Revert destination inventory
                UPDATE station_inventory 
                SET current_stock = current_stock - v_paired_log.quantity 
                WHERE station_id = v_to_id AND item_id = v_log.item_id;
                
                -- Delete destination log
                DELETE FROM stock_received WHERE id = v_paired_log.id;
            END IF;
        END IF;
    END IF;

    DELETE FROM consumption_logs WHERE id = p_log_id;
END;
$$;


-- 4. Patch consumption editing to safely preserve Depot Transfer identity and skip quantity_in_use modification.
CREATE OR REPLACE FUNCTION fn_edit_consumption(p_log_id uuid, p_new_quantity numeric, p_new_date date, p_remarks text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_log record; v_diff numeric;
BEGIN
    SELECT * INTO v_log FROM consumption_logs WHERE id = p_log_id FOR UPDATE;
    
    v_diff := p_new_quantity - v_log.quantity_used;
    
    -- Safely enforce Depot Transfer identity on edit
    IF v_log.remarks LIKE 'Depot Transfer Out%' THEN
        IF p_remarks IS NULL OR p_remarks = '' THEN
            p_remarks := 'Depot Transfer Out';
        ELSIF p_remarks NOT LIKE 'Depot Transfer Out%' THEN
            p_remarks := 'Depot Transfer Out - ' || p_remarks;
        END IF;
    END IF;
    
    UPDATE station_inventory SET 
        current_stock = current_stock - v_diff,
        quantity_in_use = CASE
            WHEN v_log.remarks LIKE 'Depot Transfer Out%' THEN COALESCE(quantity_in_use, 0)
            ELSE COALESCE(quantity_in_use, 0) + v_diff
        END
    WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    
    UPDATE consumption_logs SET quantity_used = p_new_quantity, consumption_date = p_new_date, remarks = p_remarks WHERE id = p_log_id;
END;
$$;
