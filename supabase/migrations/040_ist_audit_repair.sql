-- =============================================================================
-- 040_ist_audit_repair.sql
-- IST Audit & Repair System for Metro HK Portal
--
-- Creates:
--   1. ist_repair_log         — permanent audit log of every repair action
--   2. v_ist_audit            — read-only view classifying all IST records
--   3. fn_ist_repair_preview  — read-only preview of proposed repair (no changes made)
--   4. fn_ist_repair_execute  — transactional execution of an approved repair
--
-- Authorization:
--   fn_ist_repair_preview and fn_ist_repair_execute enforce ALS role at the
--   database level via get_user_role(). Non-ALS callers receive an exception.
--   v_ist_audit is readable by all authenticated users (no sensitive data).
--   ist_repair_log has ALS-only RLS SELECT policy.
--
-- Coverage — dest_ist CTE includes FOUR categories:
--   A. Modern IST          : source_station_id IS NOT NULL
--   B. Legacy IST          : supplier LIKE 'Station Transfer from %'
--   C. Unlinked potential  : source_station_id IS NULL AND supplier IS NULL
--                            AND invoice_number IS NULL
--   D. Normal supplier receipts (supplier IS NOT NULL, not matching legacy pattern)
--      are EXCLUDED from the audit entirely.
--
-- Safety guarantees:
--   - quantity_in_use is NEVER touched by any repair function
--   - consumption_logs are NEVER modified (only deleted for orphan_source case)
--   - Orphan Destination with subsequent consumption is BLOCKED from auto-repair
--   - Unlinked Destination Receipts are BLOCKED from auto-repair
--   - All repairs are transactional — full rollback on any guard failure
--   - Every repair writes a permanent ist_repair_log row
--
-- Does NOT modify:
--   - Migrations 037, 038, 039 (untouched)
--   - fn_inter_station_transfer, fn_delete_consumption,
--     fn_delete_stock_received, fn_edit_consumption
--   - Any historical data outside explicit admin-approved repair execution
--   - Billing, normal consumption, Asset Lifecycle, quantity_in_use
-- =============================================================================


-- =============================================================================
-- PART 1: IST REPAIR AUDIT LOG TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS ist_repair_log (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    repair_type             text            NOT NULL,
    source_station_id       uuid            REFERENCES stations(id),
    dest_station_id         uuid            REFERENCES stations(id),
    item_id                 uuid            REFERENCES inventory_items(id),
    quantity                numeric(10,3),
    original_source_log_id  uuid,
    original_dest_log_id    uuid,
    original_source_date    date,
    original_dest_date      date,
    repaired_source_date    date,
    repaired_dest_date      date,
    source_stock_before     numeric(10,3),
    source_stock_after      numeric(10,3),
    dest_stock_before       numeric(10,3),
    dest_stock_after        numeric(10,3),
    repair_reason           text,
    repaired_by             uuid            REFERENCES users_profile(id),
    repaired_at             timestamptz     NOT NULL DEFAULT now(),
    notes                   text,
    CONSTRAINT chk_ist_repair_type CHECK (
        repair_type IN ('remove_orphan_dest', 'remove_orphan_source', 'redate_transfer')
    )
);

COMMENT ON TABLE ist_repair_log IS
    'Permanent, uneditable audit log of every IST repair action executed via '
    'fn_ist_repair_execute. Written once on execution; never updated or deleted.';

-- RLS: ALS can see all repair logs; SC/HKS cannot see any
ALTER TABLE ist_repair_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ist_repair_log_select_als" ON ist_repair_log;
CREATE POLICY "ist_repair_log_select_als"
    ON ist_repair_log FOR SELECT TO authenticated
    USING (get_user_role() = 'ALS');

DROP POLICY IF EXISTS "ist_repair_log_insert_als" ON ist_repair_log;
CREATE POLICY "ist_repair_log_insert_als"
    ON ist_repair_log FOR INSERT TO authenticated
    WITH CHECK (get_user_role() = 'ALS');


-- =============================================================================
-- PART 2: IST AUDIT VIEW — v_ist_audit
-- =============================================================================

DROP VIEW IF EXISTS v_ist_audit;

CREATE OR REPLACE VIEW v_ist_audit AS
WITH
-- ─────────────────────────────────────────────────────────────────────────────
-- source_ist: every Transfer Out record from consumption_logs
-- ─────────────────────────────────────────────────────────────────────────────
source_ist AS (
    SELECT
        cl.id                                                   AS source_log_id,
        cl.station_id                                           AS source_station_id,
        s.code                                                  AS source_station_code,
        cl.item_id,
        i.name                                                  AS item_name,
        i.category                                              AS item_category,
        i.unit                                                  AS item_unit,
        cl.quantity_used                                        AS quantity,
        cl.consumption_date                                     AS transfer_date,
        TRIM(substring(cl.remarks FROM 31))                     AS dest_station_code,
        ROW_NUMBER() OVER (
            PARTITION BY
                cl.station_id,
                TRIM(substring(cl.remarks FROM 31)),
                cl.item_id,
                cl.consumption_date
            ORDER BY cl.quantity_used DESC, cl.id
        )                                                       AS rn,
        COUNT(*) OVER (
            PARTITION BY
                cl.station_id,
                TRIM(substring(cl.remarks FROM 31)),
                cl.item_id,
                cl.consumption_date
        )                                                       AS match_group_size
    FROM consumption_logs cl
    JOIN stations        s ON s.id  = cl.station_id
    JOIN inventory_items i ON i.id  = cl.item_id
    WHERE cl.remarks LIKE 'Inter-Station Transfer Out to %'
),

-- ─────────────────────────────────────────────────────────────────────────────
-- dest_ist: all IST-candidate destination receipts from stock_received
--
-- Covers three categories:
--   A. Modern  : source_station_id IS NOT NULL
--   B. Legacy  : supplier LIKE 'Station Transfer from %'
--   C. Unlinked: source_station_id IS NULL AND supplier IS NULL (or empty)
--                AND invoice_number IS NULL
--                → fingerprint of a pre-fix IST receipt that lost its linkage
--
-- Normal supplier receipts (supplier IS NOT NULL, not matching legacy)
-- are NOT included — they are excluded by the WHERE clause.
-- ─────────────────────────────────────────────────────────────────────────────
dest_ist AS (
    SELECT
        sr.id                                                   AS dest_log_id,
        sr.station_id                                           AS dest_station_id,
        sd.code                                                 AS dest_station_code,
        sr.item_id,
        i.name                                                  AS item_name,
        i.category                                              AS item_category,
        i.unit                                                  AS item_unit,
        sr.quantity,
        sr.received_date                                        AS transfer_date,
        sr.source_station_id                                    AS modern_source_station_id,
        sr.supplier,
        sr.invoice_number,
        -- Resolve source station ID for join purposes
        CASE
            WHEN sr.source_station_id IS NOT NULL THEN sr.source_station_id
            ELSE ss_legacy.id   -- may be NULL for unlinked records
        END                                                     AS resolved_source_station_id,
        -- Classify linkage method
        CASE
            WHEN sr.source_station_id IS NOT NULL            THEN 'modern'
            WHEN ss_legacy.id IS NOT NULL                    THEN 'legacy'
            WHEN sr.supplier IS NULL AND sr.invoice_number IS NULL THEN 'unlinked'
            ELSE 'none'
        END                                                     AS link_method,
        ROW_NUMBER() OVER (
            PARTITION BY
                CASE
                    WHEN sr.source_station_id IS NOT NULL THEN sr.source_station_id
                    ELSE ss_legacy.id
                END,
                sd.code,
                sr.item_id,
                sr.received_date
            ORDER BY sr.quantity DESC, sr.id
        )                                                       AS rn,
        COUNT(*) OVER (
            PARTITION BY
                CASE
                    WHEN sr.source_station_id IS NOT NULL THEN sr.source_station_id
                    ELSE ss_legacy.id
                END,
                sd.code,
                sr.item_id,
                sr.received_date
        )                                                       AS match_group_size
    FROM stock_received  sr
    JOIN stations        sd        ON sd.id = sr.station_id
    JOIN inventory_items i         ON i.id  = sr.item_id
    -- Resolve legacy source station from supplier string
    LEFT JOIN stations   ss_legacy ON (
        sr.source_station_id IS NULL
        AND sr.supplier LIKE 'Station Transfer from %'
        AND ss_legacy.code = TRIM(substring(sr.supplier FROM 23))
    )
    WHERE
        -- A: Modern IST
        sr.source_station_id IS NOT NULL
        -- B: Legacy IST
        OR sr.supplier LIKE 'Station Transfer from %'
        -- C: Unlinked potential IST orphan
        --    Must have NO supplier AND NO invoice — the fingerprint of a lost-linkage IST
        --    (frontend always sets supplier for normal receipts, so NULL supplier + NULL invoice
        --     is a strong signal this was created by fn_inter_station_transfer and lost its link)
        OR (    sr.source_station_id IS NULL
            AND (sr.supplier IS NULL OR TRIM(sr.supplier) = '')
            AND sr.invoice_number IS NULL
        )
),

