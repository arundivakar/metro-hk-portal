-- RPC to manually adjust stock of a single item at a single station bypassing RLS
CREATE OR REPLACE FUNCTION fn_adjust_single_stock(p_station_id uuid, p_item_id uuid, p_new_stock numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO station_inventory (station_id, item_id, current_stock, last_updated)
    VALUES (p_station_id, p_item_id, p_new_stock, now())
    ON CONFLICT (station_id, item_id)
    DO UPDATE SET 
        current_stock = p_new_stock, 
        last_updated = now();
END;
$$;
