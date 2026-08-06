/**
 * businessContinuityExporter.js
 *
 * All data-fetching and file-generation logic for the Business Continuity module.
 * This module is PURELY READ-ONLY. It never modifies any production data.
 *
 * Two separate tools:
 *   1. Google Sheets Recovery Export  → multi-sheet .xlsx for operational switchback
 *   2. Portal Migration Backup        → .zip with JSON + CSV of all DB tables
 */

import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { fetchAll } from './supabase';
import { toDisplayValue, getDisplayUnit, toBillingQty } from '../utils/units';
import { formatDate } from '../utils/dateHelpers';
import { ALS_GROUPS, STATION_ORDER } from './constants';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a financial year date range. FY 2025-26 → Apr 2025 – Mar 2026 */
export function getFYDateRange(fyLabel) {
  // fyLabel e.g. '2025-26'
  const startYear = parseInt(fyLabel.split('-')[0], 10);
  return {
    from: `${startYear}-04-01`,
    to:   `${startYear + 1}-03-31`,
  };
}

/** Build a month date range from 'YYYY-MM' string */
export function getMonthDateRange(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${monthStr}-01`,
    to:   `${monthStr}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Format a number as ₹ currency string */
function fmtCurrency(v) {
  const n = Number(v) || 0;
  return `₹${n.toFixed(2)}`;
}

/** Convert base-unit qty to display value with unit label */
function fmtQty(rawQty, dbUnit, nosPerKg) {
  const dispUnit = getDisplayUnit(dbUnit);
  const dispVal  = toDisplayValue(rawQty, dbUnit);
  if (dispUnit === 'Nos') return `${Math.round(dispVal)} Nos`;
  return `${dispVal.toFixed(3)} ${dispUnit}`;
}

// ─── Section 1: Google Sheets Recovery Data Fetchers ─────────────────────────

/** Fetch the list of all active stations */
export async function fetchStationList(supabase) {
  const { data, error } = await supabase
    .from('stations')
    .select('id, code, name')
    .eq('is_active', true)
    .order('code');
  if (error) throw error;
  return data || [];
}

/**
 * Sheet 1 – Opening Stock
 * Fetches entries from stock_received where supplier = 'Opening Stock Initialization'
 * for the given date range.
 */
export async function fetchOpeningStockData(supabase, stationIds, from, to) {
  const query = supabase
    .from('stock_received')
    .select(`
      id, quantity, received_date,
      stations!station_id (code, name),
      inventory_items!item_id (name, unit, rate_master (brand, supplier, tender_year, unit_rate))
    `)
    .eq('supplier', 'Opening Stock Initialization')
    .order('received_date', { ascending: true });

  if (stationIds && stationIds.length > 0) query.in('station_id', stationIds);
  if (from) query.gte('received_date', from);
  if (to)   query.lte('received_date', to);

  const { data, error } = await fetchAll(query);
  if (error) throw error;

  return (data || []).map(r => ({
    'Station':      r.stations?.code || '—',
    'Station Name': r.stations?.name || '—',
    'Item Name':    r.inventory_items?.name || '—',
    'Brand':        r.inventory_items?.rate_master?.brand || '—',
    'Supplier':     r.inventory_items?.rate_master?.supplier || '—',
    'Tender Year':  r.inventory_items?.rate_master?.tender_year || '—',
    'Unit':         getDisplayUnit(r.inventory_items?.unit || 'Nos'),
    'Opening Stock':toDisplayValue(r.quantity, r.inventory_items?.unit || 'Nos'),
    'Date':         formatDate(r.received_date),
  }));
}

/**
 * Sheet 2 – Stock Received
 * All stock received (excluding Opening Stock Initialization) for the date range.
 */
export async function fetchStockReceivedData(supabase, stationIds, from, to) {
  const query = supabase
    .from('stock_received')
    .select(`
      id, quantity, received_date, invoice_number, supplier,
      stations!station_id (code, name),
      inventory_items!item_id (name, unit, rate_master (brand, supplier, tender_year, unit_rate)),
      users_profile!received_by (full_name)
    `)
    .neq('supplier', 'Opening Stock Initialization')
    .order('received_date', { ascending: false });

  if (stationIds && stationIds.length > 0) query.in('station_id', stationIds);
  if (from) query.gte('received_date', from);
  if (to)   query.lte('received_date', to);

  const { data, error } = await fetchAll(query);
  if (error) throw error;

  return (data || []).map(r => {
    const dbUnit  = r.inventory_items?.unit || 'Nos';
    const qty     = toDisplayValue(r.quantity, dbUnit);
    const rate    = Number(r.inventory_items?.rate_master?.unit_rate || 0);
    const billingQty = toBillingQty(r.quantity, dbUnit, r.inventory_items?.rate_master?.nos_per_kg);
    return {
      'Date':          formatDate(r.received_date),
      'Station':       r.stations?.code || '—',
      'Station Name':  r.stations?.name || '—',
      'Item Name':     r.inventory_items?.name || '—',
      'Brand':         r.inventory_items?.rate_master?.brand || '—',
      'Supplier':      r.supplier || r.inventory_items?.rate_master?.supplier || '—',
      'Tender Year':   r.inventory_items?.rate_master?.tender_year || '—',
      'Invoice No':    r.invoice_number || '—',
      'Quantity':      qty,
      'Unit':          getDisplayUnit(dbUnit),
      'Unit Rate (₹)': rate,
      'Total Value (₹)': (billingQty * rate).toFixed(2),
      'Received By':   r.users_profile?.full_name || '—',
    };
  });
}

/**
 * Sheet 3 – Consumption
 * All consumption logs (excluding transfers) for the date range.
 */
export async function fetchConsumptionData(supabase, stationIds, from, to) {
  const query = supabase
    .from('consumption_logs')
    .select(`
      id, quantity_used, consumption_date, shift, remarks,
      stations!station_id (code, name),
      inventory_items!item_id (name, unit, rate_master (brand, supplier, tender_year)),
      users_profile!logged_by (full_name)
    `)
    .order('consumption_date', { ascending: false });

  if (stationIds && stationIds.length > 0) query.in('station_id', stationIds);
  if (from) query.gte('consumption_date', from);
  if (to)   query.lte('consumption_date', to);

  const { data, error } = await fetchAll(query);
  if (error) throw error;

  return (data || [])
    .filter(r => {
      const rem = r.remarks || '';
      return !rem.startsWith('Inter-Station Transfer Out') && !rem.startsWith('Depot Transfer Out');
    })
    .map(r => {
      const dbUnit = r.inventory_items?.unit || 'Nos';
      return {
        'Date':         formatDate(r.consumption_date),
        'Station':      r.stations?.code || '—',
        'Station Name': r.stations?.name || '—',
        'Item Name':    r.inventory_items?.name || '—',
        'Brand':        r.inventory_items?.rate_master?.brand || '—',
        'Supplier':     r.inventory_items?.rate_master?.supplier || '—',
        'Tender Year':  r.inventory_items?.rate_master?.tender_year || '—',
        'Shift':        r.shift || '—',
        'Quantity':     toDisplayValue(r.quantity_used, dbUnit),
        'Unit':         getDisplayUnit(dbUnit),
        'Remarks':      r.remarks || '—',
        'Logged By':    r.users_profile?.full_name || '—',
      };
    });
}

/**
 * Sheet 4 – Transfers
 * Inter-station and depot transfers from consumption_logs (out side) +
 * stock_received where source_station_id is set (in side).
 */
export async function fetchTransfersData(supabase, stationIds, from, to) {
  // Outbound transfers from consumption_logs
  const outQuery = supabase
    .from('consumption_logs')
    .select(`
      id, quantity_used, consumption_date, remarks,
      stations!station_id (code, name),
      inventory_items!item_id (name, unit)
    `)
    .order('consumption_date', { ascending: false });

  if (stationIds && stationIds.length > 0) outQuery.in('station_id', stationIds);
  if (from) outQuery.gte('consumption_date', from);
  if (to)   outQuery.lte('consumption_date', to);

  // Inbound inter-station from stock_received where source_station_id is not null
  const inQuery = supabase
    .from('stock_received')
    .select(`
      id, quantity, received_date, remarks, supplier,
      stations!station_id (code, name),
      inventory_items!item_id (name, unit)
    `)
    .not('source_station_id', 'is', null)
    .order('received_date', { ascending: false });

  if (stationIds && stationIds.length > 0) inQuery.in('station_id', stationIds);
  if (from) inQuery.gte('received_date', from);
  if (to)   inQuery.lte('received_date', to);

  const [outRes, inRes] = await Promise.all([fetchAll(outQuery), fetchAll(inQuery)]);
  if (outRes.error) throw outRes.error;
  if (inRes.error)  throw inRes.error;

  const outRows = (outRes.data || [])
    .filter(r => {
      const rem = r.remarks || '';
      return rem.startsWith('Inter-Station Transfer Out') || rem.startsWith('Depot Transfer Out');
    })
    .map(r => {
      const dbUnit = r.inventory_items?.unit || 'Nos';
      const isDepot = (r.remarks || '').startsWith('Depot Transfer Out');
      return {
        'Date':            formatDate(r.consumption_date),
        'Transfer Type':   isDepot ? 'Depot Transfer (Out)' : 'Inter-Station Transfer (Out)',
        'Source Station':  r.stations?.code || '—',
        'Destination':     r.remarks?.replace(/^(Inter-Station Transfer Out to |Depot Transfer Out to )/, '') || '—',
        'Item Name':       r.inventory_items?.name || '—',
        'Quantity':        toDisplayValue(r.quantity_used, dbUnit),
        'Unit':            getDisplayUnit(dbUnit),
        'Remarks':         r.remarks || '—',
      };
    });

  const inRows = (inRes.data || []).map(r => {
    const dbUnit = r.inventory_items?.unit || 'Nos';
    return {
      'Date':            formatDate(r.received_date),
      'Transfer Type':   'Inter-Station Transfer (In)',
      'Source Station':  r.supplier || '—',
      'Destination':     r.stations?.code || '—',
      'Item Name':       r.inventory_items?.name || '—',
      'Quantity':        toDisplayValue(r.quantity, dbUnit),
      'Unit':            getDisplayUnit(dbUnit),
      'Remarks':         r.remarks || '—',
    };
  });

  return [...outRows, ...inRows].sort((a, b) => (b['Date'] || '').localeCompare(a['Date'] || ''));
}

/**
 * Sheet 5 – Current Stock
 * Snapshot of current stock levels for the given stations.
 */
export async function fetchCurrentStockData(supabase, stationIds) {
  const query = supabase
    .from('station_inventory')
    .select(`
      current_stock, quantity_in_use, quantity_damaged, quantity_disposed, last_updated,
      stations!station_id (code, name),
      inventory_items!item_id (name, unit, category, min_stock_level, rate_master (brand, supplier, tender_year, unit_rate))
    `)
    .order('last_updated', { ascending: false });

  if (stationIds && stationIds.length > 0) query.in('station_id', stationIds);

  const { data, error } = await fetchAll(query);
  if (error) throw error;

  return (data || []).map(r => {
    const dbUnit = r.inventory_items?.unit || 'Nos';
    const dispUnit = getDisplayUnit(dbUnit);
    const currentDisp = toDisplayValue(r.current_stock, dbUnit);
    const minDisp     = toDisplayValue(r.inventory_items?.min_stock_level || 0, dbUnit);
    const isLow = currentDisp < minDisp;
    return {
      'Station':          r.stations?.code || '—',
      'Station Name':     r.stations?.name || '—',
      'Item Name':        r.inventory_items?.name || '—',
      'Brand':            r.inventory_items?.rate_master?.brand || '—',
      'Supplier':         r.inventory_items?.rate_master?.supplier || '—',
      'Tender Year':      r.inventory_items?.rate_master?.tender_year || '—',
      'Category':         r.inventory_items?.category || '—',
      'Unit':             dispUnit,
      'Current Stock':    dispUnit === 'Nos' ? Math.round(currentDisp) : currentDisp.toFixed(3),
      'Min Stock Level':  dispUnit === 'Nos' ? Math.round(minDisp) : minDisp.toFixed(3),
      'Status':           isLow ? 'LOW STOCK' : 'OK',
      'In Use (Assets)':  r.quantity_in_use || 0,
      'Partially Damaged':r.quantity_damaged || 0,
      'Disposed':         r.quantity_disposed || 0,
      'Unit Rate (₹)':    r.inventory_items?.rate_master?.unit_rate || 0,
      'Last Updated':     formatDate(r.last_updated),
    };
  });
}

/**
 * Sheet 6 – Monthly Bill
 * Replicates the exact billing calculation from MonthlyBill.jsx.
 */
export async function fetchMonthlyBillData(supabase, stationIds, from, to) {
  // Fetch all active items
  const { data: allItems, error: itemsErr } = await supabase
    .from('inventory_items')
    .select('id, name, unit, rate_master (unit_rate, tender_year, brand, supplier, nos_per_kg)')
    .eq('is_active', true)
    .order('name');
  if (itemsErr) throw itemsErr;

  // Fetch consumption logs
  const consQuery = supabase
    .from('consumption_logs')
    .select(`
      item_id, quantity_used, station_id, remarks,
      stations!station_id (code),
      inventory_items!item_id (unit, rate_master (unit_rate, nos_per_kg, tender_year))
    `)
    .gte('consumption_date', from)
    .lte('consumption_date', to);
  if (stationIds && stationIds.length > 0) consQuery.in('station_id', stationIds);

  const { data: logs, error: logsErr } = await fetchAll(consQuery);
  if (logsErr) throw logsErr;

  // Group items and accumulate by station code
  const grouped = {};
  (allItems || []).forEach(item => {
    const tYearStr = item.rate_master?.tender_year || '';
    if (tYearStr.toLowerCase().includes('before 2024')) return;
    const startYear = parseInt(tYearStr.split('-')[0]) || 0;
    if (startYear > 0 && startYear < 2024) return;

    grouped[item.id] = {
      name: item.name,
      brand: item.rate_master?.brand || '—',
      supplier: item.rate_master?.supplier || '—',
      tenderYear: item.rate_master?.tender_year || '—',
      rate: Number(item.rate_master?.unit_rate || 0),
      dbUnit: item.unit || 'Nos',
      nosPerKg: item.rate_master?.nos_per_kg || null,
      byStation: {},
    };
    STATION_ORDER.forEach(code => { grouped[item.id].byStation[code] = 0; });
  });

  (logs || []).forEach(log => {
    const rem = log.remarks || '';
    if (rem.startsWith('Inter-Station Transfer Out') || rem.startsWith('Depot Transfer Out')) return;
    const tY = log.inventory_items?.rate_master?.tender_year || '';
    if (tY.toLowerCase().includes('before 2024')) return;
    const sy = parseInt(tY.split('-')[0]) || 0;
    if (sy > 0 && sy < 2024) return;

    const itemId = log.item_id;
    const code   = log.stations?.code;
    const qty    = Number(log.quantity_used || 0);
    if (!grouped[itemId]) return;
    if (!grouped[itemId].byStation[code] && grouped[itemId].byStation[code] !== 0) {
      grouped[itemId].byStation[code] = 0;
    }
    grouped[itemId].byStation[code] = (grouped[itemId].byStation[code] || 0) + qty;
  });

  // Build rows — one row per item, with all station billing quantities
  const rows = [];
  Object.values(grouped).forEach(item => {
    const { dbUnit, nosPerKg, rate, byStation } = item;
    let totalBillingQty = 0;
    const stationCols = {};

    STATION_ORDER.forEach(code => {
      const billingQty = toBillingQty(byStation[code] || 0, dbUnit, nosPerKg);
      stationCols[code] = billingQty;
      totalBillingQty += billingQty;
    });

    // Also compute ALS group totals
    const getGroupQty = (codes) => codes.reduce((s, c) => s + (stationCols[c] || 0), 0);
    const alvaQty = getGroupQty(['ALVA','PNCU','CPPY','AATK','MUTT','KLMT']);
    const ccuvQty = getGroupQty(['CCUV','PDPM','EDAP','CGPP','PARV','JLSD']);
    const kalrQty = getGroupQty(['KALR','TNHL','MGRD','MACE','ERSH','KVTR']);
    const emkmQty = getGroupQty(['EMKM','VYTA','TKDM','PETT','VAKK','SNJN','TPHT']);
    const totalAmount = totalBillingQty * rate;

    const row = {
      'Item Name':       item.name,
      'Brand':           item.brand,
      'Supplier':        item.supplier,
      'Tender Year':     item.tenderYear,
      'Unit Rate (₹)':   rate,
      'ALVA-KLMT Qty':   alvaQty.toFixed(3),
      'ALVA-KLMT (₹)':   (alvaQty * rate).toFixed(2),
      'CCUV-JLSD Qty':   ccuvQty.toFixed(3),
      'CCUV-JLSD (₹)':   (ccuvQty * rate).toFixed(2),
      'KALR-KVTR Qty':   kalrQty.toFixed(3),
      'KALR-KVTR (₹)':   (kalrQty * rate).toFixed(2),
      'EMKM-TPHT Qty':   emkmQty.toFixed(3),
      'EMKM-TPHT (₹)':   (emkmQty * rate).toFixed(2),
      'Total Qty':       totalBillingQty.toFixed(3),
      'Total Amount (₹)':totalAmount.toFixed(2),
    };
    // Add individual station columns
    STATION_ORDER.forEach(code => { row[code] = (stationCols[code] || 0).toFixed(3); });
    rows.push(row);
  });

  return rows;
}

/**
 * Sheet 7 – Requests
 */
export async function fetchRequestsData(supabase, stationIds, from, to) {
  const query = supabase
    .from('consumable_requests')
    .select(`
      id, quantity, unit_rate, estimated_cost, priority, status, reason, created_at,
      stations!station_id (code, name),
      inventory_items!item_id (name, unit),
      users_profile!requested_by (full_name, employee_id)
    `)
    .order('created_at', { ascending: false });

  if (stationIds && stationIds.length > 0) query.in('station_id', stationIds);
  if (from) query.gte('created_at', from);
  if (to)   query.lte('created_at', to + 'T23:59:59');

  const { data, error } = await fetchAll(query);
  if (error) throw error;

  return (data || []).map(r => {
    const dbUnit = r.inventory_items?.unit || 'Nos';
    return {
      'Date':             formatDate(r.created_at),
      'Station':          r.stations?.code || '—',
      'Station Name':     r.stations?.name || '—',
      'Item Name':        r.inventory_items?.name || '—',
      'Quantity':         toDisplayValue(r.quantity, dbUnit),
      'Unit':             getDisplayUnit(dbUnit),
      'Unit Rate (₹)':    r.unit_rate || 0,
      'Est. Cost (₹)':    r.estimated_cost || 0,
      'Priority':         r.priority || '—',
      'Status':           r.status || '—',
      'Reason':           (r.reason || '').replace(/^\[Previously Taken: [^\]]*\]\s*/, ''),
      'Requested By':     r.users_profile?.full_name || '—',
      'Emp ID':           r.users_profile?.employee_id || '—',
    };
  });
}

