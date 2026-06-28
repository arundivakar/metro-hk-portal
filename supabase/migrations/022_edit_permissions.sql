-- =============================================================================
-- 022_edit_permissions.sql
-- Add UPDATE permissions on rate_master and inventory_items for:
--   1. HKTL role (all HKTL users)
--   2. SC at PNCU station only
-- =============================================================================

-- HKTL can update rate_master
DROP POLICY IF EXISTS "HKTL can update rate_master" ON rate_master;
CREATE POLICY "HKTL can update rate_master" ON rate_master
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'HKTL')
  );

-- SC at PNCU can update rate_master
DROP POLICY IF EXISTS "SC PNCU can update rate_master" ON rate_master;
CREATE POLICY "SC PNCU can update rate_master" ON rate_master
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users_profile up
      JOIN user_stations us ON us.user_id = up.id
      JOIN stations s ON s.id = us.station_id
      WHERE up.id = auth.uid() AND up.role = 'SC' AND s.code = 'PNCU'
    )
  );

-- HKTL can update inventory_items
DROP POLICY IF EXISTS "HKTL can update inventory_items" ON inventory_items;
CREATE POLICY "HKTL can update inventory_items" ON inventory_items
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users_profile WHERE id = auth.uid() AND role = 'HKTL')
  );

-- SC at PNCU can update inventory_items
DROP POLICY IF EXISTS "SC PNCU can update inventory_items" ON inventory_items;
CREATE POLICY "SC PNCU can update inventory_items" ON inventory_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users_profile up
      JOIN user_stations us ON us.user_id = up.id
      JOIN stations s ON s.id = us.station_id
      WHERE up.id = auth.uid() AND up.role = 'SC' AND s.code = 'PNCU'
    )
  );

-- Verify policies
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('rate_master', 'inventory_items')
ORDER BY tablename, policyname;
