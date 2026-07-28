-- 030_opening_stock_corrections.sql
-- Audit table and RPC for one-time July Opening Stock corrections.
-- This is a stabilization-phase tool only. Does not alter any transaction logs.

-- Audit table
CREATE TABLE IF NOT EXISTS opening_stock_corrections (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id          uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    item_id             uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    old_opening_stock   numeric(10,3) NOT NULL,   -- stored in base units (ml / g / Nos)
    new_opening_stock   numeric(10,3) NOT NULL,
    delta               numeric(10,3) NOT NULL,
    reason              text NOT NULL,
    applied_by          uuid REFERENCES users_profile(id),
    applied_at          timestamptz DEFAULT now()
);

-- RLS: ALS can insert; all authenticated users can read
ALTER TABLE opening_stock_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ALS can insert corrections"
ON opening_stock_corrections FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can read corrections"
ON opening_stock_corrections FOR SELECT
TO authenticated
USING (true);

-- RPC: applies the delta to current_stock and writes the audit record atomically
CREATE OR REPLACE FUNCTION fn_correct_july_opening_stock(
    p_station_id        uuid,
    p_item_id           uuid,
    p_old_opening_stock numeric,   -- base units
    p_new_opening_stock numeric,   -- base units
    p_reason            text,
    p_applied_by        uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_delta numeric;
BEGIN
    v_delta := p_new_opening_stock - p_old_opening_stock;

    IF v_delta = 0 THEN
        RAISE EXCEPTION 'No change detected. Old and new values are identical.';
    END IF;

    -- Adjust current_stock by delta (positive delta = more stock, negative = less)
    UPDATE station_inventory
       SET current_stock = current_stock + v_delta,
           last_updated  = now()
     WHERE station_id = p_station_id
       AND item_id    = p_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No inventory record found for this item at the selected station.';
    END IF;

    -- Write audit record
    INSERT INTO opening_stock_corrections (
        station_id, item_id,
        old_opening_stock, new_opening_stock, delta,
        reason, applied_by
    ) VALUES (
        p_station_id, p_item_id,
        p_old_opening_stock, p_new_opening_stock, v_delta,
        p_reason, p_applied_by
    );
END;
$$;