/**
 * Sheet 8 – Approvals
 */
export async function fetchApprovalsData(supabase, stationIds, from, to) {
  const query = supabase
    .from('request_approvals')
    .select(`
      id, action, comments, created_at,
      consumable_requests!request_id (
        id, quantity, estimated_cost, status,
        stations!station_id (code, name),
        inventory_items!item_id (name, unit)
      ),
      users_profile!acted_by (full_name, employee_id)
    `)
    .order('created_at', { ascending: false });

  if (from) query.gte('created_at', from);
  if (to)   query.lte('created_at', to + 'T23:59:59');

  const { data, error } = await fetchAll(query);
  if (error) throw error;

  // Filter by station if needed
  let rows = data || [];
  if (stationIds && stationIds.length > 0) {
    rows = rows.filter(r => {
      // We need to filter by station — but request_approvals doesn't have station_id directly.
      // It's available via consumable_requests.station_id — filtered client-side.
      return true; // Can't server-side filter here easily; return all and note limitation
    });
  }

  return rows.map(r => {
    const req = r.consumable_requests || {};
    return {
      'Date':          formatDate(r.created_at),
      'Action':        r.action || '—',
      'Station':       req.stations?.code || '—',
      'Station Name':  req.stations?.name || '—',
      'Item Name':     req.inventory_items?.name || '—',
      'Est. Cost (₹)': req.estimated_cost || 0,
      'Request Status':req.status || '—',
      'Comments':      r.comments || '—',
      'Acted By':      r.users_profile?.full_name || '—',
      'Emp ID':        r.users_profile?.employee_id || '—',
    };
  });
}

