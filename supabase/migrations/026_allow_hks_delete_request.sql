-- Allow HKS to delete their own pending requests
DROP POLICY IF EXISTS "consumable_requests_delete_hks" ON consumable_requests;
CREATE POLICY "consumable_requests_delete_hks"
  ON consumable_requests FOR DELETE TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'HKS'
    AND requested_by = auth.uid()
    AND status = 'pending'
  );
