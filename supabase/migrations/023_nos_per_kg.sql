-- =============================================================================
-- 023_nos_per_kg.sql
-- Adds nos_per_kg column to rate_master for items billed by Kg but tracked in Nos
-- Example: Small plastic garbage cover = 30 Nos per Kg, Big = 10 Nos per Kg
-- =============================================================================

ALTER TABLE rate_master
  ADD COLUMN IF NOT EXISTS nos_per_kg numeric(10,3);

-- Verify
SELECT id, item_name, unit, unit_rate, nos_per_kg
FROM rate_master
WHERE unit = 'Nos'
ORDER BY item_name;
