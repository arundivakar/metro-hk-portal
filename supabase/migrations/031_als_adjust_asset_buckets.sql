-- 031_als_adjust_asset_buckets.sql
-- RPC for ALS to directly set the in_use / damaged / disposed bucket counts
-- for a station+item in station_inventory, with audit log entry.
-- This is the backend for the "Edit Asset Quantities" modal in AssetLifecycle.jsx.

CREATE OR REPLACE FUNCTION fn_als_adjust_asset_buckets(
    p_station_id  uuid,
    p_item_id     uuid,
    p_in_use      int,
    p_damaged     int,
    p_disposed    int,
    p_remarks     text,
    p_user_id     uuid DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_old_in_use   int;
    v_old_damaged  int;
    v_old_disposed int;
BEGIN
    -- Read current values for audit
    SELECT
        COALESCE(quantity_in_use,   0)::int,
        COALESCE(quantity_damaged,  0)::int,
        COALESCE(quantity_disposed, 0)::int
    INTO v_old_in_use, v_old_damaged, v_old_disposed
    FROM station_inventory
    WHERE station_id = p_station_id AND item_id = p_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No inventory record found for this item at the selected station.';
    END IF;

    -- Update the buckets
    UPDATE station_inventory
       SET quantity_in_use   = p_in_use,
           quantity_damaged  = p_damaged,
           quantity_disposed = p_disposed,
           last_updated      = now()
     WHERE station_id = p_station_id
       AND item_id    = p_item_id;

    -- Write one audit log entry capturing the overall change
    INSERT INTO asset_lifecycle_logs (
        station_id, item_id,
        from_status, to_status,
        quantity,
        remarks,
        logged_by
    ) VALUES (
        p_station_id, p_item_id,
        'manual_edit', 'manual_edit',
        0,  -- no single transition quantity; this is a direct edit
        format(
            'ALS Direct Edit – In Use: %s→%s | Damaged: %s→%s | Disposed: %s→%s | Reason: %s',
            v_old_in_use, p_in_use,
            v_old_damaged, p_damaged,
            v_old_disposed, p_disposed,
            p_remarks
        ),
        p_user_id
    );
END;
$$;