-- ─────────────────────────────────────────────────────────────────────────────
-- paired: FULL OUTER JOIN to surface healthy pairs and all orphan types
--
-- Note on unlinked records:
--   resolved_source_station_id IS NULL for Category C records.
--   The join condition s.source_station_id = d.resolved_source_station_id
--   evaluates to UNKNOWN (NULL = NULL is not TRUE in SQL), so unlinked
--   dest records NEVER match any source. They always appear as dest-only
--   rows — which is correct since we cannot safely pair them automatically.
-- ─────────────────────────────────────────────────────────────────────────────
paired AS (
    SELECT
        COALESCE(s.transfer_date,      d.transfer_date)         AS transfer_date,
        COALESCE(
            s.source_station_code,
            (SELECT st.code FROM stations st WHERE st.id = d.resolved_source_station_id)
        )                                                        AS source_station,
        COALESCE(s.dest_station_code,  d.dest_station_code)     AS dest_station,
        COALESCE(s.item_name,          d.item_name)             AS item_name,
        COALESCE(s.item_category,      d.item_category)         AS item_category,
        COALESCE(s.item_unit,          d.item_unit)             AS item_unit,
        COALESCE(s.quantity,           d.quantity)              AS quantity,
        s.source_log_id,
        s.source_station_id,
        d.dest_log_id,
        d.dest_station_id,
        COALESCE(s.item_id,            d.item_id)               AS item_id,
        COALESCE(d.link_method,        'none')                  AS link_method,
        COALESCE(s.match_group_size,   1)                       AS source_group_size,
        COALESCE(d.match_group_size,   1)                       AS dest_group_size
    FROM source_ist s
    FULL OUTER JOIN dest_ist d
        ON  s.item_id           = d.item_id
        AND s.transfer_date     = d.transfer_date
        AND s.source_station_id = d.resolved_source_station_id
        AND s.dest_station_code = d.dest_station_code
        AND s.rn                = d.rn
),

-- ─────────────────────────────────────────────────────────────────────────────
-- enriched: add live stock snapshots, subsequent-consumption totals,
--           replacement-transfer detection, and corroborating-transfer detection
-- ─────────────────────────────────────────────────────────────────────────────
enriched AS (
    SELECT
        p.*,

        -- Live current_stock at source
        (SELECT si.current_stock
           FROM station_inventory si
          WHERE si.station_id = p.source_station_id
            AND si.item_id    = p.item_id)                      AS source_current_stock,

        -- Live current_stock at destination
        (SELECT si.current_stock
           FROM station_inventory si
          WHERE si.station_id = p.dest_station_id
            AND si.item_id    = p.item_id)                      AS dest_current_stock,

        -- Total subsequent normal consumption at destination after the transfer date.
        -- Excludes IST Transfer Out and Depot Transfer Out (those are stock movements,
        -- not consumption). Used to detect consumed-orphan situations.
        COALESCE((
            SELECT SUM(cl.quantity_used)
              FROM consumption_logs cl
             WHERE cl.station_id        = p.dest_station_id
               AND cl.item_id           = p.item_id
               AND cl.consumption_date  > p.transfer_date
               AND cl.remarks NOT LIKE 'Inter-Station Transfer Out%'
               AND cl.remarks NOT LIKE 'Depot Transfer Out%'
        ), 0)                                                   AS subsequent_consumption_at_dest,

        -- Replacement transfer: an IST between same source+dest+item exists within
        -- ±7 days of this transfer date (excluding the current records themselves).
        -- Only meaningful when source_station_id is known.
        EXISTS (
            SELECT 1
              FROM consumption_logs cl2
             WHERE cl2.station_id        = p.source_station_id
               AND cl2.item_id           = p.item_id
               AND cl2.remarks           = 'Inter-Station Transfer Out to ' || p.dest_station
               AND cl2.consumption_date  BETWEEN p.transfer_date - 7
                                             AND p.transfer_date + 7
               AND (p.source_log_id IS NULL OR cl2.id <> p.source_log_id)
        )                                                       AS replacement_transfer_exists,

        -- Replacement source log ID
        (SELECT cl2.id
           FROM consumption_logs cl2
          WHERE cl2.station_id        = p.source_station_id
            AND cl2.item_id           = p.item_id
            AND cl2.remarks           = 'Inter-Station Transfer Out to ' || p.dest_station
            AND cl2.consumption_date  BETWEEN p.transfer_date - 7
                                          AND p.transfer_date + 7
            AND (p.source_log_id IS NULL OR cl2.id <> p.source_log_id)
          LIMIT 1)                                              AS replacement_source_log_id,

        -- Replacement destination log ID
        (SELECT sr2.id
           FROM stock_received sr2
          WHERE sr2.station_id        = p.dest_station_id
            AND sr2.item_id           = p.item_id
            AND sr2.source_station_id = p.source_station_id
            AND sr2.received_date     BETWEEN p.transfer_date - 7
                                          AND p.transfer_date + 7
            AND (p.dest_log_id IS NULL OR sr2.id <> p.dest_log_id)
          LIMIT 1)                                              AS replacement_dest_log_id,

        -- ── Corroborating evidence for UNLINKED records ────────────────────
        -- When link_method = 'unlinked', the system cannot pair automatically.
        -- However, we surface any Transfer Out to this dest station for the same
        -- item within ±14 days as corroborating evidence for the admin's review.
        -- This is informational only — never used to auto-pair or auto-repair.
        (CASE
            WHEN p.link_method = 'unlinked' AND p.dest_station_id IS NOT NULL
            THEN EXISTS (
                SELECT 1
                  FROM consumption_logs cl3
                  JOIN stations         sdest ON sdest.id = p.dest_station_id
                 WHERE cl3.item_id          = p.item_id
                   AND cl3.quantity_used    = p.quantity
                   AND cl3.consumption_date BETWEEN p.transfer_date - 14
                                                AND p.transfer_date + 14
                   AND cl3.remarks          = 'Inter-Station Transfer Out to ' || sdest.code
            )
            ELSE false
        END)                                                    AS corroborating_transfer_exists,

        -- The Transfer Out log that corroborates the unlinked receipt (informational only)
        (CASE
            WHEN p.link_method = 'unlinked' AND p.dest_station_id IS NOT NULL
            THEN (
                SELECT cl3.id
                  FROM consumption_logs cl3
                  JOIN stations         sdest ON sdest.id = p.dest_station_id
                 WHERE cl3.item_id          = p.item_id
                   AND cl3.quantity_used    = p.quantity
                   AND cl3.consumption_date BETWEEN p.transfer_date - 14
                                                AND p.transfer_date + 14
                   AND cl3.remarks          = 'Inter-Station Transfer Out to ' || sdest.code
                 LIMIT 1
            )
            ELSE NULL
        END)                                                    AS corroborating_source_log_id,

        -- The source station of the corroborating Transfer Out
        (CASE
            WHEN p.link_method = 'unlinked' AND p.dest_station_id IS NOT NULL
            THEN (
                SELECT s3.code
                  FROM consumption_logs cl3
                  JOIN stations         s3    ON s3.id    = cl3.station_id
                  JOIN stations         sdest ON sdest.id = p.dest_station_id
                 WHERE cl3.item_id          = p.item_id
                   AND cl3.quantity_used    = p.quantity
                   AND cl3.consumption_date BETWEEN p.transfer_date - 14
                                                AND p.transfer_date + 14
                   AND cl3.remarks          = 'Inter-Station Transfer Out to ' || sdest.code
                 LIMIT 1
            )
            ELSE NULL
        END)                                                    AS corroborating_source_station

    FROM paired p
)

