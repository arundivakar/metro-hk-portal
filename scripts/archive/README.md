# scripts/archive — Historical Maintenance Scripts

> ⚠️ **DO NOT EXECUTE ANY SCRIPT IN THIS FOLDER.**

---

## What These Scripts Are

These are one-time data repair and maintenance scripts that were created during the initial setup and early production phase of the Metro HK Portal (June–July 2026).

Each script was written to address a specific historical data issue that has since been resolved. They are preserved here **for audit and reference purposes only**.

---

## Why They Must Never Be Re-Run

Several of these scripts directly modify `station_inventory.current_stock` by:
1. Reading the raw stock value from the database
2. Doing arithmetic in JavaScript (outside of any database trigger or RPC)
3. Writing the modified value back directly

This bypasses the portal's trigger-based business logic, which means:
- The `current_stock` value diverges from what the transaction logs (receipts + consumptions) would compute
- Because Opening Stock is calculated dynamically as `Closing Stock − Receipts + Consumptions`, any incorrect `current_stock` silently produces a wrong Opening Stock on the portal
- **Two reported Opening Stock discrepancies (PLASTIC GARBAGE COVER JUMBO and SOAP POWDER) were both caused by repair scripts in this category**

---

## Script Index

| Script | Category | What it was for |
|---|---|---|
| `reconcile_transfers.js` | ❌ Dangerous | Repaired missing consumption logs for historical inter-station transfers. Caused double deductions. |
| `restore_stock.js` | ❌ Dangerous | Attempted to reverse stock deductions caused by `reconcile_transfers.js`. Caused SOAP POWDER corruption. |
| `fix_reconcile.js` | ❌ Dangerous | Second attempt to fix what `reconcile_transfers.js` broke. Race condition risk. |
| `sync_inventory.js` | ❌ Dangerous | Tried to reconcile `current_stock` using `receipts − consumptions`. Ignored Opening Stock initialization, would corrupt all CSV-imported items. |
| `fix_transfer.js` | ❌ Dangerous | One-time fix for a misrouted Power Pad transfer at KLMT. Already applied. |
| `fix_transfer_broad.js` | ❌ Dangerous | Broader version of `fix_transfer.js`. Already applied. |
| `fix_vyta.js` | ❌ Dangerous | Deleted an orphaned Inter-Station Transfer log at VYTA and restored stock. Already applied. |
| `cleanup_stock_received.cjs` | 🟡 Indirect risk | Deleted legacy `Opening Stock Init` rows from `stock_received`. Already applied. |
| `fix_remarks.js` | 🟡 Indirect risk | Normalized `Inter-station Transfer` remark text to correct casing. Already applied. |
| `apply_fn_fix.cjs` | 🟡 Indirect risk | Deployed an older version of `fn_delete_stock_received` via RPC. Superseded by migration `021`. |
| `fix_delete_func.js` | ✅ Inert | Contains DDL for `fn_delete_stock_received` as a string. Never executes it. |
| `fix_sql.js` | ✅ Inert | Contains DDL for `fn_delete_stock_received` as a string. Never executes it. |
| `fix_live.cjs` | ✅ Safe | Deleted duplicate `inventory_items` rows. No stock impact. Already applied. |
| `update_items.js` | ✅ Safe | Updated `inventory_items.category` for gloves and power pads. Already applied. |
| `scratch_fix.js` | ✅ Safe | Updated `rate_master.unit` for garbage covers. Already applied. |
| `wipe.cjs` | ⚠️ Destructive | Calls `fn_wipe_database`. Nukes all data. Never use in production. |

---

## How to Handle Future Stock Corrections

| Scenario | Correct Approach |
|---|---|
| Fixing incorrect `current_stock` for one item | Use the **ALS Admin → Manual Stock Adjustment** (calls `fn_adjust_single_stock` RPC) |
| Fixing a structural data issue affecting multiple stations | Create a **new numbered migration** in `supabase/migrations/` and apply via the Supabase SQL Editor |
| Fixing an incorrect transaction log entry | Use the **Edit/Delete log** functionality in the portal UI (calls `fn_edit_consumption`, `fn_delete_consumption`, etc.) |
| Emergency bulk correction | Write a **dry-run script first**, verify output, then request explicit approval before running the live version |

---

*Archived: 2026-07-27*
