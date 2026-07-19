# Quantity Conversion Implementation Plan

## Problem Analysis
Currently, the portal stores liquid quantities as `ml` and solid weights as `g` in the database, which is correct. 
However, there are three major inconsistencies in the app:
1. **Financial Calculations**: Math operations (like estimated cost, billing totals) are directly multiplying the stored raw value (e.g., 500ml) by the `unit_rate`. Since the unit rate is per Litre/Kg, multiplying 500 * rate charges them for 500 Litres instead of 0.5 Litres!
2. **Display Issues**: Forms and data tables directly print `r.quantity` and `r.inventory_items?.unit`, showing users things like "500 ml" or "2000 g" instead of "0.5 Ltr" or "2 Kg".
3. **Missing Input Conversions**: Since the UI does not explicitly guide the user to input display units (Ltr/Kg), users have been typing base units (ml/g). If we transition the UI to explicitly show and ask for Display Units (e.g., "Quantity (Ltr)"), we must silently convert their input using `toBaseValue(qty, unit)` before saving it to Supabase.

## Proposed Changes by File

### 1. `src/pages/Dashboard.jsx`
- **Cost Calculation Fix**: Wrap all `quantity_used` and `current_stock` fields in `toDisplayValue(..., unit)` before multiplying by `unit_rate` for cost/expenditure metrics.
- **Totals Fix**: Use `toDisplayValue` when calculating `receivedTotal` and `consumedTotal` KPIs so they don't say 50000 instead of 50.
- **Table Displays**: Ensure all columns use `toDisplayValue()` and `getDisplayUnit()`.

### 2. `src/pages/Requests.jsx`
- **Estimated Cost**: Fix `estimatedCost` to multiply `toDisplayValue(form.quantity, selectedItem.unit) * unitRate`.
- **Submission**: Use `toBaseValue(form.quantity, selectedItem.unit)` when inserting into `consumable_requests`.
- **Labels**: Update the form label to read `Quantity ({getDisplayUnit(selectedItem.unit)})` so users know to type "0.5" instead of "500".
- **Data Table**: Use `formatStock` or manual conversion for the Qty column.

### 3. `src/pages/StockMovement.jsx` (Consumption)
- **Totals Calculation**: Wrap `quantity_used` in `toDisplayValue` before summing total consumption.
- **Submission**: Convert user input using `toBaseValue()` before hitting the Supabase RPC `fn_log_consumption`.
- **Edit Modal**: When opening the Edit dialog, initialize the input with `toDisplayValue(log.quantity_used)`. When submitting the edit, convert it back using `toBaseValue()`.
- **Labels**: Add dynamic display units to the form labels.
- **Validation**: Ensure `toBaseValue(form.quantity_used)` is strictly `<= current_stock`.

### 4. `src/pages/StockReceived.jsx`
- **Totals Calculation**: Wrap `quantity` in `toDisplayValue` before summing.
- **Submission**: Use `toBaseValue()` before calling `fn_add_stock`.
- **Edit Modal**: Same bidirectional conversion as StockMovement.
- **Total Value (Cost)**: Fix `Total Value: ₹(toDisplayValue(form.quantity) * unitRate)`.

### 5. `src/pages/Approvals.jsx`
- **Expenditure Calculation**: Fix `cost = toDisplayValue(r.quantity) * rate` for both requests and consumption logs.
- **Data Table & Modal**: Format Qty strings with `getDisplayUnit` and `toDisplayValue`.

### 6. `src/pages/Reports.jsx` & `src/pages/MonthlyBill.jsx`
- Ensure all aggregations and table exports use `toDisplayValue()` and `getDisplayUnit()`. `MonthlyBill.jsx` currently uses `toBillingQty` which does the same math but we should ensure the UI displays the correct converted numbers everywhere.

### 7. `src/pages/Inventory.jsx`
- The `Inventory.jsx` currently maps `current_stock_display`, which is good, but any cost-related exports or validations should be verified.
- **Validation**: Ensure `min_stock_level` in edits is bidirectionally converted (`toBaseValue` on save, `toDisplayValue` on open).

## Review & Next Steps
Please review this plan. If approved, I will implement these targeted changes using the existing `toDisplayValue`, `toBaseValue`, and `getDisplayUnit` helpers from `src/utils/units.js` without altering your database schema or existing data.
