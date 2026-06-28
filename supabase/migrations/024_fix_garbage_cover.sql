-- Fix for small garbage cover
UPDATE rate_master 
SET nos_per_kg = 30 
WHERE LOWER(item_name) LIKE '%plastic%garbage%small%';

-- Verify both
SELECT id, item_name, nos_per_kg 
FROM rate_master 
WHERE LOWER(item_name) LIKE '%garbage%';
