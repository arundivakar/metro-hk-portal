-- Migration 014: Fix HKTL permissions to see and update requests across all stations

-- 1. Fix SELECT policy
DROP POLICY IF EXISTS "consumable_requests_select" ON consumable_requests;
CREATE POLICY "consumable_requests_select"
  ON consumable_requests FOR SELECT TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) IN ('ALS', 'HKTL')
    OR station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  );

-- 2. Fix UPDATE policy
DROP POLICY IF EXISTS "consumable_requests_update_sc_als_hktl" ON consumable_requests;
CREATE POLICY "consumable_requests_update_sc_als_hktl"
  ON consumable_requests FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) IN ('SC', 'ALS', 'HKTL')
    AND (
      (SELECT role FROM users_profile WHERE id = auth.uid()) IN ('ALS', 'HKTL')
      OR station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    (SELECT role FROM users_profile WHERE id = auth.uid()) IN ('SC', 'ALS', 'HKTL')
  );
