-- Add image_url column to consumable_requests table
ALTER TABLE consumable_requests ADD COLUMN IF NOT EXISTS image_url text;
