-- Updates the delete RPCs to cascade delete Inter-Station Transfers

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
    
    -- Refund source inventory
    UPDATE station_inventory SET 
        current_stock = current_stock + v_log.quantity_used,
        quantity_in_use = GREATEST(COALESCE(quantity_in_use, 0) - v_log.quantity_used, 0)
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


CREATE OR REPLACE FUNCTION fn_delete_stock_received(p_log_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_log record;
    v_from_code text;
    v_from_id uuid;
    v_paired_log record;
BEGIN
    SELECT * INTO v_log FROM stock_received WHERE id = p_log_id FOR UPDATE;
    IF v_log IS NULL THEN RAISE EXCEPTION 'Log not found'; END IF;

    -- Revert inventory
    UPDATE station_inventory SET current_stock = current_stock - v_log.quantity WHERE station_id = v_log.station_id AND item_id = v_log.item_id;
    
    -- Check if it's an Inter-Station transfer
    IF v_log.supplier LIKE 'Station Transfer from %' THEN
        v_from_code := substring(v_log.supplier from 23);
        SELECT id INTO v_from_id FROM stations WHERE code = v_from_code;
        
        -- Find matching consumption log
        IF v_from_id IS NOT NULL THEN
            SELECT * INTO v_paired_log FROM consumption_logs 
            WHERE station_id = v_from_id 
              AND item_id = v_log.item_id 
              AND quantity_used = v_log.quantity 
              AND consumption_date = v_log.received_date 
              AND remarks LIKE 'Inter-Station Transfer Out to %'
            LIMIT 1;
            
            IF v_paired_log IS NOT NULL THEN
                -- Revert source inventory
                UPDATE station_inventory SET 
                    current_stock = current_stock + v_paired_log.quantity_used,
                    quantity_in_use = GREATEST(COALESCE(quantity_in_use, 0) - v_paired_log.quantity_used, 0)
                WHERE station_id = v_from_id AND item_id = v_log.item_id;
                
                -- Delete source log
                DELETE FROM consumption_logs WHERE id = v_paired_log.id;
            END IF;
        END IF;
    END IF;

    -- Delete log
    DELETE FROM stock_received WHERE id = p_log_id;
END;
$$;
