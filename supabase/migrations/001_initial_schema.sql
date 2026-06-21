-- =============================================================================
-- Metro Housekeeping Inventory Portal
-- Migration: 001_initial_schema.sql
-- Description: Complete initial database schema for Supabase/PostgreSQL
-- Created: 2026-06-19
-- =============================================================================

-- =============================================================================
-- SECTION 1: EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- SECTION 2: HELPER / UTILITY FUNCTIONS (Moved to Section 4.6)
-- =============================================================================
-- =============================================================================
-- SECTION 3: TABLE DEFINITIONS (in dependency order)
-- =============================================================================

-- 3.1 stations
CREATE TABLE IF NOT EXISTS stations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text        UNIQUE NOT NULL,
  name       text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_stations_code CHECK (
    code IN (
      'ALVA','PNCU','CPPY','AATK','MUTT','KLMT','CCUV','PDPM',
      'EDAP','CGPP','PARV','JLSD','KALR','TNHL','MGRD','MACE',
      'ERSH','KVTR','EMKM','VYTA','TKDM','PETT','VAKK','SNJN','TPHT'
    )
  )
);
COMMENT ON TABLE  stations      IS 'Master list of Kochi Metro stations managed by the portal.';
COMMENT ON COLUMN stations.code IS 'Short 4-character station identifier (e.g. ALVA, MGRD).';

-- 3.2 users_profile
CREATE TABLE IF NOT EXISTS users_profile (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text,
  role        text        NOT NULL,
  employee_id text,
  phone       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_users_profile_role CHECK (role IN ('HKS', 'SC', 'ALS'))
);
COMMENT ON TABLE  users_profile      IS 'Extended profile for each Supabase Auth user.';
COMMENT ON COLUMN users_profile.role IS 'HKS = Housekeeping Staff | SC = Supervisor | ALS = Area-Level Supervisor';

-- 3.3 user_stations
CREATE TABLE IF NOT EXISTS user_stations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users_profile(id) ON DELETE CASCADE,
  station_id  uuid        NOT NULL REFERENCES stations(id)      ON DELETE CASCADE,
  is_primary  boolean     NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_stations UNIQUE (user_id, station_id)
);
COMMENT ON TABLE user_stations IS 'Many-to-many mapping of users to their assigned stations.';

-- 3.4 rate_master
CREATE TABLE IF NOT EXISTS rate_master (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name   text           NOT NULL,
  category    text           NOT NULL,
  unit        text           NOT NULL,
  unit_rate   numeric(10,2)  NOT NULL DEFAULT 0,
  hsn_code    text,
  remarks     text,
  is_active   boolean        NOT NULL DEFAULT true,
  created_at  timestamptz    NOT NULL DEFAULT now(),
  updated_at  timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT chk_rate_master_category CHECK (category IN ('Chemical', 'Consumable'))
);
COMMENT ON TABLE  rate_master          IS 'Master rate catalogue -- source of truth for item prices.';
COMMENT ON COLUMN rate_master.hsn_code IS 'Harmonised System of Nomenclature code for GST purposes.';

-- 3.5 inventory_items
CREATE TABLE IF NOT EXISTS inventory_items (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_master_id  uuid           REFERENCES rate_master(id),
  name            text           NOT NULL,
  category        text           NOT NULL,
  unit            text           NOT NULL,
  min_stock_level numeric(10,3)  NOT NULL DEFAULT 0,
  is_active       boolean        NOT NULL DEFAULT true,
  created_at      timestamptz    NOT NULL DEFAULT now()
);
COMMENT ON TABLE  inventory_items                 IS 'Operational inventory item registry.';
COMMENT ON COLUMN inventory_items.min_stock_level IS 'Reorder threshold -- alerts triggered when stock falls at or below this.';

-- 3.6 station_inventory
CREATE TABLE IF NOT EXISTS station_inventory (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id    uuid           NOT NULL REFERENCES stations(id)        ON DELETE CASCADE,
  item_id       uuid           NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  current_stock numeric(10,3)  NOT NULL DEFAULT 0,
  last_updated  timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT uq_station_inventory   UNIQUE (station_id, item_id),
  CONSTRAINT chk_stock_non_negative CHECK  (current_stock >= 0)
);
COMMENT ON TABLE station_inventory IS 'Live stock balance per station per item. Do NOT update directly.';