-- ─────────────────────────────────────────────────────────────────────────────
-- Final SELECT: apply classification, recommended_action, and diagnosis
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
    e.transfer_date,
    e.source_station,
    e.dest_station,
    e.item_name,
    e.item_category,
    e.item_unit,
    e.quantity,
    e.source_log_id,
    e.dest_log_id,
    e.source_current_stock,
    e.dest_current_stock,
    e.subsequent_consumption_at_dest,
    e.replacement_transfer_exists,
    e.replacement_source_log_id,
    e.replacement_dest_log_id,
    e.corroborating_transfer_exists,
    e.corroborating_source_log_id,
    e.corroborating_source_station,
    COALESCE(e.link_method, 'none')                             AS link_method,

    -- ── Classification ────────────────────────────────────────────────────────
    CASE
        -- Ambiguous: multiple identical transfers on same day/route/item
        WHEN e.source_group_size > 1 OR e.dest_group_size > 1
            THEN 'Ambiguous / Manual Review'

        -- Both sides present
        WHEN e.source_log_id IS NOT NULL AND e.dest_log_id IS NOT NULL
            THEN CASE
                     WHEN e.link_method = 'legacy' THEN 'Legacy'
                     ELSE 'Healthy'
                 END

        -- Dest exists, source missing — determine subcategory
        WHEN e.source_log_id IS NULL AND e.dest_log_id IS NOT NULL
            THEN CASE
                     -- Unlinked fingerprint (no supplier, no invoice)
                     WHEN e.link_method = 'unlinked'
                         THEN CASE
                                  WHEN e.subsequent_consumption_at_dest > 0
                                      THEN 'Unlinked Destination Receipt — Consumed Stock / Manual Review Required'
                                  ELSE 'Unlinked Destination Receipt — Manual Review'
                              END
                     -- Source station not determinable
                     WHEN e.link_method = 'none'
                         THEN 'Cannot Determine'
                     -- Replacement found nearby
                     WHEN e.replacement_transfer_exists
                         THEN 'Potentially Repaired'
                     -- Subsequent consumption blocks auto-repair
                     WHEN e.subsequent_consumption_at_dest > 0
                         THEN 'Orphan Destination — Consumed Stock / Manual Review Required'
                     -- Clean orphan — repairable
                     ELSE 'Orphan Destination'
                 END

        -- Source exists, dest missing
        WHEN e.source_log_id IS NOT NULL AND e.dest_log_id IS NULL
            THEN 'Orphan Source'

        ELSE 'Cannot Determine'
    END                                                         AS status,

    -- ── Recommended Action ────────────────────────────────────────────────────
    CASE
        WHEN e.source_group_size > 1 OR e.dest_group_size > 1
            THEN 'Manual review: multiple identical transfers on same day/route/item.'

        WHEN e.source_log_id IS NOT NULL AND e.dest_log_id IS NOT NULL
            THEN 'No action required.'

        WHEN e.source_log_id IS NULL AND e.dest_log_id IS NOT NULL
            AND e.link_method = 'unlinked'
            THEN CASE
                     WHEN e.subsequent_consumption_at_dest > 0
                         THEN 'Manual review required: unlinked receipt and stock already consumed. Do not auto-repair.'
                     WHEN e.corroborating_transfer_exists
                         THEN 'Review corroborating Transfer Out from ' || COALESCE(e.corroborating_source_station, '?') || '. If confirmed, use targeted SQL with exact IDs.'
                     ELSE 'Unlinked receipt. Investigate manually. If source confirmed, use targeted SQL with exact IDs.'
                 END

        WHEN e.source_log_id IS NULL AND e.dest_log_id IS NOT NULL
            AND e.link_method = 'none'
            THEN 'Cannot determine source. Investigate manually.'

        WHEN e.source_log_id IS NULL AND e.dest_log_id IS NOT NULL
            AND e.replacement_transfer_exists
            THEN 'Replacement transfer exists. Verify coverage. Re-date if correction needed.'

        WHEN e.source_log_id IS NULL AND e.dest_log_id IS NOT NULL
            AND e.subsequent_consumption_at_dest > 0
            THEN 'Manual review required: orphan stock already consumed. Cannot auto-repair.'

        WHEN e.source_log_id IS NULL AND e.dest_log_id IS NOT NULL
            THEN 'Run remove_orphan_dest repair to delete receipt and restore destination stock.'

        WHEN e.source_log_id IS NOT NULL AND e.dest_log_id IS NULL
            THEN 'Run remove_orphan_source repair to delete Transfer Out and restore source stock.'

        ELSE 'No action required.'
    END                                                         AS recommended_action,

    -- ── Diagnosis (human-readable) ────────────────────────────────────────────
    CASE
        WHEN e.source_group_size > 1 OR e.dest_group_size > 1
            THEN 'Multiple transfers exist for the same source, destination, item, and date. '
                 'Automatic pairing is ambiguous. '
                 'Counts — source: ' || e.source_group_size
                 || ', dest: ' || e.dest_group_size || '.'

        WHEN e.source_log_id IS NOT NULL AND e.dest_log_id IS NOT NULL
             AND e.link_method = 'legacy'
            THEN 'Transfer is intact but uses legacy supplier-string linkage (pre-038 format). '
                 'Both records exist and are paired via the supplier field.'

        WHEN e.source_log_id IS NOT NULL AND e.dest_log_id IS NOT NULL
            THEN 'Transfer is healthy. Both source Transfer Out and destination receipt exist '
                 'and are correctly paired.'

        WHEN e.source_log_id IS NULL AND e.dest_log_id IS NOT NULL
             AND e.link_method = 'unlinked'
             AND e.subsequent_consumption_at_dest > 0
            THEN 'Unlinked destination receipt (source_station_id IS NULL, supplier IS NULL, '
                 'invoice_number IS NULL). '
                 || e.subsequent_consumption_at_dest
                 || ' units have been subsequently consumed at ' || COALESCE(e.dest_station, '?')
                 || '. Automatic repair is BLOCKED. Manual admin decision required. '
                 || CASE WHEN e.corroborating_transfer_exists
                         THEN 'Corroborating Transfer Out found from '
                              || COALESCE(e.corroborating_source_station, '?')
                              || ' (informational only — not auto-paired).'
                         ELSE 'No corroborating Transfer Out found within ±14 days.'
                    END

        WHEN e.source_log_id IS NULL AND e.dest_log_id IS NOT NULL
             AND e.link_method = 'unlinked'
            THEN 'Unlinked destination receipt (source_station_id IS NULL, supplier IS NULL, '
                 'invoice_number IS NULL). This receipt has the fingerprint of a pre-fix IST '
                 'that lost its linkage data. It CANNOT be automatically identified as an IST '
                 'without manual admin confirmation of the source station. '
                 || CASE WHEN e.corroborating_transfer_exists
                         THEN 'Corroborating Transfer Out found from '
                              || COALESCE(e.corroborating_source_station, '?')
                              || ' for same item/quantity/date range (informational only).'
                         ELSE 'No corroborating Transfer Out found within ±14 days.'
                    END

        WHEN e.source_log_id IS NULL AND e.dest_log_id IS NOT NULL
             AND e.link_method = 'none'
            THEN 'Destination receipt exists but source station cannot be determined. '
                 'source_station_id is NULL and supplier does not match any known pattern.'

        WHEN e.source_log_id IS NULL AND e.dest_log_id IS NOT NULL
             AND e.replacement_transfer_exists
            THEN 'Orphan destination receipt detected. A replacement IST exists within ±7 days. '
                 'The original source-side Transfer Out may have been deleted. '
                 'Verify whether the replacement covers this receipt before any repair.'

        WHEN e.source_log_id IS NULL AND e.dest_log_id IS NOT NULL
             AND e.subsequent_consumption_at_dest > 0
            THEN 'Orphan destination receipt. No corresponding source Transfer Out found. '
                 || e.subsequent_consumption_at_dest
                 || ' units subsequently consumed at destination. '
                 'Automatic repair is BLOCKED. Manual review required.'

        WHEN e.source_log_id IS NULL AND e.dest_log_id IS NOT NULL
            THEN 'Orphan destination receipt. No corresponding source Transfer Out found. '
                 'Destination stock was increased without a matching source deduction.'

        WHEN e.source_log_id IS NOT NULL AND e.dest_log_id IS NULL
            THEN 'Orphan source Transfer Out. No corresponding destination receipt found. '
                 'Source stock was deducted without a matching destination increase.'

        ELSE 'Status cannot be reliably determined. Investigate manually.'
    END                                                         AS diagnosis

