-- 034_export_logs.sql
-- Lightweight audit table to track Business Continuity exports.
-- Read-only module — no changes to inventory logic.

CREATE TABLE IF NOT EXISTS export_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  export_type   text        NOT NULL CHECK (export_type IN ('sheets_recovery', 'full_backup')),
  triggered_by  uuid        REFERENCES users_profile(id),
  station_scope text,       -- 'ALL' or station code, e.g. 'CGPP'
  month_scope   text,       -- 'YYYY-MM', 'FY:2025-26', or NULL for point-in-time backups
  record_count  integer,
  file_size_kb  integer,
  created_at    timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE export_logs ENABLE ROW LEVEL SECURITY;

-- ALS users can insert their own logs
CREATE POLICY "ALS can insert export_logs"
  ON export_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- All authenticated users can read export logs
CREATE POLICY "Authenticated users can read export_logs"
  ON export_logs FOR SELECT
  TO authenticated
  USING (true);
