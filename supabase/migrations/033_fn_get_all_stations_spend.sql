-- =====================================================================
-- INSTRUCTIONS: Run this SQL in Supabase SQL Editor
-- URL: https://supabase.com/dashboard/project/fgvegfxyzktrcnfltqgb/sql/new
-- =====================================================================
-- 
-- PURPOSE: Creates a SECURITY DEFINER function that bypasses RLS to
-- calculate total spend across ALL stations for the current month.
-- This allows SC (Station Controllers) to see the real system-wide spend
-- on their Approvals page, not just their own station's spend.
--
-- The current problem: RLS on consumption_logs restricts SC users to 
-- only see their own station data, so "All Stations" spend was showing 
-- the same value as their own station's spend.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_get_all_stations_spend(month_start text)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE 
      -- Exclude transfer-out entries (not real spend)
      WHEN cl.remarks LIKE 'Inter-Station Transfer Out%' THEN 0
      WHEN cl.remarks LIKE 'Depot Transfer Out%' THEN 0

      -- Exclude old tender items (before 2024)
      WHEN rm.tender_year ILIKE '%before 2024%' THEN 0
      WHEN SPLIT_PART(rm.tender_year, '-', 1) ~ '^[0-9]+$' 
           AND CAST(SPLIT_PART(rm.tender_year, '-', 1) AS integer) > 0 
           AND CAST(SPLIT_PART(rm.tender_year, '-', 1) AS integer) < 2024 THEN 0
      
      -- Nos items billed by weight (nos_per_kg specified)
      WHEN rm.nos_per_kg IS NOT NULL AND rm.nos_per_kg > 0 THEN 
         (cl.quantity_used / rm.nos_per_kg) * COALESCE(rm.unit_rate, 0)
         
      -- Volume/weight items stored in base units (ml/g) - divide by 1000
      WHEN ii.unit IN ('ml', 'mL', 'g', 'Ltr', 'L', 'Kg', 'kg') THEN 
         (cl.quantity_used / 1000.0) * COALESCE(rm.unit_rate, 0)
         
      -- Nos items billed per piece
      ELSE 
         cl.quantity_used * COALESCE(rm.unit_rate, 0)
    END
  ), 0)
  FROM consumption_logs cl
  JOIN inventory_items ii ON ii.id = cl.item_id
  LEFT JOIN rate_master rm ON rm.id = ii.rate_master_id
  WHERE cl.consumption_date >= month_start::date;
$$;

-- Grant execute to authenticated users (they call via the app)
GRANT EXECUTE ON FUNCTION fn_get_all_stations_spend(text) TO authenticated;

-- Verify it works:
-- SELECT fn_get_all_stations_spend('2026-07-01');
