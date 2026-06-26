-- Migration 013: Enforce Strict Hierarchy (HKS -> HKTL -> SC -> ALS)

-- 1. Drop the automatic forwarding trigger that bypasses HKTL/SC
DROP TRIGGER IF EXISTS trg_auto_forward_request ON consumable_requests;
DROP FUNCTION IF EXISTS fn_auto_forward_request();

-- 2. Update consumable_requests policy so HKTL can UPDATE
DROP POLICY IF EXISTS "consumable_requests_update_sc_als" ON consumable_requests;
CREATE POLICY "consumable_requests_update_sc_als_hktl"
  ON consumable_requests FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) IN ('SC', 'ALS', 'HKTL')
    AND (
      (SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS'
      OR station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    (SELECT role FROM users_profile WHERE id = auth.uid()) IN ('SC', 'ALS', 'HKTL')
  );

-- 3. Update request_approvals policy so HKTL can INSERT
DROP POLICY IF EXISTS "request_approvals_insert_sc_als" ON request_approvals;
CREATE POLICY "request_approvals_insert_sc_als_hktl"
  ON request_approvals FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM users_profile WHERE id = auth.uid()) IN ('SC', 'ALS', 'HKTL')
  );
