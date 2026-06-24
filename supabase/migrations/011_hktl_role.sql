-- Allow HKTL role in users_profile
ALTER TABLE users_profile DROP CONSTRAINT IF EXISTS chk_users_profile_role;
ALTER TABLE users_profile ADD CONSTRAINT chk_users_profile_role CHECK (role IN ('HKS', 'SC', 'ALS', 'HKTL'));
