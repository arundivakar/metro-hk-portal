-- =============================================================================
-- 038_fix_inter_station_transfer.sql
-- Fixes quantity_in_use incorrectly inflating on Inter-Station Transfer Out.
-- Also makes IST edits fully bilateral: both source and destination are updated
-- atomically whenever an Inter-Station Transfer is edited or deleted.
--
-- PROBLEM (discovered 2026-09-07):
--   fn_inter_station_transfer creates a consumption_logs entry at the source
--   station with remarks 'Inter-Station Transfer Out to [CODE]'.
--   The consumption trigger (037) increments quantity_in_use for anything that
--   does NOT match 'Depot Transfer Out%'. IST remarks do not match, so
--   quantity_in_use incorrectly increases at the source station.
--
--   Additionally, the previous fn_edit_consumption only updated the source side
--   of an IST edit, leaving the destination stock_received record stale and
--   causing total inventory across all stations to drift.
--
-- BUSINESS RULE:
--   Inter-Station Transfer is pure stock movement.
--   It MUST NOT affect quantity_in_use at source or destination.
--   It MUST NOT create billable consumption.
--   It MUST NOT enter Asset Lifecycle.
--   Source + destination inventory must always move together, atomically.
--
-- WHAT THIS DOES NOT CHANGE:
--   - fn_transfer_to_depot / Depot Transfer behavior (migration 037 is intact)
--   - Normal Chemical / Consumable / Disposable consumption behavior
--   - quantity_in_use increments for normal consumption
--   - Asset Lifecycle transitions (fn_transition_asset_bucket, fn_edit_asset_log, etc.)
--   - Stock Received trigger (fn_update_stock_on_receive) — untouched
--   - Billing / spend calculations — IST was already excluded; still excluded
--   - Historical data — zero rows modified
--   - Migrations 001–037 — not touched
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. CONSUMPTION TRIGGER
--    Skip quantity_in_use increment for both Depot Transfer Out (037) and
--    Inter-Station Transfer Out (038).  Everything else is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_check_and_update_stock_on_consumption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_available numeric(10,3);
BEGIN
  -- Lock the row to prevent concurrent race conditions.
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
      'Insufficient store room stock. Available: %, Requested: %',
      v_available, NEW.quantity_used;
  END IF;

  -- Deduct store room stock.
  -- quantity_in_use is left UNCHANGED for:
  --   • 'Depot Transfer Out%'          — fixed by migration 037
  --   • 'Inter-Station Transfer Out%'  — fixed by this migration 038
  -- For all genuine consumption (Chemical, Consumable, Disposable) it increments.
  UPDATE station_inventory
     SET current_stock   = current_stock - NEW.quantity_used,
         quantity_in_use = CASE
             WHEN NEW.remarks LIKE 'Depot Transfer Out%'         THEN COALESCE(quantity_in_use, 0)
             WHEN NEW.remarks LIKE 'Inter-Station Transfer Out%' THEN COALESCE(quantity_in_use, 0)
             ELSE                                                     COALESCE(quantity_in_use, 0) + NEW.quantity_used
         END,
         last_updated = now()
   WHERE station_id = NEW.station_id
     AND item_id    = NEW.item_id;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 2. DELETE CONSUMPTION
