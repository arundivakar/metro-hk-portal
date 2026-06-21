-- =============================================================================
-- Metro Housekeeping Inventory Portal
-- File: seed.sql
-- Description: Station master data seed for Kochi Metro HK Portal
-- Created: 2026-06-19
-- =============================================================================

-- CSV IMPORT GUIDE
-- ================
-- To import existing Excel data into this database after running seed.sql:
--
-- 1. rate_master:
--    Export the Rate Master sheet from Excel as CSV.
--    Columns: item_name, category (Chemical|Consumable), unit, unit_rate, hsn_code, remarks
--    Use: COPY rate_master (item_name, category, unit, unit_rate, hsn_code, remarks)
--         FROM '/path/to/rate_master.csv' CSV HEADER;
--
-- 2. inventory_items:
--    After importing rate_master, link items via rate_master_id.
--    Tip: INSERT INTO inventory_items (rate_master_id, name, category, unit, min_stock_level)
--         SELECT id, item_name, category, unit, 0 FROM rate_master;
--
-- 3. station_inventory:
--    Export closing stock per station (one row per station+item combination).
--    Columns: station_id (UUID), item_id (UUID), current_stock
--    Resolve UUIDs: SELECT id FROM stations WHERE code = 'ALVA';
--
-- 4. stock_received:
--    Export Stock Received sheet as CSV.
--    Columns: station_id, item_id, quantity, received_date, invoice_number,
--             supplier, unit_rate, received_by, remarks
--
-- 5. consumption_logs:
--    Export Daily Consumption sheet as CSV.
--    Columns: station_id, item_id, quantity_used, consumption_date, shift, logged_by, remarks
--    NOTE: Populate station_inventory (opening stock) BEFORE importing consumption_logs.
--          The stock guard trigger fires even on bulk COPY imports.
--
-- Note: All user UUIDs must match auth.users IDs created in Supabase Auth.
--       Create users in Supabase Dashboard > Authentication > Users first,
--       then insert matching rows into users_profile using the same UUID.
-- =============================================================================


-- =============================================================================
-- STATION MASTER DATA
-- All 25 Kochi Metro stations on the Purple Line (Aluva to Tripunithura)
-- =============================================================================

INSERT INTO stations (code, name) VALUES
  ('ALVA', 'Aluva'),
  ('PNCU', 'Pulinchodu'),
  ('CPPY', 'Companypady'),
  ('AATK', 'Ambattukavu'),
  ('MUTT', 'Muttom'),
  ('KLMT', 'Kalamassery'),
  ('CCUV', 'Cochin University'),
  ('PDPM', 'Pathadipalam'),
  ('EDAP', 'Edapally'),
  ('CGPP', 'Changampuzha Park'),
  ('PARV', 'Palarivattom'),
  ('JLSD', 'JLN Stadium'),
  ('KALR', 'Kaloor'),
  ('TNHL', 'Town Hall'),
  ('MGRD', 'MG Road'),
  ('MACE', 'Maharajas College'),
  ('ERSH', 'Ernakulam South'),
  ('KVTR', 'Kadavanthra'),
  ('EMKM', 'Elamkulam'),
  ('VYTA', 'Vyttila'),
  ('TKDM', 'Thykoodam'),
  ('PETT', 'Pettah'),
  ('VAKK', 'Vadakkekotta'),
  ('SNJN', 'SN Junction'),
  ('TPHT', 'Tripunithura')
ON CONFLICT (code) DO NOTHING;

-- Verify station count: should return 25 rows
-- SELECT code, name, is_active FROM stations ORDER BY created_at;

-- =============================================================================
-- END OF seed.sql
-- =============================================================================
