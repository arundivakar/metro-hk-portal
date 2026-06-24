-- 1. Stock Received
CREATE OR REPLACE FUNCTION fn_edit_stock_received(p_log_id uuid, p_new_quantity numeric, p_new_date date, p_remarks text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_log record;
    v_diff numeric;
BEGIN
    SELECT * INTO v_log FROM stock_received WHERE id = p_log_id FOR UPDATE;
    IF v_log IS NULL THEN RAISE EXCEPTION 'Log not found'; END IF;

    v_diff := p_new_quantity - v_log.quantity;
    
    -- Update inventory (receiving adds stock)
    UPDATE station_inventory SET current_stock = current_stock + v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    
    -- Update log
    UPDATE stock_received SET quantity = p_new_quantity, received_date = p_new_date, remarks = p_remarks WHERE id = p_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_delete_stock_received(p_log_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_log record;
BEGIN
    SELECT * INTO v_log FROM stock_received WHERE id = p_log_id FOR UPDATE;
    IF v_log IS NULL THEN RAISE EXCEPTION 'Log not found'; END IF;

    -- Revert inventory
    UPDATE station_inventory SET current_stock = current_stock - v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    
    -- Delete log
    DELETE FROM stock_received WHERE id = p_log_id;
END;
$$;

-- 2. Consumption Logs
CREATE OR REPLACE FUNCTION fn_edit_consumption(p_log_id uuid, p_new_quantity numeric, p_new_date date, p_remarks text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_log record;
    v_diff numeric;
BEGIN
    SELECT * INTO v_log FROM consumption_logs WHERE id = p_log_id FOR UPDATE;
    IF v_log IS NULL THEN RAISE EXCEPTION 'Log not found'; END IF;

    v_diff := p_new_quantity - v_log.quantity_used;
    
    -- Update inventory (consumption reduces stock, so positive diff means MORE consumption -> LESS stock)
    UPDATE station_inventory SET current_stock = current_stock - v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    
    -- Update log
    UPDATE consumption_logs SET quantity_used = p_new_quantity, consumption_date = p_new_date, remarks = p_remarks WHERE id = p_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_delete_consumption(p_log_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_log record;
BEGIN
    SELECT * INTO v_log FROM consumption_logs WHERE id = p_log_id FOR UPDATE;
    IF v_log IS NULL THEN RAISE EXCEPTION 'Log not found'; END IF;

    -- Revert inventory
    UPDATE station_inventory SET current_stock = current_stock + v_log.quantity_used WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    
    -- Delete log
    DELETE FROM consumption_logs WHERE id = p_log_id;
END;
$$;

-- 3. Asset Lifecycle Logs
CREATE OR REPLACE FUNCTION fn_edit_asset_log(p_log_id uuid, p_new_quantity numeric, p_remarks text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_log record;
    v_diff numeric;
BEGIN
    SELECT * INTO v_log FROM asset_lifecycle_logs WHERE id = p_log_id FOR UPDATE;
    IF v_log IS NULL THEN RAISE EXCEPTION 'Log not found'; END IF;

    v_diff := p_new_quantity - v_log.quantity;
    
    -- Decrement Source Bucket
    IF v_log.from_status = 'in_use' THEN
        UPDATE station_inventory SET current_stock = current_stock - v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.from_status = 'partially_damaged' THEN
        UPDATE station_inventory SET quantity_damaged = quantity_damaged - v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    END IF;

    -- Increment Target Bucket
    IF v_log.to_status = 'partially_damaged' THEN
        UPDATE station_inventory SET quantity_damaged = COALESCE(quantity_damaged, 0) + v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.to_status = 'disposed' THEN
        UPDATE station_inventory SET quantity_disposed = COALESCE(quantity_disposed, 0) + v_diff WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    END IF;

    -- Update log
    UPDATE asset_lifecycle_logs SET quantity = p_new_quantity, remarks = p_remarks WHERE id = p_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_delete_asset_log(p_log_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_log record;
BEGIN
    SELECT * INTO v_log FROM asset_lifecycle_logs WHERE id = p_log_id FOR UPDATE;
    IF v_log IS NULL THEN RAISE EXCEPTION 'Log not found'; END IF;

    -- Revert Source Bucket (add back the quantity)
    IF v_log.from_status = 'in_use' THEN
        UPDATE station_inventory SET current_stock = current_stock + v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.from_status = 'partially_damaged' THEN
        UPDATE station_inventory SET quantity_damaged = quantity_damaged + v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    END IF;

    -- Revert Target Bucket (remove the quantity)
    IF v_log.to_status = 'partially_damaged' THEN
        UPDATE station_inventory SET quantity_damaged = COALESCE(quantity_damaged, 0) - v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    ELSIF v_log.to_status = 'disposed' THEN
        UPDATE station_inventory SET quantity_disposed = COALESCE(quantity_disposed, 0) - v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    END IF;

    -- Delete log
    DELETE FROM asset_lifecycle_logs WHERE id = p_log_id;
END;
$$;