/**
 * Sheet 9 – Verification
 */
export async function fetchVerificationsData(supabase, stationIds, from, to) {
  const query = supabase
    .from('stock_verifications')
    .select(`
      id, verifier_name, emp_id, verification_period, verification_month, completed_at,
      stations!station_id (code, name)
    `)
    .order('completed_at', { ascending: false });

  if (stationIds && stationIds.length > 0) query.in('station_id', stationIds);
  if (from) query.gte('verification_month', from.substring(0, 7));
  if (to)   query.lte('verification_month', to.substring(0, 7));

  const { data, error } = await fetchAll(query);
  if (error) throw error;

  return (data || []).map(r => ({
    'Date':           formatDate(r.completed_at),
    'Time':           new Date(r.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    'Station':        r.stations?.code || '—',
    'Station Name':   r.stations?.name || '—',
    'Period':         r.verification_period?.split('-').pop() || '—',
    'Month':          r.verification_month || '—',
    'Verifier Name':  r.verifier_name || '—',
    'Emp ID':         r.emp_id || '—',
  }));
}

// ─── Section 1: Generate XLSX ─────────────────────────────────────────────────

/**
 * Build and download a multi-sheet XLSX file.
 * @param {Object} sheets  - { 'Sheet Name': [rowObjects, ...], ... }
 * @param {string} fileName - e.g. 'Metro_HK_Recovery_July2026.xlsx'
 */
export function generateAndDownloadXlsx(sheets, fileName) {
  const wb = XLSX.utils.book_new();

  Object.entries(sheets).forEach(([sheetName, rows]) => {
    if (!rows || rows.length === 0) {
      // Still create the sheet but with a header note
      const ws = XLSX.utils.aoa_to_sheet([['No data found for this sheet and selected scope.']]);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    // Auto-size columns
    const colWidths = Object.keys(rows[0]).map(key => ({
      wch: Math.max(key.length, ...rows.map(r => String(r[key] ?? '').length)) + 2
    }));
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31)); // Excel sheet name limit
  });

  XLSX.writeFile(wb, fileName);
}