-- 3.7 stock_received
CREATE TABLE IF NOT EXISTS stock_received (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id     uuid           NOT NULL REFERENCES stations(id),
  item_id        uuid           NOT NULL REFERENCES inventory_items(id),
  quantity       numeric(10,3)  NOT NULL,
  received_date  date           NOT NULL,
  invoice_number text,
  supplier       text,
  unit_rate      numeric(10,2),
  total_value    numeric(12,2)  GENERATED ALWAYS AS (quantity * unit_rate) STORED,
  received_by    uuid           REFERENCES users_profile(id),
  remarks        text,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT chk_stock_received_qty CHECK (quantity > 0)
);
COMMENT ON TABLE  stock_received             IS 'Every inbound goods receipt; triggers automatic stock increment.';
COMMENT ON COLUMN stock_received.total_value IS 'Auto-computed: quantity x unit_rate (stored generated column).';

-- 3.8 consumption_logs
CREATE TABLE IF NOT EXISTS consumption_logs (
  id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id       uuid           NOT NULL REFERENCES stations(id),
  item_id          uuid           NOT NULL REFERENCES inventory_items(id),
  quantity_used    numeric(10,3)  NOT NULL,
  consumption_date date           NOT NULL,
  shift            text,
  logged_by        uuid           REFERENCES users_profile(id),
  remarks          text,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT chk_consumption_qty   CHECK (quantity_used > 0),
  CONSTRAINT chk_consumption_shift CHECK (shift IN ('Morning', 'Afternoon', 'Night'))
);
COMMENT ON TABLE consumption_logs IS 'Shift-wise consumption records; triggers automatic stock decrement with pre-check.';

-- 3.9 consumable_requests
CREATE TABLE IF NOT EXISTS consumable_requests (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id     uuid           NOT NULL REFERENCES stations(id),
  item_id        uuid           NOT NULL REFERENCES inventory_items(id),
  requested_by   uuid           REFERENCES users_profile(id),
  quantity       numeric(10,3)  NOT NULL,
  unit_rate      numeric(10,2)  NOT NULL DEFAULT 0,
  estimated_cost numeric(10,2)  GENERATED ALWAYS AS (quantity * unit_rate) STORED,
  status         text           NOT NULL DEFAULT 'pending',
  priority       text           NOT NULL DEFAULT 'normal',
  reason         text,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT chk_cr_qty      CHECK (quantity > 0),
  CONSTRAINT chk_cr_status   CHECK (status   IN ('pending','approved_sc','forwarded_als','approved_als','rejected','completed')),
  CONSTRAINT chk_cr_priority CHECK (priority IN ('normal', 'urgent'))
);
COMMENT ON TABLE  consumable_requests                IS 'Multi-stage procurement request workflow.';
COMMENT ON COLUMN consumable_requests.estimated_cost IS 'Auto-computed: quantity x unit_rate (stored generated column).';
COMMENT ON COLUMN consumable_requests.status         IS 'pending -> approved_sc -> forwarded_als (cost>500) -> approved_als -> completed | rejected';

-- 3.10 request_approvals
CREATE TABLE IF NOT EXISTS request_approvals (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid        NOT NULL REFERENCES consumable_requests(id) ON DELETE CASCADE,
  acted_by   uuid        REFERENCES users_profile(id),
  action     text        NOT NULL,
  comments   text,
  acted_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ra_action CHECK (action IN ('approved', 'rejected', 'forwarded', 'completed'))
);
COMMENT ON TABLE request_approvals IS 'Immutable audit log of every approval action on a consumable request.';

-- 3.11 consumable_assets
CREATE TABLE IF NOT EXISTS consumable_assets (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id     uuid           NOT NULL REFERENCES stations(id),
  item_id        uuid           NOT NULL REFERENCES inventory_items(id),
  request_id     uuid           REFERENCES consumable_requests(id),
  quantity       numeric(10,3)  NOT NULL,
  status         text           NOT NULL DEFAULT 'in_use',
  issued_date    date,
  status_updated timestamptz    NOT NULL DEFAULT now(),
  updated_by     uuid           REFERENCES users_profile(id),
  remarks        text,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT chk_ca_status CHECK (status IN ('in_use', 'partially_damaged', 'disposed'))
);
COMMENT ON TABLE  consumable_assets        IS 'Lifecycle tracker for consumable assets after issue.';
COMMENT ON COLUMN consumable_assets.status IS 'in_use -> partially_damaged -> disposed';


-- =============================================================================
-- SECTION 4: FUNCTIONS AND TRIGGERS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 4.1  Stock receipt -> auto-increment station_inventory
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_update_stock_on_receive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO station_inventory (station_id, item_id, current_stock, last_updated)
  VALUES (NEW.station_id, NEW.item_id, NEW.quantity, now())
  ON CONFLICT (station_id, item_id)
  DO UPDATE SET
    current_stock = station_inventory.current_stock + NEW.quantity,
    last_updated  = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_stock_on_receive ON stock_received;
