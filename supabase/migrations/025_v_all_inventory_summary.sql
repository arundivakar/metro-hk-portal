-- =============================================================================
-- Metro Housekeeping Inventory Portal
-- Migration: 025_v_all_inventory_summary.sql
-- Description: Create a view for aggregating All Station Inventory natively in DB
-- =============================================================================

CREATE OR REPLACE VIEW v_all_inventory_summary AS
SELECT 
    i.id AS item_id,
    i.name AS item_name,
    i.category,
    i.unit,
    i.min_stock_level,
    r.tender_year,
    r.brand AS brand_name,
    r.unit_rate,
    COALESCE(SUM(COALESCE(si.current_stock, 0)), 0) AS current_stock
FROM inventory_items i
LEFT JOIN rate_master r ON i.rate_master_id = r.id
LEFT JOIN station_inventory si ON i.id = si.item_id
GROUP BY 
    i.id,
    i.name,
    i.category,
    i.unit,
    i.min_stock_level,
    r.tender_year,
    r.brand,
    r.unit_rate;