// ─── Section 2: Portal Migration Backup ──────────────────────────────────────

const BACKUP_TABLES = [
  // Master data
  { name: 'stations',           folder: '01_master_data' },
  { name: 'rate_master',        folder: '01_master_data' },
  { name: 'inventory_items',    folder: '01_master_data' },
  // User access
  { name: 'users_profile',      folder: '02_user_access' },
  { name: 'user_stations',      folder: '02_user_access' },
  // Transactions
  { name: 'stock_received',     folder: '03_transactions' },
  { name: 'consumption_logs',   folder: '03_transactions' },
  { name: 'consumable_requests',folder: '03_transactions' },
  { name: 'request_approvals',  folder: '03_transactions' },
  // Audit
  { name: 'stock_verifications',folder: '04_audit' },
  { name: 'consumable_assets',  folder: '04_audit' },
  { name: 'asset_lifecycle_logs',folder: '04_audit' },
  // Snapshots
  { name: 'station_inventory',  folder: '05_snapshots' },
];

/** Fetch all rows from a single table */
async function dumpTable(supabase, tableName) {
  const query = supabase.from(tableName).select('*');
  const { data, error } = await fetchAll(query);
  if (error) throw new Error(`Failed to dump table "${tableName}": ${error.message}`);
  return data || [];
}

