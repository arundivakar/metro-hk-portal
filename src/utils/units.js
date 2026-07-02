/**
 * Unit conversion utilities for Metro HK Portal
 *
 * Storage standard: all quantities in BASE units (ml, g, Nos)
 * Display standard: converted to user-friendly units (Ltr, Kg, Nos)
 *
 * The unit field in inventory_items / rate_master may be either:
 *   - Base unit:    'ml', 'g', 'Nos'   (what's stored in DB after schema migration)
 *   - Display unit: 'Ltr', 'Kg', 'Nos' (what billing/pricing uses)
 *
 * Both are handled here transparently.
 *
 * Conversion rules:
 *   'ml'  or 'Ltr' items: stored as ml  → display as Ltr  (÷ 1000)
 *   'g'   or 'Kg'  items: stored as g   → display as Kg   (÷ 1000)
 *   'Nos' items:           stored as Nos → display as Nos  (no change)
 */

/**
 * Map a stored/DB unit to its display unit label.
 * @param {string} unit - DB unit ('ml' | 'g' | 'Nos' | 'Ltr' | 'Kg')
 * @returns {string}    - Display unit ('Ltr' | 'Kg' | 'Nos')
 */
export function getDisplayUnit(unit) {
  if (!unit) return 'Nos';
  const u = unit.toLowerCase();
  if (u === 'ml' || u === 'ltr' || u === 'l') return 'Ltr';
  if (u === 'g' || u === 'kg') return 'Kg';
  return 'Nos';
}

/**
 * Convert raw base-unit quantity to billing quantity.
 * Safely handles count items (Nos) that are billed per Kg based on nosPerKg.
 */
export function toBillingQty(rawQty, dbUnit, nosPerKg) {
  if (nosPerKg && nosPerKg > 0) return rawQty / nosPerKg; // Nos → Kg
  return toDisplayValue(rawQty, dbUnit);
}

/**
 * Returns true if this unit requires a ÷1000 conversion for display.
 * @param {string} unit
 */
function needsConversion(unit) {
  return unit === 'ml' || unit === 'mL' || unit === 'g' ||
         unit === 'Ltr' || unit === 'L'  || unit === 'Kg' || unit === 'kg';
}

/**
 * Convert a stored base-unit value to the display unit value.
 * @param {number} value  - quantity in base unit (ml / g / Nos)
 * @param {string} unit   - DB unit from inventory_items
 * @returns {number}
 */
export function toDisplayValue(value, unit) {
  const v = Number(value) || 0;
  return needsConversion(unit) ? v / 1000 : v;
}

/**
 * Convert a user-entered display-unit value back to base unit for storage.
 * @param {number} value  - quantity in display unit (Ltr / Kg / Nos)
 * @param {string} unit   - DB unit
 * @returns {number}
 */
export function toBaseValue(value, unit) {
  const v = Number(value) || 0;
  return needsConversion(unit) ? v * 1000 : v;
}

/**
 * Format a base-unit quantity for display with its correct display unit label.
 * @param {number} value  - quantity in base unit (ml / g / Nos)
 * @param {string} unit   - DB unit from inventory_items
 * @returns {string}  e.g. "2.50 Ltr", "1.00 Kg", "4 Nos"
 */
export function formatStock(value, unit) {
  const displayUnit = getDisplayUnit(unit);
  const displayVal  = toDisplayValue(value, unit);
  return displayUnit === 'Nos'
    ? `${Math.round(displayVal)} Nos`
    : `${displayVal.toFixed(2)} ${displayUnit}`;
}

/**
 * Default minimum stock levels in BASE units (what is stored in DB).
 * Works regardless of whether DB unit is 'g'/'ml' or 'Kg'/'Ltr'.
 *  Ltr / ml items  → 5 Ltr = 5000 ml
 *  Kg  / g  items  → 1 Kg  = 1000 g
 *  Nos items       → 2
 */
export const MIN_STOCK_BASE = { Ltr: 5000, ml: 5000, Kg: 1000, g: 1000, Nos: 2 };

/**
 * Convert a display unit label to its DB storage unit.
 * Used when saving edit form values back to the database.
 * @param {string} displayUnit - 'Ltr' | 'Kg' | 'Nos'
 * @returns {string} - 'ml' | 'g' | 'Nos'
 */
export function toDBUnit(displayUnit) {
  if (displayUnit === 'Ltr' || displayUnit === 'L') return 'ml';
  if (displayUnit === 'Kg' || displayUnit === 'kg') return 'g';
  return 'Nos';
}
