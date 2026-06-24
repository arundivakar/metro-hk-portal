-- Migration to update consumable_requests status constraint to include 'forwarded_sc'

ALTER TABLE consumable_requests DROP CONSTRAINT IF EXISTS chk_cr_status;

ALTER TABLE consumable_requests ADD CONSTRAINT chk_cr_status 
  CHECK (status IN ('pending', 'forwarded_sc', 'approved_sc', 'forwarded_als', 'approved_als', 'rejected', 'completed'));
