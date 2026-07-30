-- 032_verification_drafts.sql
-- Stores in-progress verification state so staff can save and resume
-- across the 4-stage category-wise verification workflow.

CREATE TABLE IF NOT EXISTS verification_drafts (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id           uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    verification_period  text NOT NULL,          -- e.g. '2026-07-P2'
    current_stage        int  NOT NULL DEFAULT 1, -- 1=Stock 2=InUse 3=Damaged 4=Disposed
    draft_data           jsonb NOT NULL DEFAULT '{}',
    verifier_name        text,
    emp_id               text,
    created_at           timestamptz DEFAULT now(),
    updated_at           timestamptz DEFAULT now(),
    UNIQUE (station_id, verification_period)     -- one draft per station per period
);

ALTER TABLE verification_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage verification drafts"
ON verification_drafts FOR ALL TO authenticated
USING (true) WITH CHECK (true);
