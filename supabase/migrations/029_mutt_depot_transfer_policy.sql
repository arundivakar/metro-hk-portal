-- Migration 029: Extend consumption_logs SELECT policy so that
-- MUTT SC can see ALL "Depot Transfer Out" entries across all stations.
--
-- Background: fn_transfer_to_depot logs the deduction in consumption_logs
-- with station_id = source_station (e.g., EDAP, ALVA), not MUTT.
-- MUTT SC manages depot transfers, so they need visibility into these entries.

DROP POLICY IF EXISTS "consumption_logs_select" ON consumption_logs;

CREATE POLICY "consumption_logs_select"
  ON consumption_logs FOR SELECT TO authenticated
  USING (
    -- ALS: full visibility across all stations
    (SELECT role FROM users_profile WHERE id = auth.uid()) = 'ALS'

    -- Everyone: see their own station's logs
    OR station_id IN (
      SELECT station_id FROM user_stations WHERE user_id = auth.uid()
    )

    -- MUTT SC only: see all "Depot Transfer Out" entries across all stations
    -- (these are deductions logged at source stations by fn_transfer_to_depot)
    OR (
      remarks LIKE 'Depot Transfer Out%'
      AND EXISTS (
        SELECT 1
        FROM users_profile   up
        JOIN user_stations   us ON us.user_id  = up.id
        JOIN stations        s  ON s.id        = us.station_id
        WHERE up.id   = auth.uid()
          AND up.role = 'SC'
          AND s.code  = 'MUTT'
      )
    )
  );
