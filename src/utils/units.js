/**
 * Unit conversion utilities for Metro HK Portal
 *
 * Storage standard: all quantities in BASE units (ml, g, Nos)
 * Display standard: converted to user-friendly units (Ltr, Kg, Nos)
 *
 * Conversion rules:
 *   'Ltr' items: stored as ml  → display as Ltr  (÷ 1000)
 *   'Kg'  items: stored as g   → display as Kg   (÷ 1000)
 *   'Nos' items: stored as Nos → display as Nos  (no change)
 */

/**
 * Convert a stored base-unit value to the display unit value.
 * @param {number} value  - quantity in base unit (ml / g / Nos)
 * @param {string} unit   - display unit from inventory_items ('Ltr' | 'Kg' | 'Nos')
 * @returns {number}
 */
export function toDisplayValue(value, unit) {
  const v = Number(value) || 0;
  if (unit === 'Ltr' || unit === 'L') return v / 1000;
  if (unit === 'Kg' || unit === 'kg') return v / 1000;
  return v;
}

/**
 * Convert a display-unit value back to base unit for storage.
 * @param {number} value  - quantity in display unit (Ltr / Kg / Nos)
 * @param {string} unit   - display unit ('Ltr' | 'Kg' | 'Nos')
 * @returns {number}
 */
export function toBaseValue(value, unit) {
  const v = Number(value) || 0;
  if (unit === 'Ltr' || unit === 'L') return v * 1000;
  if (unit === 'Kg' || unit === 'kg') return v * 1000;
  return v;
}

/**
 * Format a base-unit quantity for display with its unit label.
 * @param {number} value  - quantity in base unit (ml / g / Nos)
 * @param {string} unit   - display unit from inventory_items
 * @param {number} [decimals=2] - decimal places (use 0 for Nos)
 * @returns {string}  e.g. "2.50 Ltr", "1.00 Kg", "4 Nos"
 */
export function formatStock(value, unit, decimals) {
  const displayVal = toDisplayValue(value, unit);
  const dp = decimals !== undefined ? decimals : (unit === 'Nos' ? 0 : 2);
  return `${displayVal.toFixed(dp)} ${unit}`;
}

/**
 * Get the base unit label for storage (what the CSV / manual entry uses).
 * @param {string} unit - display unit
 * @returns {string}
 */
export function baseUnit(unit) {
  if (unit === 'Ltr' || unit === 'L') return 'ml';
  if (unit === 'Kg' || unit === 'kg') return 'g';
  return 'Nos';
}

/**
 * Default minimum stock levels in DISPLAY units, keyed by display unit.
 * Ltr → 5 Ltr (= 5000 ml stored)
 * Kg  → 1 Kg  (= 1000 g stored)
 * Nos → 2
 */
export const MIN_STOCK_DISPLAY = { Ltr: 5, Kg: 1, Nos: 2 };

/**
 * Default minimum stock levels in BASE units (what is stored in DB).
 */
export const MIN_STOCK_BASE = { Ltr: 5000, Kg: 1000, Nos: 2 };