FROM enriched e
ORDER BY e.transfer_date DESC, status, e.source_station, e.dest_station;

COMMENT ON VIEW v_ist_audit IS
    'Read-only audit view classifying all Inter-Station Transfer records. '
    'Covers modern IST (source_station_id), legacy IST (supplier string), and '
    'unlinked potential IST orphans (no supplier, no invoice). '
    'Uses FULL OUTER JOIN to surface healthy pairs, orphans, and ambiguous cases. '
    'Unlinked records are classified for review only and cannot be auto-repaired. '
    'RLS is enforced via the underlying tables.';


-- =============================================================================
-- PART 3: fn_ist_repair_preview
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_ist_repair_preview(
    p_action        text,
    p_target_log_id uuid,
    p_new_date      date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_role            text;
    v_receipt         record;
    v_log             record;
    v_dest_code       text;
    v_source_code     text;
    v_source_id       uuid;
    v_dest_id         uuid;
    v_item            record;
    v_source_inv      record;
    v_dest_inv        record;
    v_subsequent_cons numeric;
    v_paired_source   record;
    v_paired_dest     record;
    v_match_count     integer;
    v_expected_remark text;
    v_corr_exists     boolean;
    v_corr_log_id     uuid;
    v_corr_station    text;
BEGIN
    -- ── ALS role guard ────────────────────────────────────────────────────────
    v_role := get_user_role();
    IF v_role <> 'ALS' THEN
        RETURN jsonb_build_object(
            'safe_to_proceed', false,
            'failure_reason',
            'Access denied: ALS role required. Your role is: '
            || COALESCE(v_role, 'unknown')
        );
    END IF;

    -- =========================================================================
    -- ACTION: remove_orphan_dest
    -- =========================================================================
    IF p_action = 'remove_orphan_dest' THEN

        -- Fetch the target receipt
        SELECT sr.*, s.code AS dest_code, s.id AS dest_sid
          INTO v_receipt
          FROM stock_received sr
          JOIN stations s ON s.id = sr.station_id
         WHERE sr.id = p_target_log_id;

        IF v_receipt IS NULL THEN
            RETURN jsonb_build_object(
                'safe_to_proceed', false,
                'failure_reason',
                'Stock received record not found: ' || p_target_log_id::text
            );
        END IF;

        -- ── Detect linkage category ───────────────────────────────────────────

        -- UNLINKED: no source_station_id, no supplier, no invoice
        -- → cannot auto-repair; return informational preview only
        IF v_receipt.source_station_id IS NULL
           AND (v_receipt.supplier IS NULL OR TRIM(v_receipt.supplier) = '')
           AND v_receipt.invoice_number IS NULL
        THEN
            SELECT * INTO v_item FROM inventory_items WHERE id = v_receipt.item_id;
            SELECT * INTO v_dest_inv
              FROM station_inventory
             WHERE station_id = v_receipt.dest_sid AND item_id = v_receipt.item_id;

            SELECT COALESCE(SUM(cl.quantity_used), 0) INTO v_subsequent_cons
              FROM consumption_logs cl
             WHERE cl.station_id       = v_receipt.dest_sid
               AND cl.item_id          = v_receipt.item_id
               AND cl.consumption_date > v_receipt.received_date
               AND cl.remarks NOT LIKE 'Inter-Station Transfer Out%'
               AND cl.remarks NOT LIKE 'Depot Transfer Out%';

            -- Corroborating Transfer Out
            SELECT EXISTS (
                SELECT 1 FROM consumption_logs cl3
                 WHERE cl3.item_id          = v_receipt.item_id
                   AND cl3.quantity_used    = v_receipt.quantity
                   AND cl3.consumption_date BETWEEN v_receipt.received_date - 14
                                                AND v_receipt.received_date + 14
                   AND cl3.remarks = 'Inter-Station Transfer Out to ' || v_receipt.dest_code
            ) INTO v_corr_exists;

            IF v_corr_exists THEN
                SELECT cl3.id, s3.code
                  INTO v_corr_log_id, v_corr_station
                  FROM consumption_logs cl3
                  JOIN stations s3 ON s3.id = cl3.station_id
                 WHERE cl3.item_id          = v_receipt.item_id
                   AND cl3.quantity_used    = v_receipt.quantity
                   AND cl3.consumption_date BETWEEN v_receipt.received_date - 14
                                                AND v_receipt.received_date + 14
                   AND cl3.remarks = 'Inter-Station Transfer Out to ' || v_receipt.dest_code
                 LIMIT 1;
            END IF;

            RETURN jsonb_build_object(
                'safe_to_proceed',               false,
                'failure_reason',
                'Unlinked destination receipt: source_station_id is NULL, '
                'supplier is NULL, and invoice_number is NULL. '
                'The system cannot confirm this is an IST receipt without manual '
                'admin identification of the source station. '
                'Automatic repair is blocked. Use the targeted SQL approach '
                'with exact record IDs after confirming the source manually.',
                'action',                        p_action,
                'dest_station',                  v_receipt.dest_code,
                'item_name',                     v_item.name,
                'item_unit',                     v_item.unit,
                'quantity',                      v_receipt.quantity,
                'transfer_date',                 v_receipt.received_date,
                'dest_log_id',                   v_receipt.id,
                'dest_stock_before',             COALESCE(v_dest_inv.current_stock, 0),
                'subsequent_consumption_at_dest', v_subsequent_cons,
                'corroborating_transfer_exists', v_corr_exists,
                'corroborating_source_log_id',   v_corr_log_id,
                'corroborating_source_station',  v_corr_station,
                'consumption_records_changed',   0,
                'qiu_changed',                   0,
                'billing_changed',               0,
                'asset_lifecycle_changed',       0,
                'notes',
                'This is an Unlinked Destination Receipt. '
                || CASE WHEN v_corr_exists
                        THEN 'A corroborating Transfer Out was found from station '
                             || COALESCE(v_corr_station, '?')
                             || ' (ID: ' || COALESCE(v_corr_log_id::text, '?') || '). '
                             || 'If you have confirmed this is the matching source, '
                             || 'use the targeted SQL approach with both exact IDs.'
                        ELSE 'No corroborating Transfer Out found within ±14 days.'
                   END
            );
        END IF;

        -- NOT an IST receipt at all (supplier IS NOT NULL, not matching any pattern)
        IF v_receipt.source_station_id IS NULL
           AND v_receipt.supplier IS NOT NULL
           AND v_receipt.supplier NOT LIKE 'Station Transfer from %'
        THEN
            RETURN jsonb_build_object(
                'safe_to_proceed', false,
                'failure_reason',
                'This is a normal supplier receipt (supplier = '''
                || v_receipt.supplier
                || '''). It is not an IST receipt and cannot be repaired here.'
            );
        END IF;

        -- ── Modern or legacy IST — resolve source ─────────────────────────────
        IF v_receipt.source_station_id IS NOT NULL THEN
            SELECT code INTO v_source_code FROM stations WHERE id = v_receipt.source_station_id;
            v_source_id := v_receipt.source_station_id;
        ELSE
            v_source_code := TRIM(substring(v_receipt.supplier FROM 23));
            SELECT id INTO v_source_id FROM stations WHERE code = v_source_code;
        END IF;

        SELECT * INTO v_item FROM inventory_items WHERE id = v_receipt.item_id;

        -- Guard: verify no matching source Transfer Out (proves it is truly an orphan)
        v_expected_remark := 'Inter-Station Transfer Out to ' || v_receipt.dest_code;
        IF v_source_id IS NOT NULL THEN
            SELECT COUNT(*) INTO v_match_count
              FROM consumption_logs
             WHERE station_id       = v_source_id
               AND item_id          = v_receipt.item_id
               AND quantity_used    = v_receipt.quantity
               AND consumption_date = v_receipt.received_date
               AND remarks          = v_expected_remark;

            IF v_match_count > 0 THEN
                RETURN jsonb_build_object(
                    'safe_to_proceed', false,
                    'failure_reason',
                    'A matching source Transfer Out was found ('
                    || v_match_count
                    || ' record(s)). This is NOT an orphan. '
                    'Use fn_delete_stock_received from the UI to delete it properly.'
                );
            END IF;
        END IF;

        -- Fetch inventory snapshots
        SELECT * INTO v_dest_inv
          FROM station_inventory
         WHERE station_id = v_receipt.dest_sid AND item_id = v_receipt.item_id;

        -- Calculate subsequent consumption at destination
        SELECT COALESCE(SUM(cl.quantity_used), 0) INTO v_subsequent_cons
          FROM consumption_logs cl
         WHERE cl.station_id       = v_receipt.dest_sid
           AND cl.item_id          = v_receipt.item_id
           AND cl.consumption_date > v_receipt.received_date
           AND cl.remarks NOT LIKE 'Inter-Station Transfer Out%'
           AND cl.remarks NOT LIKE 'Depot Transfer Out%';

        -- Block if subsequent consumption exists
        IF v_subsequent_cons > 0 THEN
            RETURN jsonb_build_object(
                'safe_to_proceed',               false,
                'failure_reason',
                'Automatic repair blocked: '
                || v_subsequent_cons
                || ' units have been consumed at the destination station after '
                || 'this receipt date. Manual review required.',
                'action',                        p_action,
                'source_station',                v_source_code,
                'dest_station',                  v_receipt.dest_code,
                'item_name',                     v_item.name,
                'item_unit',                     v_item.unit,
                'quantity',                      v_receipt.quantity,
                'transfer_date',                 v_receipt.received_date,
                'dest_log_id',                   v_receipt.id,
                'dest_stock_before',             COALESCE(v_dest_inv.current_stock, 0),
                'dest_stock_after',              NULL,
                'subsequent_consumption_at_dest', v_subsequent_cons,
                'consumption_records_changed',   0,
                'qiu_changed',                   0,
                'billing_changed',               0,
                'asset_lifecycle_changed',       0,
                'notes',
                'Orphan Destination — Consumed Stock / Manual Review Required. '
                || v_subsequent_cons
                || ' units received on '
                || v_receipt.received_date
                || ' have been consumed. Do not modify the consumption records.'
            );
        END IF;

        -- Guard: dest stock would not go negative
        IF COALESCE(v_dest_inv.current_stock, 0) < v_receipt.quantity THEN
            RETURN jsonb_build_object(
                'safe_to_proceed', false,
                'failure_reason',
                'Destination current_stock ('
                || COALESCE(v_dest_inv.current_stock, 0)
                || ') is less than the receipt quantity ('
                || v_receipt.quantity
                || '). Removal would cause negative stock.'
            );
        END IF;

        RETURN jsonb_build_object(
            'safe_to_proceed',               true,
            'failure_reason',                null,
            'action',                        p_action,
            'source_station',                v_source_code,
            'dest_station',                  v_receipt.dest_code,
            'item_name',                     v_item.name,
            'item_unit',                     v_item.unit,
            'quantity',                      v_receipt.quantity,
            'transfer_date',                 v_receipt.received_date,
            'source_log_id',                 null,
            'dest_log_id',                   v_receipt.id,
            'source_stock_before',           null,
            'source_stock_after',            null,
            'dest_stock_before',             COALESCE(v_dest_inv.current_stock, 0),
            'dest_stock_after',
                COALESCE(v_dest_inv.current_stock, 0) - v_receipt.quantity,
            'subsequent_consumption_at_dest', v_subsequent_cons,
            'records_to_delete',             jsonb_build_array(
                jsonb_build_object(
                    'table', 'stock_received',
                    'id',    v_receipt.id,
                    'date',  v_receipt.received_date
                )
            ),
            'consumption_records_changed',   0,
            'qiu_changed',                   0,
            'billing_changed',               0,
            'asset_lifecycle_changed',       0,
            'notes',
            'Orphan destination receipt. Removing it will restore destination '
            'current_stock by ' || v_receipt.quantity || ' ' || v_item.unit
            || '. Source station is not touched.'
        );

    -- =========================================================================
    -- ACTION: remove_orphan_source
    -- =========================================================================
    ELSIF p_action = 'remove_orphan_source' THEN

        SELECT cl.*, s.code AS source_code
          INTO v_log
          FROM consumption_logs cl
          JOIN stations s ON s.id = cl.station_id
         WHERE cl.id = p_target_log_id;

        IF v_log IS NULL THEN
            RETURN jsonb_build_object(
                'safe_to_proceed', false,
                'failure_reason',
                'Consumption log record not found: ' || p_target_log_id::text
            );
        END IF;

        IF v_log.remarks NOT LIKE 'Inter-Station Transfer Out to %' THEN
            RETURN jsonb_build_object(
                'safe_to_proceed', false,
                'failure_reason',
                'Record is not an Inter-Station Transfer Out log. '
                'Remarks: ' || COALESCE(v_log.remarks, 'NULL')
            );
        END IF;

        v_dest_code := TRIM(substring(v_log.remarks FROM 31));
        SELECT id INTO v_dest_id FROM stations WHERE code = v_dest_code;

        -- Guard: verify no matching dest receipt (confirms it is truly an orphan source)
        IF v_dest_id IS NOT NULL THEN
            SELECT COUNT(*) INTO v_match_count
              FROM stock_received
             WHERE station_id        = v_dest_id
               AND item_id           = v_log.item_id
               AND quantity          = v_log.quantity_used
               AND received_date     = v_log.consumption_date
               AND source_station_id = v_log.station_id;

            IF v_match_count > 0 THEN
                RETURN jsonb_build_object(
                    'safe_to_proceed', false,
                    'failure_reason',
                    'A matching destination receipt was found. '
                    'This is NOT an orphan source. '
                    'Use fn_delete_consumption from the UI to delete both sides properly.'
                );
            END IF;
        END IF;

        SELECT * INTO v_item     FROM inventory_items  WHERE id = v_log.item_id;
        SELECT * INTO v_source_inv FROM station_inventory
         WHERE station_id = v_log.station_id AND item_id = v_log.item_id;

        RETURN jsonb_build_object(
            'safe_to_proceed',               true,
            'failure_reason',                null,
            'action',                        p_action,
            'source_station',                v_log.source_code,
            'dest_station',                  v_dest_code,
            'item_name',                     v_item.name,
            'item_unit',                     v_item.unit,
            'quantity',                      v_log.quantity_used,
            'transfer_date',                 v_log.consumption_date,
            'source_log_id',                 v_log.id,
            'dest_log_id',                   null,
            'source_stock_before',           COALESCE(v_source_inv.current_stock, 0),
            'source_stock_after',
                COALESCE(v_source_inv.current_stock, 0) + v_log.quantity_used,
            'dest_stock_before',             null,
            'dest_stock_after',              null,
            'subsequent_consumption_at_dest', 0,
            'records_to_delete',             jsonb_build_array(
                jsonb_build_object(
                    'table', 'consumption_logs',
                    'id',    v_log.id,
                    'date',  v_log.consumption_date
                )
            ),
            'consumption_records_changed',   0,
            'qiu_changed',                   0,
            'billing_changed',               0,
            'asset_lifecycle_changed',       0,
            'notes',
            'Orphan source Transfer Out. Removing it will restore source current_stock '
            'by ' || v_log.quantity_used || ' ' || v_item.unit
            || '. Destination station is not touched.'
        );

    -- =========================================================================
    -- ACTION: redate_transfer
    -- =========================================================================
    ELSIF p_action = 'redate_transfer' THEN

        IF p_new_date IS NULL THEN
            RETURN jsonb_build_object(
                'safe_to_proceed', false,
                'failure_reason',
                'p_new_date is required for redate_transfer action.'
            );
        END IF;

        -- Try as source consumption_log first
        SELECT cl.*, s.code AS source_code
          INTO v_log
          FROM consumption_logs cl
          JOIN stations s ON s.id = cl.station_id
         WHERE cl.id = p_target_log_id
           AND cl.remarks LIKE 'Inter-Station Transfer Out to %';

        IF v_log IS NOT NULL THEN
            v_dest_code := TRIM(substring(v_log.remarks FROM 31));
            SELECT id INTO v_dest_id FROM stations WHERE code = v_dest_code;
            SELECT * INTO v_item FROM inventory_items WHERE id = v_log.item_id;

            SELECT COUNT(*) INTO v_match_count
              FROM stock_received
             WHERE station_id        = v_dest_id
               AND item_id           = v_log.item_id
               AND quantity          = v_log.quantity_used
               AND received_date     = v_log.consumption_date
               AND source_station_id = v_log.station_id;

            IF v_match_count <> 1 THEN
                RETURN jsonb_build_object(
                    'safe_to_proceed', false,
                    'failure_reason',
                    'Expected exactly 1 matching destination receipt, found '
                    || v_match_count || '. Cannot safely re-date.'
                );
            END IF;

            SELECT id INTO v_paired_dest
              FROM stock_received
             WHERE station_id        = v_dest_id
               AND item_id           = v_log.item_id
               AND quantity          = v_log.quantity_used
               AND received_date     = v_log.consumption_date
               AND source_station_id = v_log.station_id;

            RETURN jsonb_build_object(
                'safe_to_proceed',               true,
                'failure_reason',                null,
                'action',                        p_action,
                'source_station',                v_log.source_code,
                'dest_station',                  v_dest_code,
                'item_name',                     v_item.name,
                'item_unit',                     v_item.unit,
                'quantity',                      v_log.quantity_used,
                'transfer_date',                 v_log.consumption_date,
                'new_date',                      p_new_date,
                'source_log_id',                 v_log.id,
                'dest_log_id',                   v_paired_dest,
                'source_stock_before',           null,
                'source_stock_after',            null,
                'dest_stock_before',             null,
                'dest_stock_after',              null,
                'subsequent_consumption_at_dest', 0,
                'records_to_delete',             '[]'::jsonb,
                'consumption_records_changed',   0,
                'qiu_changed',                   0,
                'billing_changed',               0,
                'asset_lifecycle_changed',       0,
                'notes',
                'Both consumption_logs.consumption_date and '
                'stock_received.received_date will be updated from '
                || v_log.consumption_date || ' to ' || p_new_date
                || '. Stock values are not changed.'
            );
        END IF;

        -- Try as destination stock_received
        SELECT sr.*, s.code AS dest_code
          INTO v_receipt
          FROM stock_received sr
          JOIN stations s ON s.id = sr.station_id
         WHERE sr.id = p_target_log_id
           AND (sr.source_station_id IS NOT NULL
                OR sr.supplier LIKE 'Station Transfer from %');

        IF v_receipt IS NULL THEN
            RETURN jsonb_build_object(
                'safe_to_proceed', false,
                'failure_reason',
                'Record not found or is not a linkable IST record: '
                || p_target_log_id::text
                || '. Note: unlinked receipts (no source_station_id, no supplier) '
                || 'cannot be re-dated automatically.'
            );
        END IF;

        IF v_receipt.source_station_id IS NOT NULL THEN
            v_source_id   := v_receipt.source_station_id;
        ELSE
            v_source_code := TRIM(substring(v_receipt.supplier FROM 23));
            SELECT id INTO v_source_id FROM stations WHERE code = v_source_code;
        END IF;

        SELECT code INTO v_source_code FROM stations WHERE id = v_source_id;
        SELECT * INTO v_item FROM inventory_items WHERE id = v_receipt.item_id;
        v_expected_remark := 'Inter-Station Transfer Out to ' || v_receipt.dest_code;

        SELECT COUNT(*) INTO v_match_count
          FROM consumption_logs
         WHERE station_id       = v_source_id
           AND item_id          = v_receipt.item_id
           AND quantity_used    = v_receipt.quantity
           AND consumption_date = v_receipt.received_date
           AND remarks          = v_expected_remark;

        IF v_match_count <> 1 THEN
            RETURN jsonb_build_object(
                'safe_to_proceed', false,
                'failure_reason',
                'Expected exactly 1 matching source Transfer Out, found '
                || v_match_count || '. Cannot safely re-date.'
            );
        END IF;

        SELECT id INTO v_paired_source
          FROM consumption_logs
         WHERE station_id       = v_source_id
           AND item_id          = v_receipt.item_id
           AND quantity_used    = v_receipt.quantity
           AND consumption_date = v_receipt.received_date
           AND remarks          = v_expected_remark;

        RETURN jsonb_build_object(
            'safe_to_proceed',               true,
            'failure_reason',                null,
            'action',                        p_action,
            'source_station',                v_source_code,
            'dest_station',                  v_receipt.dest_code,
            'item_name',                     v_item.name,
            'item_unit',                     v_item.unit,
            'quantity',                      v_receipt.quantity,
            'transfer_date',                 v_receipt.received_date,
            'new_date',                      p_new_date,
            'source_log_id',                 v_paired_source,
            'dest_log_id',                   v_receipt.id,
            'source_stock_before',           null,
            'source_stock_after',            null,
            'dest_stock_before',             null,
            'dest_stock_after',              null,
            'subsequent_consumption_at_dest', 0,
            'records_to_delete',             '[]'::jsonb,
            'consumption_records_changed',   0,
            'qiu_changed',                   0,
            'billing_changed',               0,
            'asset_lifecycle_changed',       0,
            'notes',
            'Both consumption_logs.consumption_date and '
            'stock_received.received_date will be updated from '
            || v_receipt.received_date || ' to ' || p_new_date
            || '. Stock values are not changed.'
        );

    ELSE
        RETURN jsonb_build_object(
            'safe_to_proceed', false,
            'failure_reason',
            'Unknown action: ' || COALESCE(p_action, 'NULL')
            || '. Supported: remove_orphan_dest, remove_orphan_source, redate_transfer.'
        );
    END IF;

END;
$$;

COMMENT ON FUNCTION fn_ist_repair_preview(text, uuid, date) IS
    'Read-only IST repair preview. Makes zero database changes. '
    'Returns JSON with safe_to_proceed and all before/after details. '
    'Unlinked destination receipts (no source_station_id, no supplier, no invoice) '
    'return safe_to_proceed=false with corroborating evidence for admin review. '
    'Enforces ALS role at database level.';


-- =============================================================================
-- PART 4: fn_ist_repair_execute
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_ist_repair_execute(
    p_action        text,
    p_target_log_id uuid,
    p_new_date      date    DEFAULT NULL,
    p_repaired_by   uuid    DEFAULT NULL,
    p_notes         text    DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_role                text;
    v_receipt             record;
    v_log                 record;
    v_dest_code           text;
    v_source_code         text;
    v_source_id           uuid;
    v_dest_id             uuid;
    v_item                record;
    v_source_inv          record;
    v_dest_inv            record;
    v_subsequent_cons     numeric;
    v_paired_source       record;
    v_paired_dest         record;
    v_match_count         integer;
    v_expected_remark     text;
    v_source_stock_before numeric;
    v_source_stock_after  numeric;
    v_dest_stock_before   numeric;
    v_dest_stock_after    numeric;
    v_repair_log_id       uuid;
BEGIN
    -- ── ALS role guard ────────────────────────────────────────────────────────
    v_role := get_user_role();
    IF v_role <> 'ALS' THEN
        RAISE EXCEPTION
            'Access denied: ALS role required. Your role is: %',
            COALESCE(v_role, 'unknown');
    END IF;

    -- =========================================================================
    -- ACTION: remove_orphan_dest
    -- =========================================================================
    IF p_action = 'remove_orphan_dest' THEN

        SELECT sr.*, s.code AS dest_code, s.id AS dest_sid
          INTO v_receipt
          FROM stock_received sr
          JOIN stations s ON s.id = sr.station_id
         WHERE sr.id = p_target_log_id
         FOR UPDATE;

        IF v_receipt IS NULL THEN
            RAISE EXCEPTION
                'STOP: Stock received record % not found. No changes made.',
                p_target_log_id;
        END IF;

        -- ── Block unlinked receipts ────────────────────────────────────────────
        IF v_receipt.source_station_id IS NULL
           AND (v_receipt.supplier IS NULL OR TRIM(v_receipt.supplier) = '')
           AND v_receipt.invoice_number IS NULL
        THEN
            RAISE EXCEPTION
                'STOP: Unlinked destination receipt (source_station_id IS NULL, '
                'supplier IS NULL, invoice_number IS NULL). '
                'Automatic repair is blocked. This record requires manual admin '
                'confirmation of the source station before any deletion. '
                'Use the targeted SQL approach with exact IDs after confirming '
                'the source. No changes made.';
        END IF;

        -- Block records that are clearly not IST at all
        IF v_receipt.source_station_id IS NULL
           AND v_receipt.supplier IS NOT NULL
           AND v_receipt.supplier NOT LIKE 'Station Transfer from %'
        THEN
            RAISE EXCEPTION
                'STOP: Record is a normal supplier receipt (supplier = ''%''). '
                'It is not an IST receipt. No changes made.',
                v_receipt.supplier;
        END IF;

        -- ── Resolve source station ─────────────────────────────────────────────
        IF v_receipt.source_station_id IS NOT NULL THEN
            SELECT code INTO v_source_code FROM stations WHERE id = v_receipt.source_station_id;
            v_source_id := v_receipt.source_station_id;
        ELSE
            v_source_code := TRIM(substring(v_receipt.supplier FROM 23));
            SELECT id INTO v_source_id FROM stations WHERE code = v_source_code;
        END IF;

        SELECT * INTO v_item FROM inventory_items WHERE id = v_receipt.item_id;

        -- Guard: verify no source Transfer Out (confirms truly orphaned)
        v_expected_remark := 'Inter-Station Transfer Out to ' || v_receipt.dest_code;
        IF v_source_id IS NOT NULL THEN
            SELECT COUNT(*) INTO v_match_count
              FROM consumption_logs
             WHERE station_id       = v_source_id
               AND item_id          = v_receipt.item_id
               AND quantity_used    = v_receipt.quantity
               AND consumption_date = v_receipt.received_date
               AND remarks          = v_expected_remark;

            IF v_match_count > 0 THEN
                RAISE EXCEPTION
                    'STOP: A matching source Transfer Out was found (% record(s)). '
                    'This is NOT an orphan. '
                    'Use fn_delete_stock_received from the UI instead. No changes made.',
                    v_match_count;
            END IF;
        END IF;

        -- Guard: subsequent consumption — BLOCK (business rule, see requirements)
        SELECT COALESCE(SUM(cl.quantity_used), 0) INTO v_subsequent_cons
          FROM consumption_logs cl
         WHERE cl.station_id       = v_receipt.dest_sid
           AND cl.item_id          = v_receipt.item_id
           AND cl.consumption_date > v_receipt.received_date
           AND cl.remarks NOT LIKE 'Inter-Station Transfer Out%'
           AND cl.remarks NOT LIKE 'Depot Transfer Out%';

        IF v_subsequent_cons > 0 THEN
            RAISE EXCEPTION
                'STOP: Automatic repair blocked. % units have been consumed at % '
                'after receipt date (%). '
                'Classification: Orphan Destination — Consumed Stock / Manual Review Required. '
                'Do NOT delete or modify the consumption records. '
                'This case requires manual admin decision. No changes made.',
                v_subsequent_cons, v_receipt.dest_code, v_receipt.received_date;
        END IF;

        -- Lock and read destination inventory
        SELECT * INTO v_dest_inv
          FROM station_inventory
         WHERE station_id = v_receipt.dest_sid AND item_id = v_receipt.item_id
         FOR UPDATE;

        IF v_dest_inv IS NULL THEN
            RAISE EXCEPTION
                'STOP: Destination inventory record not found. No changes made.';
        END IF;

        IF v_dest_inv.current_stock < v_receipt.quantity THEN
            RAISE EXCEPTION
                'STOP: Destination current_stock (%) is less than receipt quantity (%). '
                'Would cause negative stock. No changes made.',
                v_dest_inv.current_stock, v_receipt.quantity;
        END IF;

        v_dest_stock_before := v_dest_inv.current_stock;
        v_dest_stock_after  := v_dest_inv.current_stock - v_receipt.quantity;

        -- Execute: reverse destination stock (quantity_in_use intentionally untouched)
        UPDATE station_inventory
           SET current_stock = current_stock - v_receipt.quantity,
               last_updated  = now()
         WHERE station_id = v_receipt.dest_sid
           AND item_id    = v_receipt.item_id;

        -- Execute: delete orphan receipt
        DELETE FROM stock_received WHERE id = v_receipt.id;

        -- Write audit log
        INSERT INTO ist_repair_log (
            repair_type,
            source_station_id, dest_station_id, item_id, quantity,
            original_dest_log_id, original_dest_date,
            dest_stock_before, dest_stock_after,
            repair_reason, repaired_by, notes
        ) VALUES (
            'remove_orphan_dest',
            v_source_id, v_receipt.dest_sid, v_receipt.item_id, v_receipt.quantity,
            v_receipt.id, v_receipt.received_date,
            v_dest_stock_before, v_dest_stock_after,
            'Orphan destination receipt removed. No corresponding source Transfer Out existed.',
            p_repaired_by, p_notes
        ) RETURNING id INTO v_repair_log_id;

        RETURN jsonb_build_object(
            'success',                 true,
            'action',                  p_action,
            'repair_log_id',           v_repair_log_id,
            'source_station',          v_source_code,
            'dest_station',            v_receipt.dest_code,
            'item_name',               v_item.name,
            'quantity',                v_receipt.quantity,
            'deleted_dest_log_id',     v_receipt.id,
            'dest_stock_before',       v_dest_stock_before,
            'dest_stock_after',        v_dest_stock_after,
            'source_stock_changed',    false,
            'consumption_records_changed', 0,
            'qiu_changed',             0
        );

    -- =========================================================================
    -- ACTION: remove_orphan_source
    -- =========================================================================
    ELSIF p_action = 'remove_orphan_source' THEN

        SELECT cl.*, s.code AS source_code
          INTO v_log
          FROM consumption_logs cl
          JOIN stations s ON s.id = cl.station_id
         WHERE cl.id = p_target_log_id
           AND cl.remarks LIKE 'Inter-Station Transfer Out to %'
         FOR UPDATE;

        IF v_log IS NULL THEN
            RAISE EXCEPTION
                'STOP: Transfer Out log % not found or is not an IST record. '
                'No changes made.',
                p_target_log_id;
        END IF;

        v_dest_code := TRIM(substring(v_log.remarks FROM 31));
        SELECT id INTO v_dest_id FROM stations WHERE code = v_dest_code;

        -- Guard: verify no matching dest receipt (confirms truly orphaned source)
        IF v_dest_id IS NOT NULL THEN
            SELECT COUNT(*) INTO v_match_count
              FROM stock_received
             WHERE station_id        = v_dest_id
               AND item_id           = v_log.item_id
               AND quantity          = v_log.quantity_used
               AND received_date     = v_log.consumption_date
               AND source_station_id = v_log.station_id;

            IF v_match_count > 0 THEN
                RAISE EXCEPTION
                    'STOP: A matching destination receipt was found. '
                    'This is NOT an orphan source. '
                    'Use fn_delete_consumption from the UI instead. No changes made.';
            END IF;
        END IF;

        SELECT * INTO v_item FROM inventory_items WHERE id = v_log.item_id;

        -- Lock source inventory
        SELECT * INTO v_source_inv
          FROM station_inventory
         WHERE station_id = v_log.station_id AND item_id = v_log.item_id
         FOR UPDATE;

        IF v_source_inv IS NULL THEN
            RAISE EXCEPTION
                'STOP: Source inventory record not found. No changes made.';
        END IF;

        v_source_stock_before := v_source_inv.current_stock;
        v_source_stock_after  := v_source_inv.current_stock + v_log.quantity_used;

        -- Execute: restore source stock (quantity_in_use intentionally untouched)
        UPDATE station_inventory
           SET current_stock = current_stock + v_log.quantity_used,
               last_updated  = now()
         WHERE station_id = v_log.station_id
           AND item_id    = v_log.item_id;

        -- Execute: delete orphan source log
        DELETE FROM consumption_logs WHERE id = v_log.id;

        -- Write audit log
        INSERT INTO ist_repair_log (
            repair_type,
            source_station_id, dest_station_id, item_id, quantity,
            original_source_log_id, original_source_date,
            source_stock_before, source_stock_after,
            repair_reason, repaired_by, notes
        ) VALUES (
            'remove_orphan_source',
            v_log.station_id, v_dest_id, v_log.item_id, v_log.quantity_used,
            v_log.id, v_log.consumption_date,
            v_source_stock_before, v_source_stock_after,
            'Orphan source Transfer Out removed. No corresponding destination receipt existed.',
            p_repaired_by, p_notes
        ) RETURNING id INTO v_repair_log_id;

        RETURN jsonb_build_object(
            'success',                 true,
            'action',                  p_action,
            'repair_log_id',           v_repair_log_id,
            'source_station',          v_log.source_code,
            'dest_station',            v_dest_code,
            'item_name',               v_item.name,
            'quantity',                v_log.quantity_used,
            'deleted_source_log_id',   v_log.id,
            'source_stock_before',     v_source_stock_before,
            'source_stock_after',      v_source_stock_after,
            'dest_stock_changed',      false,
            'consumption_records_changed', 0,
            'qiu_changed',             0
        );

    -- =========================================================================
    -- ACTION: redate_transfer
    -- =========================================================================
    ELSIF p_action = 'redate_transfer' THEN

        IF p_new_date IS NULL THEN
            RAISE EXCEPTION
                'STOP: p_new_date is required for redate_transfer. No changes made.';
        END IF;

        -- Try as source consumption_log
        SELECT cl.*, s.code AS source_code
          INTO v_log
          FROM consumption_logs cl
          JOIN stations s ON s.id = cl.station_id
         WHERE cl.id = p_target_log_id
           AND cl.remarks LIKE 'Inter-Station Transfer Out to %';

        IF v_log IS NOT NULL THEN
            v_dest_code := TRIM(substring(v_log.remarks FROM 31));
            SELECT id INTO v_dest_id FROM stations WHERE code = v_dest_code;
            SELECT * INTO v_item FROM inventory_items WHERE id = v_log.item_id;

            SELECT COUNT(*) INTO v_match_count
              FROM stock_received
             WHERE station_id        = v_dest_id
               AND item_id           = v_log.item_id
               AND quantity          = v_log.quantity_used
               AND received_date     = v_log.consumption_date
               AND source_station_id = v_log.station_id;

            IF v_match_count <> 1 THEN
                RAISE EXCEPTION
                    'STOP: Expected exactly 1 matching destination receipt, found %. '
                    'Cannot safely re-date. No changes made.',
                    v_match_count;
            END IF;

            SELECT * INTO v_paired_dest
              FROM stock_received
             WHERE station_id        = v_dest_id
               AND item_id           = v_log.item_id
               AND quantity          = v_log.quantity_used
               AND received_date     = v_log.consumption_date
               AND source_station_id = v_log.station_id
             FOR UPDATE;

            -- Re-lock source
            SELECT * INTO v_log
              FROM consumption_logs
             WHERE id = p_target_log_id
             FOR UPDATE;

            UPDATE consumption_logs SET consumption_date = p_new_date WHERE id = v_log.id;
            UPDATE stock_received   SET received_date    = p_new_date WHERE id = v_paired_dest.id;

            INSERT INTO ist_repair_log (
                repair_type,
                source_station_id, dest_station_id, item_id, quantity,
                original_source_log_id, original_dest_log_id,
                original_source_date, original_dest_date,
                repaired_source_date, repaired_dest_date,
                repair_reason, repaired_by, notes
            ) VALUES (
                'redate_transfer',
                v_log.station_id, v_dest_id, v_log.item_id, v_log.quantity_used,
                v_log.id, v_paired_dest.id,
                v_log.consumption_date, v_paired_dest.received_date,
                p_new_date, p_new_date,
                'Transfer dates corrected. Both source and destination updated atomically.',
                p_repaired_by, p_notes
            ) RETURNING id INTO v_repair_log_id;

            RETURN jsonb_build_object(
                'success',         true,
                'action',          p_action,
                'repair_log_id',   v_repair_log_id,
                'source_station',  v_log.source_code,
                'dest_station',    v_dest_code,
                'item_name',       v_item.name,
                'quantity',        v_log.quantity_used,
                'source_log_id',   v_log.id,
                'dest_log_id',     v_paired_dest.id,
                'original_date',   v_log.consumption_date,
                'new_date',        p_new_date,
                'stock_changed',   false,
                'consumption_records_changed', 0,
                'qiu_changed',     0
            );
        END IF;

        -- Try as destination stock_received (modern or legacy only)
        SELECT sr.*, s.code AS dest_code
          INTO v_receipt
          FROM stock_received sr
          JOIN stations s ON s.id = sr.station_id
         WHERE sr.id = p_target_log_id
           AND (sr.source_station_id IS NOT NULL
                OR sr.supplier LIKE 'Station Transfer from %');

        IF v_receipt IS NULL THEN
            RAISE EXCEPTION
                'STOP: Record % not found or is not a linkable IST record. '
                'Unlinked receipts (no source_station_id, no supplier) cannot '
                'be re-dated automatically. No changes made.',
                p_target_log_id;
        END IF;

        IF v_receipt.source_station_id IS NOT NULL THEN
            v_source_id := v_receipt.source_station_id;
        ELSE
            v_source_code := TRIM(substring(v_receipt.supplier FROM 23));
            SELECT id INTO v_source_id FROM stations WHERE code = v_source_code;
        END IF;

        SELECT code INTO v_source_code FROM stations WHERE id = v_source_id;
        SELECT * INTO v_item FROM inventory_items WHERE id = v_receipt.item_id;
        v_expected_remark := 'Inter-Station Transfer Out to ' || v_receipt.dest_code;

        SELECT COUNT(*) INTO v_match_count
          FROM consumption_logs
         WHERE station_id       = v_source_id
           AND item_id          = v_receipt.item_id
           AND quantity_used    = v_receipt.quantity
           AND consumption_date = v_receipt.received_date
           AND remarks          = v_expected_remark;

        IF v_match_count <> 1 THEN
            RAISE EXCEPTION
                'STOP: Expected exactly 1 matching source Transfer Out, found %. '
                'Cannot safely re-date. No changes made.',
                v_match_count;
        END IF;

        SELECT * INTO v_paired_source
          FROM consumption_logs
         WHERE station_id       = v_source_id
           AND item_id          = v_receipt.item_id
           AND quantity_used    = v_receipt.quantity
           AND consumption_date = v_receipt.received_date
           AND remarks          = v_expected_remark
         FOR UPDATE;

        SELECT * INTO v_receipt FROM stock_received WHERE id = p_target_log_id FOR UPDATE;

        UPDATE consumption_logs SET consumption_date = p_new_date WHERE id = v_paired_source.id;
        UPDATE stock_received   SET received_date    = p_new_date WHERE id = v_receipt.id;

        INSERT INTO ist_repair_log (
            repair_type,
            source_station_id, dest_station_id, item_id, quantity,
            original_source_log_id, original_dest_log_id,
            original_source_date, original_dest_date,
            repaired_source_date, repaired_dest_date,
            repair_reason, repaired_by, notes
        ) VALUES (
            'redate_transfer',
            v_source_id, v_receipt.dest_station_id, v_receipt.item_id, v_receipt.quantity,
            v_paired_source.id, v_receipt.id,
            v_paired_source.consumption_date, v_receipt.received_date,
            p_new_date, p_new_date,
            'Transfer dates corrected. Both source and destination updated atomically.',
            p_repaired_by, p_notes
        ) RETURNING id INTO v_repair_log_id;

        RETURN jsonb_build_object(
            'success',        true,
            'action',         p_action,
            'repair_log_id',  v_repair_log_id,
            'source_station', v_source_code,
            'dest_station',   v_receipt.dest_code,
            'item_name',      v_item.name,
            'quantity',       v_receipt.quantity,
            'source_log_id',  v_paired_source.id,
            'dest_log_id',    v_receipt.id,
            'original_date',  v_receipt.received_date,
            'new_date',       p_new_date,
            'stock_changed',  false,
            'consumption_records_changed', 0,
            'qiu_changed',    0
        );

    ELSE
        RAISE EXCEPTION
            'STOP: Unknown action: %. '
            'Supported: remove_orphan_dest, remove_orphan_source, redate_transfer.',
            COALESCE(p_action, 'NULL');
    END IF;

END;
$$;

COMMENT ON FUNCTION fn_ist_repair_execute(text, uuid, date, uuid, text) IS
    'Transactional IST repair executor. Re-validates all guards independently. '
    'Enforces ALS role at database level. '
    'Blocks unlinked destination receipts (no source_station_id, no supplier, no invoice). '
    'Blocks automatic repair when subsequent consumption has occurred at the destination. '
    'Writes a permanent row to ist_repair_log on every successful repair. '
    'Full rollback on any guard failure — zero partial changes.';


-- =============================================================================
-- INDEXES for ist_repair_log
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_ist_repair_log_repaired_at
    ON ist_repair_log (repaired_at DESC);

CREATE INDEX IF NOT EXISTS idx_ist_repair_log_item
    ON ist_repair_log (item_id);

CREATE INDEX IF NOT EXISTS idx_ist_repair_log_stations
    ON ist_repair_log (source_station_id, dest_station_id);


-- =============================================================================
-- END OF 040_ist_audit_repair.sql
-- =============================================================================
