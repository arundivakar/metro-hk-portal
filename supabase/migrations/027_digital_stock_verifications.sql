-- 1. Create table for tracking digital stock verifications
CREATE TABLE IF NOT EXISTS stock_verifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    station_id uuid REFERENCES stations(id) NOT NULL,
    verifier_name text NOT NULL,
    emp_id text NOT NULL,
    verification_month text NOT NULL, -- Format: YYYY-MM
    verification_period text NOT NULL, -- Format: YYYY-MM-P1 or YYYY-MM-P2
    completed_at timestamptz DEFAULT now()
);

-- 2. Add comments
COMMENT ON TABLE stock_verifications IS 'Tracks when a Station Controller completes the digital stock verification for an allotted period.';

-- 3. Row Level Security Policies
ALTER TABLE stock_verifications ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (SCs, HKTLs, ALS) to view verifications
CREATE POLICY "Allow read access for authenticated users" 
ON stock_verifications FOR SELECT 
USING (auth.role() = 'authenticated');

-- Allow authenticated users (SCs) to insert verifications
CREATE POLICY "Allow insert access for authenticated users" 
ON stock_verifications FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');