CREATE TRIGGER trg_update_stock_on_receive
  AFTER INSERT ON stock_received
  FOR EACH ROW EXECUTE FUNCTION fn_update_stock_on_receive();

COMMENT ON FUNCTION fn_update_stock_on_receive() IS
  'AFTER INSERT on stock_received: upserts station_inventory, adding the received quantity.';


-- ---------------------------------------------------------------------------
-- 4.2  Consumption log -> guard insufficient stock + auto-decrement (atomic BEFORE trigger)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_check_and_update_stock_on_consumption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_available numeric(10,3);
BEGIN
  -- Lock the row to prevent concurrent race conditions
  SELECT current_stock
    INTO v_available
    FROM station_inventory
   WHERE station_id = NEW.station_id
     AND item_id    = NEW.item_id
   FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION
      'No stock record found for this item at the station. Available: 0, Requested: %',
      NEW.quantity_used;
  END IF;

  IF NEW.quantity_used > v_available THEN
    RAISE EXCEPTION
      'Insufficient stock. Available: %, Requested: %',
      v_available, NEW.quantity_used;
  END IF;

  -- Deduct stock atomically in the same BEFORE trigger
  UPDATE station_inventory
     SET current_stock = current_stock - NEW.quantity_used,
         last_updated  = now()
   WHERE station_id = NEW.station_id
     AND item_id    = NEW.item_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_and_update_stock_on_consumption ON consumption_logs;
CREATE TRIGGER trg_check_and_update_stock_on_consumption
  BEFORE INSERT ON consumption_logs
  FOR EACH ROW EXECUTE FUNCTION fn_check_and_update_stock_on_consumption();

COMMENT ON FUNCTION fn_check_and_update_stock_on_consumption() IS
  'BEFORE INSERT on consumption_logs: validates stock availability then decrements atomically.';


-- ---------------------------------------------------------------------------
-- 4.3  consumable_requests -> auto-forward to ALS if estimated_cost > 500
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_auto_forward_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (NEW.quantity * NEW.unit_rate) > 500 THEN
    NEW.status := 'forwarded_als';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_forward_request ON consumable_requests;
CREATE TRIGGER trg_auto_forward_request
  BEFORE INSERT ON consumable_requests
  FOR EACH ROW EXECUTE FUNCTION fn_auto_forward_request();

COMMENT ON FUNCTION fn_auto_forward_request() IS
  'BEFORE INSERT on consumable_requests: if estimated cost > 500, sets status = forwarded_als.';


-- ---------------------------------------------------------------------------
-- 4.4  request completed -> deduct stock + create consumable_asset record
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_on_request_completed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    UPDATE station_inventory
       SET current_stock = current_stock - NEW.quantity,
           last_updated  = now()
     WHERE station_id = NEW.station_id
       AND item_id    = NEW.item_id;

    INSERT INTO consumable_assets
      (station_id, item_id, request_id, quantity, status, issued_date)
    VALUES
      (NEW.station_id, NEW.item_id, NEW.id, NEW.quantity, 'in_use', CURRENT_DATE);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_request_completed ON consumable_requests;
CREATE TRIGGER trg_on_request_completed
  AFTER UPDATE ON consumable_requests
  FOR EACH ROW EXECUTE FUNCTION fn_on_request_completed();

COMMENT ON FUNCTION fn_on_request_completed() IS
  'AFTER UPDATE on consumable_requests: when status -> completed, deducts stock and creates consumable_asset.';


-- ---------------------------------------------------------------------------
-- 4.5  Generic updated_at auto-stamp trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_profile_updated_at ON users_profile;
CREATE TRIGGER trg_users_profile_updated_at
  BEFORE UPDATE ON users_profile
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_rate_master_updated_at ON rate_master;
CREATE TRIGGER trg_rate_master_updated_at
  BEFORE UPDATE ON rate_master
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_consumable_requests_updated_at ON consumable_requests;
CREATE TRIGGER trg_consumable_requests_updated_at
  BEFORE UPDATE ON consumable_requests
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON FUNCTION fn_set_updated_at() IS
  'Generic BEFORE UPDATE trigger to auto-set updated_at = now().';


-- =============================================================================
-- SECTION 4.6: HELPER / UTILITY FUNCTIONS
-- =============================================================================

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM users_profile WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION get_user_stations()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT station_id FROM user_stations WHERE user_id = auth.uid();
$$;