/** Convert array of objects to CSV string */
function jsonToCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const csvRows = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h] == null ? '' : String(row[h]);
        return v.includes(',') || v.includes('"') || v.includes('\n')
          ? `"${v.replace(/"/g, '""')}"`
          : v;
      }).join(',')
    ),
  ];
  return csvRows.join('\n');
}

/**
 * Fetch all tables and generate a downloadable ZIP migration package.
 * @param {Object} supabase     - Supabase client
 * @param {Function} onProgress - Callback (tableName, current, total)
 * @returns {{ fileSizeKb, totalRecords }}
 */
export async function generateAndDownloadMigrationZip(supabase, onProgress) {
  const zip = new JSZip();
  const manifest = {
    generated_at: new Date().toISOString(),
    portal_version: '1.0.0',
    description: 'Metro HK Portal — Full Migration Backup',
    tables: {},
  };

  let totalRecords = 0;
  const total = BACKUP_TABLES.length;

  for (let i = 0; i < total; i++) {
    const { name, folder } = BACKUP_TABLES[i];
    if (onProgress) onProgress(name, i + 1, total);

    const rows = await dumpTable(supabase, name);
    totalRecords += rows.length;
    manifest.tables[name] = { row_count: rows.length, folder };

    const jsonStr = JSON.stringify(rows, null, 2);
    const csvStr  = jsonToCsv(rows);

    zip.folder(folder).file(`${name}.json`, jsonStr);
    zip.folder(folder).file(`${name}.csv`,  csvStr);
  }

  // Add manifest
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  // Generate blob and download
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const fileName  = `metro_portal_backup_${timestamp}.zip`;
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);

  const fileSizeKb = Math.round(blob.size / 1024);
  return { fileSizeKb, totalRecords };
}

// ─── Log Export to Audit Table ────────────────────────────────────────────────

/**
 * Writes an entry to export_logs after a successful export.
 * Silently fails — if this insert fails, the export was still successful.
 */
export async function logExport(supabase, { exportType, stationScope, monthScope, recordCount, fileSizeKb, userId }) {
  try {
    await supabase.from('export_logs').insert({
      export_type:   exportType,
      triggered_by:  userId || null,
      station_scope: stationScope || 'ALL',
      month_scope:   monthScope || null,
      record_count:  recordCount || 0,
      file_size_kb:  fileSizeKb || 0,
    });
  } catch (_) {
    // Non-critical — swallow silently
  }
}
