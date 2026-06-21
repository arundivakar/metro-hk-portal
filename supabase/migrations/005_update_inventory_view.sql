-- Upgrade v_station_inventory_summary to include Rate Master details
DROP VIEW IF EXISTS v_station_inventory_summary;

CREATE OR REPLACE VIEW v_station_inventory_summary AS
SELECT
  s.id                                     AS station_id,
  s.code                                   AS station_code,
  s.name                                   AS station_name,
  ii.id                                    AS item_id,
  ii.name                                  AS item_name,
  ii.category,
  ii.unit,
  rm.tender_year,
  rm.brand                                 AS brand_name,
  rm.unit_rate,
  COALESCE(si.current_stock, 0)            AS current_stock,
  ii.min_stock_level,
  (COALESCE(si.current_stock, 0) <= ii.min_stock_level AND ii.min_stock_level > 0) AS is_low_stock,
  si.last_updated
FROM inventory_items ii
LEFT JOIN rate_master rm ON rm.id = ii.rate_master_id
CROSS JOIN stations s
LEFT JOIN station_inventory si ON si.station_id = s.id AND si.item_id = ii.id
WHERE s.is_active = true
ORDER BY s.code, ii.category, ii.name;

COMMENT ON VIEW v_station_inventory_summary IS
  'Flat view of station inventory including 0-stock items and rate master info.';