-- =============================================================================
-- SECTION 5: ROW LEVEL SECURITY (RLS)
-- =============================================================================

ALTER TABLE stations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE users_profile       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_master         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE station_inventory   ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_received      ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumption_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumable_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_approvals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumable_assets   ENABLE ROW LEVEL SECURITY;

-- 5.1  stations -- all authenticated users can read
DROP POLICY IF EXISTS "stations_select_authenticated" ON stations;
CREATE POLICY "stations_select_authenticated"
  ON stations FOR SELECT TO authenticated USING (true);

-- 5.2  users_profile
DROP POLICY IF EXISTS "users_profile_select_all" ON users_profile;
CREATE POLICY "users_profile_select_all"
  ON users_profile FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "users_profile_update_own" ON users_profile;
CREATE POLICY "users_profile_update_own"
  ON users_profile FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 5.3  user_stations -- users can see their own station assignments
DROP POLICY IF EXISTS "user_stations_select_own" ON user_stations;
CREATE POLICY "user_stations_select_own"
  ON user_stations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 5.4  rate_master -- all authenticated can read; only ALS can write
DROP POLICY IF EXISTS "rate_master_select_authenticated" ON rate_master;
CREATE POLICY "rate_master_select_authenticated"
  ON rate_master FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rate_master_insert_als" ON rate_master;
CREATE POLICY "rate_master_insert_als"
  ON rate_master FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS');