--    Reverses source stock and, for IST, also reverses the paired destination
--    stock_received record atomically.
--    quantity_in_use is never touched for IST or Depot Transfer deletes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_delete_consumption(p_log_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_log        record;
    v_to_code    text;
    v_to_id      uuid;
    v_paired_log record;
BEGIN
    SELECT * INTO v_log FROM consumption_logs WHERE id = p_log_id FOR UPDATE;
    IF v_log IS NULL THEN RAISE EXCEPTION 'Log not found'; END IF;

    -- Refund source current_stock.
    -- quantity_in_use is unchanged for Depot Transfer and IST — mirrors insert-time logic.
    -- For normal consumption, quantity_in_use decrements to match the refund.
    UPDATE station_inventory SET
        current_stock   = current_stock + v_log.quantity_used,
        quantity_in_use = CASE
            WHEN v_log.remarks LIKE 'Depot Transfer Out%'         THEN COALESCE(quantity_in_use, 0)
            WHEN v_log.remarks LIKE 'Inter-Station Transfer Out%' THEN COALESCE(quantity_in_use, 0)
            ELSE                                                       COALESCE(quantity_in_use, 0) - v_log.quantity_used
        END
    WHERE station_id = v_log.station_id AND item_id = v_log.item_id;

    -- Inter-Station Transfer cascade: also reverse the destination stock_received.
    IF v_log.remarks LIKE 'Inter-Station Transfer Out to %' THEN

        -- Extract the destination station code from the remark.
        -- Remark format: 'Inter-Station Transfer Out to XXXX'
        --                 123456789012345678901234567890^^^^
        --                                               pos 31 onwards
        v_to_code := TRIM(substring(v_log.remarks FROM 31));
        SELECT id INTO v_to_id FROM stations WHERE code = v_to_code;

        IF v_to_id IS NULL THEN
            RAISE EXCEPTION
              'Cannot reverse Inter-Station Transfer: destination station code "%" not found in stations table.',
              v_to_code;
        END IF;

        -- Primary match: current IST schema stores source_station_id on the destination record.
        SELECT * INTO v_paired_log
          FROM stock_received
         WHERE station_id        = v_to_id
           AND item_id           = v_log.item_id
           AND quantity          = v_log.quantity_used
           AND received_date     = v_log.consumption_date
           AND source_station_id = v_log.station_id
         LIMIT 1;

        -- Legacy fallback: older records used supplier = 'Station Transfer from [CODE]'.
        IF v_paired_log IS NULL THEN
            SELECT * INTO v_paired_log
              FROM stock_received
             WHERE station_id    = v_to_id
               AND item_id       = v_log.item_id
               AND quantity      = v_log.quantity_used
               AND received_date = v_log.consumption_date
               AND supplier LIKE 'Station Transfer from %'
             LIMIT 1;
        END IF;

        IF v_paired_log IS NOT NULL THEN
            -- Reverse destination current_stock only. quantity_in_use never touched.
            UPDATE station_inventory
               SET current_stock = current_stock - v_paired_log.quantity
             WHERE station_id = v_to_id AND item_id = v_log.item_id;

            DELETE FROM stock_received WHERE id = v_paired_log.id;
        END IF;
        -- If no paired record found (orphaned source log), still delete source log
        -- and restore source stock. Destination is assumed already corrected.

    END IF;

    DELETE FROM consumption_logs WHERE id = p_log_id;
END;
$$;


-- ---------------------------------------------------------------------------
-- 3. EDIT CONSUMPTION — three fully separated code paths.
--
--    PATH A: DEPOT TRANSFER
--      Preserve 'Depot Transfer Out' remark prefix (from 037, unchanged).
--      Adjust source current_stock by diff. quantity_in_use unchanged.
--      No destination record exists for Depot Transfers.
--
--    PATH B: INTER-STATION TRANSFER  ← key revision in 038
--      Find the paired destination stock_received record.
--      Fail loudly if not found (atomicity: never leave source/dest inconsistent).
--      Validate destination has enough stock when reducing transfer quantity.
--      Adjust source current_stock by -diff.
--      Adjust destination current_stock by +diff.
--      Sync destination stock_received.quantity AND received_date.
--      Sync source consumption_logs.quantity_used AND consumption_date.
--      Preserve the IST remark exactly — never overwrite it.
--      quantity_in_use unchanged on both sides.
--
--    PATH C: NORMAL CONSUMPTION (Chemical / Consumable / Disposable)
--      Adjust source current_stock by -diff.
--      quantity_in_use += diff  (existing behavior, unchanged).
--      Update log.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_edit_consumption(
    p_log_id       uuid,
    p_new_quantity numeric,
    p_new_date     date,
    p_remarks      text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_log        record;
    v_diff       numeric;
    v_to_code    text;
    v_to_id      uuid;
    v_paired_log record;
    v_dest_stock numeric;
BEGIN
    SELECT * INTO v_log FROM consumption_logs WHERE id = p_log_id FOR UPDATE;

    v_diff := p_new_quantity - v_log.quantity_used;

    -- =========================================================================
    -- PATH A — DEPOT TRANSFER
    -- =========================================================================
    IF v_log.remarks LIKE 'Depot Transfer Out%' THEN

        -- Preserve 'Depot Transfer Out' prefix on any edited remark (from 037).
        IF p_remarks IS NULL OR p_remarks = '' THEN
            p_remarks := 'Depot Transfer Out';
        ELSIF p_remarks NOT LIKE 'Depot Transfer Out%' THEN
            p_remarks := 'Depot Transfer Out - ' || p_remarks;
        END IF;

        -- Adjust source stock only. quantity_in_use unchanged.
        UPDATE station_inventory SET
            current_stock   = current_stock - v_diff,
            quantity_in_use = COALESCE(quantity_in_use, 0)
        WHERE station_id = v_log.station_id AND item_id = v_log.item_id;

        UPDATE consumption_logs
           SET quantity_used    = p_new_quantity,
               consumption_date = p_new_date,
               remarks          = p_remarks
         WHERE id = p_log_id;

        RETURN;
    END IF;

    -- =========================================================================
    -- PATH B — INTER-STATION TRANSFER
    -- =========================================================================
    IF v_log.remarks LIKE 'Inter-Station Transfer Out to %' THEN

        -- Extract destination station code.
        -- Remark format: 'Inter-Station Transfer Out to XXXX'
        --                 123456789012345678901234567890^^^^
        --                                               pos 31 onwards
        v_to_code := TRIM(substring(v_log.remarks FROM 31));
        SELECT id INTO v_to_id FROM stations WHERE code = v_to_code;

        IF v_to_id IS NULL THEN
            RAISE EXCEPTION
              'Cannot edit Inter-Station Transfer: destination station code "%" not found.',
              v_to_code;
        END IF;

        -- Find paired destination stock_received.
        -- Primary: source_station_id (current fn_inter_station_transfer schema).
        SELECT * INTO v_paired_log
          FROM stock_received
         WHERE station_id        = v_to_id
           AND item_id           = v_log.item_id
           AND source_station_id = v_log.station_id
           AND received_date     = v_log.consumption_date
           AND quantity          = v_log.quantity_used
         LIMIT 1;

        -- Legacy fallback: supplier = 'Station Transfer from [CODE]'.
        IF v_paired_log IS NULL THEN
            SELECT * INTO v_paired_log
              FROM stock_received
             WHERE station_id    = v_to_id
               AND item_id       = v_log.item_id
               AND quantity      = v_log.quantity_used
               AND received_date = v_log.consumption_date
               AND supplier LIKE 'Station Transfer from %'
             LIMIT 1;
        END IF;

        -- Atomicity guarantee: refuse to edit if destination record is missing.
        IF v_paired_log IS NULL THEN
            RAISE EXCEPTION
              'Cannot edit Inter-Station Transfer: no matching destination stock_received record found '
              '(destination: %, item: %, qty: %, date: %). '
              'Records may be inconsistent — contact ALS.',
              v_to_code, v_log.item_id, v_log.quantity_used, v_log.consumption_date;
        END IF;

        -- When reducing transfer quantity (diff < 0), destination loses stock.
        -- Validate destination has enough current_stock to absorb the reduction.
        IF v_diff < 0 THEN
            SELECT current_stock INTO v_dest_stock
              FROM station_inventory
             WHERE station_id = v_to_id AND item_id = v_log.item_id
             FOR UPDATE;

            IF COALESCE(v_dest_stock, 0) + v_diff < 0 THEN
                RAISE EXCEPTION
                  'Cannot reduce Inter-Station Transfer: destination station "%" has insufficient stock. '
                  'Available: %, Reduction requested: %.',
                  v_to_code,
                  COALESCE(v_dest_stock, 0),
                  ABS(v_diff);
            END IF;
        END IF;

        -- Adjust source: current_stock -diff; quantity_in_use unchanged.
        UPDATE station_inventory SET
            current_stock   = current_stock - v_diff,
            quantity_in_use = COALESCE(quantity_in_use, 0)
        WHERE station_id = v_log.station_id AND item_id = v_log.item_id;

        -- Adjust destination: current_stock +diff; quantity_in_use unchanged.
        UPDATE station_inventory SET
            current_stock   = current_stock + v_diff,
            quantity_in_use = COALESCE(quantity_in_use, 0)
        WHERE station_id = v_to_id AND item_id = v_log.item_id;

        -- Sync destination stock_received: update quantity AND date together.
        UPDATE stock_received
           SET quantity      = p_new_quantity,
               received_date = p_new_date
         WHERE id = v_paired_log.id;

        -- Sync source consumption_log: update quantity AND date.
        -- Remark preserved exactly — IST remark must never be overwritten.
        UPDATE consumption_logs
           SET quantity_used    = p_new_quantity,
               consumption_date = p_new_date,
               remarks          = v_log.remarks
         WHERE id = p_log_id;

        RETURN;
    END IF;

    -- =========================================================================
    -- PATH C — NORMAL CONSUMPTION (Chemical / Consumable / Disposable)
    -- =========================================================================
    UPDATE station_inventory SET
        current_stock   = current_stock - v_diff,
        quantity_in_use = COALESCE(quantity_in_use, 0) + v_diff
    WHERE station_id = v_log.station_id AND item_id = v_log.item_id;

    UPDATE consumption_logs
       SET quantity_used    = p_new_quantity,
           consumption_date = p_new_date,
           remarks          = p_remarks
     WHERE id = p_log_id;

END;
$$;
