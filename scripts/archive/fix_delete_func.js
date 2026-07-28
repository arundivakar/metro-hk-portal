import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const sql = `
CREATE OR REPLACE FUNCTION fn_delete_stock_received(p_log_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_log record;
    v_source_log_id uuid;
BEGIN
    SELECT * INTO v_log FROM stock_received WHERE id = p_log_id FOR UPDATE;
    IF v_log IS NULL THEN RAISE EXCEPTION 'Log not found'; END IF;

    -- Revert destination inventory
    UPDATE station_inventory SET current_stock = current_stock - v_log.quantity 
    WHERE station_id = v_log.station_id AND item_id = v_log.item_id;

    -- If it's an inter-station transfer, revert the source station too
    IF v_log.source_station_id IS NOT NULL THEN
        -- Find the corresponding consumption log at the source station
        SELECT id INTO v_source_log_id FROM consumption_logs 
        WHERE station_id = v_log.source_station_id 
          AND item_id = v_log.item_id 
          AND consumption_date = v_log.received_date
          AND quantity_used = v_log.quantity
          AND remarks LIKE 'Inter-station Transfer to%'
        LIMIT 1;

        IF v_source_log_id IS NOT NULL THEN
            -- Add stock back to source
            UPDATE station_inventory SET current_stock = current_stock + v_log.quantity 
            WHERE station_id = v_log.source_station_id AND item_id = v_log.item_id;
            
            -- Delete the source consumption log
            DELETE FROM consumption_logs WHERE id = v_source_log_id;
        END IF;
    END IF;
    
    -- Delete the receipt log
    DELETE FROM stock_received WHERE id = p_log_id;
END;
$$;
  `;
  
  // Since we can't reliably run raw SQL through the REST API without an RPC,
  // I will just put this in a migration file and tell the user to execute it in Supabase SQL editor.
}
run();