DROP POLICY IF EXISTS "rate_master_update_als" ON rate_master;
CREATE POLICY "rate_master_update_als"
  ON rate_master FOR UPDATE TO authenticated
  USING  ((SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS')
  WITH CHECK ((SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS');

DROP POLICY IF EXISTS "rate_master_delete_als" ON rate_master;
CREATE POLICY "rate_master_delete_als"
  ON rate_master FOR DELETE TO authenticated
  USING ((SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS');

-- 5.5  inventory_items -- all authenticated can read; only ALS can write
DROP POLICY IF EXISTS "inventory_items_select_authenticated" ON inventory_items;
CREATE POLICY "inventory_items_select_authenticated"
  ON inventory_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory_items_insert_als" ON inventory_items;
CREATE POLICY "inventory_items_insert_als"
  ON inventory_items FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS');

DROP POLICY IF EXISTS "inventory_items_update_als" ON inventory_items;
CREATE POLICY "inventory_items_update_als"
  ON inventory_items FOR UPDATE TO authenticated
  USING  ((SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS')
  WITH CHECK ((SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS');

DROP POLICY IF EXISTS "inventory_items_delete_als" ON inventory_items;
CREATE POLICY "inventory_items_delete_als"
  ON inventory_items FOR DELETE TO authenticated
  USING ((SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS');

-- 5.6  station_inventory -- HKS/SC: own stations; ALS: all
DROP POLICY IF EXISTS "station_inventory_select" ON station_inventory;
CREATE POLICY "station_inventory_select"
  ON station_inventory FOR SELECT TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS'
    OR station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  );

-- 5.7  stock_received -- SC: INSERT+SELECT own; ALS: SELECT all
DROP POLICY IF EXISTS "stock_received_select" ON stock_received;
CREATE POLICY "stock_received_select"
  ON stock_received FOR SELECT TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS'
    OR station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "stock_received_insert_sc" ON stock_received;
CREATE POLICY "stock_received_insert_sc"
  ON stock_received FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'SC'
    AND station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  );

-- 5.8  consumption_logs -- SC: INSERT+SELECT own; ALS: SELECT all
DROP POLICY IF EXISTS "consumption_logs_select" ON consumption_logs;
CREATE POLICY "consumption_logs_select"
  ON consumption_logs FOR SELECT TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS'
    OR station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "consumption_logs_insert_sc" ON consumption_logs;
CREATE POLICY "consumption_logs_insert_sc"
  ON consumption_logs FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'SC'
    AND station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  );

-- 5.9  consumable_requests -- HKS: INSERT+SELECT own; SC: SELECT+UPDATE own; ALS: SELECT+UPDATE all
DROP POLICY IF EXISTS "consumable_requests_select" ON consumable_requests;
CREATE POLICY "consumable_requests_select"
  ON consumable_requests FOR SELECT TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS'
    OR station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "consumable_requests_insert_hks" ON consumable_requests;
CREATE POLICY "consumable_requests_insert_hks"
  ON consumable_requests FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'HKS'
    AND station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "consumable_requests_update_sc_als" ON consumable_requests;
CREATE POLICY "consumable_requests_update_sc_als"
  ON consumable_requests FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) IN ('SC', 'ALS')
    AND (
      (SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS'
      OR station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    (SELECT role FROM users_profile WHERE id = auth.uid()) IN ('SC', 'ALS')
  );

-- 5.10 request_approvals -- SC+ALS: INSERT; ALS: SELECT all; SC+HKS: SELECT own stations
DROP POLICY IF EXISTS "request_approvals_select" ON request_approvals;
CREATE POLICY "request_approvals_select"
  ON request_approvals FOR SELECT TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS'
    OR request_id IN (
      SELECT cr.id FROM consumable_requests cr
       WHERE cr.station_id IN (
         SELECT station_id FROM user_stations WHERE user_id = auth.uid()
       )
    )
  );

DROP POLICY IF EXISTS "request_approvals_insert_sc_als" ON request_approvals;
CREATE POLICY "request_approvals_insert_sc_als"
  ON request_approvals FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM users_profile WHERE id = auth.uid()) IN ('SC', 'ALS')
  );

-- 5.11 consumable_assets -- SC: INSERT+UPDATE+SELECT own; ALS: SELECT all; HKS: SELECT own
DROP POLICY IF EXISTS "consumable_assets_select" ON consumable_assets;
CREATE POLICY "consumable_assets_select"
  ON consumable_assets FOR SELECT TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS'
    OR station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "consumable_assets_insert_sc" ON consumable_assets;
CREATE POLICY "consumable_assets_insert_sc"
  ON consumable_assets FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'SC'
    AND station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "consumable_assets_update_sc" ON consumable_assets;
CREATE POLICY "consumable_assets_update_sc"
  ON consumable_assets FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'SC'
    AND station_id IN (SELECT station_id FROM user_stations WHERE user_id = auth.uid())
  )
  WITH CHECK (
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'SC'
  );


-- =============================================================================
-- SECTION 6: VIEWS
-- =============================================================================

-- 6.1 v_station_inventory_summary
CREATE OR REPLACE VIEW v_station_inventory_summary AS
SELECT
  s.code                                   AS station_code,
  s.name                                   AS station_name,
  ii.name                                  AS item_name,
  ii.category,
  ii.unit,
  si.current_stock,
  ii.min_stock_level,
  (si.current_stock <= ii.min_stock_level) AS is_low_stock,
  si.last_updated
FROM station_inventory si
JOIN stations        s  ON s.id  = si.station_id
JOIN inventory_items ii ON ii.id = si.item_id
ORDER BY s.code, ii.category, ii.name;

COMMENT ON VIEW v_station_inventory_summary IS
  'Station x item stock summary with low-stock flag. RLS enforced via underlying tables.';

-- 6.2 v_pending_requests
CREATE OR REPLACE VIEW v_pending_requests AS
SELECT
  cr.id                    AS request_id,
  s.code                   AS station_code,
  s.name                   AS station_name,
  ii.name                  AS item_name,
  ii.category,
  ii.unit,
  cr.quantity,
  cr.unit_rate,
  cr.estimated_cost,
  cr.status,
  cr.priority,
  cr.reason,
  up.full_name             AS requested_by_name,
  up.employee_id           AS requested_by_employee_id,
  cr.created_at
FROM consumable_requests cr
JOIN stations        s  ON s.id  = cr.station_id
JOIN inventory_items ii ON ii.id = cr.item_id
LEFT JOIN users_profile up ON up.id = cr.requested_by
WHERE cr.status IN ('pending', 'forwarded_als')
ORDER BY cr.priority DESC, cr.created_at ASC;

COMMENT ON VIEW v_pending_requests IS
  'Open requests awaiting SC or ALS action. Priority DESC = urgent first.';


-- =============================================================================
-- SECTION 7: INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_station_inventory_station
  ON station_inventory (station_id);

CREATE INDEX IF NOT EXISTS idx_stock_received_station_date
  ON stock_received (station_id, received_date);

CREATE INDEX IF NOT EXISTS idx_consumption_logs_station_date
  ON consumption_logs (station_id, consumption_date);

CREATE INDEX IF NOT EXISTS idx_consumable_requests_station_status
  ON consumable_requests (station_id, status);

CREATE INDEX IF NOT EXISTS idx_consumable_assets_station_status
  ON consumable_assets (station_id, status);

CREATE INDEX IF NOT EXISTS idx_user_stations_user_id
  ON user_stations (user_id);

CREATE INDEX IF NOT EXISTS idx_request_approvals_request_id
  ON request_approvals (request_id);


-- =============================================================================
-- END OF MIGRATION 001_initial_schema.sql
-- =============================================================================
