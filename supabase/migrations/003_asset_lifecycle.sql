-- 1. Create asset_lifecycle_logs table for History Log
CREATE TABLE IF NOT EXISTS asset_lifecycle_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    station_id uuid REFERENCES stations(id) NOT NULL,
    item_id uuid REFERENCES inventory_items(id) NOT NULL,
    quantity numeric(10,3) NOT NULL,
    from_status text,
    to_status text NOT NULL,
    remarks text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    logged_by uuid REFERENCES users_profile(id)
);

-- Enable RLS
ALTER TABLE asset_lifecycle_logs ENABLE ROW LEVEL SECURITY;

-- Policies for asset_lifecycle_logs
DROP POLICY IF EXISTS "asset_lifecycle_logs_select" ON asset_lifecycle_logs;
CREATE POLICY "asset_lifecycle_logs_select"
  ON asset_lifecycle_logs FOR SELECT TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS'
    OR station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "asset_lifecycle_logs_insert" ON asset_lifecycle_logs;
CREATE POLICY "asset_lifecycle_logs_insert"
  ON asset_lifecycle_logs FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'SC'
    AND station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  );

-- 2. RPC to Issue Consumable from Station Inventory directly into Asset Lifecycle
CREATE OR REPLACE FUNCTION fn_issue_consumable_asset(p_station_id uuid, p_item_id uuid, p_quantity numeric, p_remarks text, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    -- Deduct from inventory
    UPDATE station_inventory 
    SET current_stock = current_stock - p_quantity, last_updated = now()
    WHERE station_id = p_station_id AND item_id = p_item_id AND current_stock >= p_quantity;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient stock in inventory to issue this quantity.';
    END IF;

    -- Add to consumable_assets
    INSERT INTO consumable_assets (station_id, item_id, quantity, status, issued_date, updated_by, remarks)
    VALUES (p_station_id, p_item_id, p_quantity, 'in_use', CURRENT_DATE, p_user_id, p_remarks);

    -- Log to history
    INSERT INTO asset_lifecycle_logs (station_id, item_id, quantity, from_status, to_status, remarks, logged_by)
    VALUES (p_station_id, p_item_id, p_quantity, 'Stock', 'in_use', p_remarks, p_user_id);
END;
$$;

-- 3. RPC to Update Asset Status with Quantity Splitting
CREATE OR REPLACE FUNCTION fn_update_asset_status_split(p_asset_id uuid, p_new_status text, p_quantity numeric, p_remarks text, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_asset record;
BEGIN
  -- Lock row for update
  SELECT * INTO v_asset FROM consumable_assets WHERE id = p_asset_id FOR UPDATE;
  
  IF v_asset IS NULL THEN
    RAISE EXCEPTION 'Asset not found.';
  END IF;

  IF v_asset.quantity < p_quantity THEN
    RAISE EXCEPTION 'Cannot update more quantity than available in this batch.';
  END IF;

  IF v_asset.quantity = p_quantity THEN
    -- Update entire row
    UPDATE consumable_assets 
    SET status = p_new_status, status_updated = now(), updated_by = p_user_id, remarks = p_remarks
    WHERE id = p_asset_id;
  ELSE
    -- Split row: reduce current, insert new
    UPDATE consumable_assets SET quantity = quantity - p_quantity WHERE id = p_asset_id;
    
    INSERT INTO consumable_assets (station_id, item_id, request_id, quantity, status, issued_date, status_updated, updated_by, remarks)
    VALUES (v_asset.station_id, v_asset.item_id, v_asset.request_id, p_quantity, p_new_status, v_asset.issued_date, now(), p_user_id, p_remarks);
  END IF;

  -- Log to history
  INSERT INTO asset_lifecycle_logs (station_id, item_id, quantity, from_status, to_status, remarks, logged_by)
  VALUES (v_asset.station_id, v_asset.item_id, p_quantity, v_asset.status, p_new_status, p_remarks, p_user_id);
END;
$$;
