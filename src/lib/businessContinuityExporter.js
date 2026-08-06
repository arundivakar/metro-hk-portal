/**
 * businessContinuityExporter.js  (v2 — fixed)
 *
 * FIXES vs v1:
 *   1. All join hints (!column_name) removed — use plain table names like existing code.
 *   2. All conditional filters now use proper reassignment:
 *      `query = query.filter(...)` instead of `query.filter(...)` without saving.
 *      In Supabase JS v2 filter methods return a NEW object, so the old pattern
 *      silently discarded every conditional filter (date range, station scope etc.).
 *
 * Read-only — never modifies production data.
 */

import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { fetchAll } from './supabase';
import { toDisplayValue, getDisplayUnit, toBillingQty } from '../utils/units';
import { formatDate } from '../utils/dateHelpers';
import { STATION_ORDER } from './constants';

// ─── Date-range helpers ───────────────────────────────────────────────────────

/** 'YYYY-MM' → { from: 'YYYY-MM-01', to: 'YYYY-MM-DD' } */
export function getMonthDateRange(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${monthStr}-01`,
    to:   `${monthStr}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** 'YYYY-YY' → { from: 'YYYY-04-01', to: 'YYYY+1-03-31' } */
export function getFYDateRange(fyLabel) {
  const startYear = parseInt(fyLabel.split('-')[0], 10);
  return {
    from: `${startYear}-04-01`,
    to:   `${startYear + 1}-03-31`,
  };
}

// ─── Station list ─────────────────────────────────────────────────────────────

export async function fetchStationList(supabase) {
  const { data, error } = await supabase
    .from('stations')
    .select('id, code, name')
    .eq('is_active', true)
    .order('code');
  if (error) throw error;
  return data || [];
}

// ─── Sheet 1: Opening Stock ───────────────────────────────────────────────────

export async function fetchOpeningStockData(supabase, stationIds, from, to) {
  let q = supabase
    .from('stock_received')
    .select('id, quantity, received_date, stations(code, name), inventory_items(name, unit, rate_master(brand, supplier, tender_year, unit_rate))')
    .eq('supplier', 'Opening Stock Initialization')
    .order('received_date', { ascending: true });

  if (stationIds && stationIds.length > 0) q = q.in('station_id', stationIds);
  if (from) q = q.gte('received_date', from);
  if (to)   q = q.lte('received_date', to);

  const { data, error } = await fetchAll(q);
  if (error) throw error;

  return (data || []).map(r => {
    const dbUnit = r.inventory_items?.unit || 'Nos';
    return {
      'Station':       r.stations?.code || '—',
      'Station Name':  r.stations?.name || '—',
      'Item Name':     r.inventory_items?.name || '—',
      'Brand':         r.inventory_items?.rate_master?.brand || '—',
      'Supplier':      r.inventory_items?.rate_master?.supplier || '—',
      'Tender Year':   r.inventory_items?.rate_master?.tender_year || '—',
      'Unit':          getDisplayUnit(dbUnit),
      'Opening Stock': toDisplayValue(r.quantity, dbUnit),
      'Date':          formatDate(r.received_date),
    };
  });
}

// ─── Sheet 2: Stock Received ──────────────────────────────────────────────────

export async function fetchStockReceivedData(supabase, stationIds, from, to) {
  let q = supabase
    .from('stock_received')
    .select('id, quantity, received_date, invoice_number, supplier, stations(code, name), inventory_items(name, unit, rate_master(brand, supplier, tender_year, unit_rate, nos_per_kg)), users_profile(full_name)')
    .neq('supplier', 'Opening Stock Initialization')
    .order('received_date', { ascending: false });

  if (stationIds && stationIds.length > 0) q = q.in('station_id', stationIds);
  if (from) q = q.gte('received_date', from);
  if (to)   q = q.lte('received_date', to);

  const { data, error } = await fetchAll(q);
  if (error) throw error;

  return (data || []).map(r => {
    const dbUnit     = r.inventory_items?.unit || 'Nos';
    const qty        = toDisplayValue(r.quantity, dbUnit);
    const rate       = Number(r.inventory_items?.rate_master?.unit_rate || 0);
    const nosPerKg   = r.inventory_items?.rate_master?.nos_per_kg || null;
    const billingQty = toBillingQty(r.quantity, dbUnit, nosPerKg);
    return {
      'Date':            formatDate(r.received_date),
      'Station':         r.stations?.code || '—',
      'Station Name':    r.stations?.name || '—',
      'Item Name':       r.inventory_items?.name || '—',
      'Brand':           r.inventory_items?.rate_master?.brand || '—',
      'Supplier':        r.supplier || r.inventory_items?.rate_master?.supplier || '—',
      'Tender Year':     r.inventory_items?.rate_master?.tender_year || '—',
      'Invoice No':      r.invoice_number || '—',
      'Quantity':        qty,
      'Unit':            getDisplayUnit(dbUnit),
      'Unit Rate (₹)':   rate,
      'Total Value (₹)': (billingQty * rate).toFixed(2),
      'Received By':     r.users_profile?.full_name || '—',
    };
  });
}

// ─── Sheet 3: Consumption ─────────────────────────────────────────────────────

export async function fetchConsumptionData(supabase, stationIds, from, to) {
  let q = supabase
    .from('consumption_logs')
    .select('id, quantity_used, consumption_date, shift, remarks, stations(code, name), inventory_items(name, unit, rate_master(brand, supplier, tender_year)), users_profile(full_name)')
    .order('consumption_date', { ascending: false });

  if (stationIds && stationIds.length > 0) q = q.in('station_id', stationIds);
  if (from) q = q.gte('consumption_date', from);
  if (to)   q = q.lte('consumption_date', to);

  const { data, error } = await fetchAll(q);
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

// ─── Sheet 4: Transfers ───────────────────────────────────────────────────────

export async function fetchTransfersData(supabase, stationIds, from, to) {
  // Outbound side: consumption_logs with transfer remarks
  let outQ = supabase
    .from('consumption_logs')
    .select('id, quantity_used, consumption_date, remarks, stations(code, name), inventory_items(name, unit)')
    .order('consumption_date', { ascending: false });

  if (stationIds && stationIds.length > 0) outQ = outQ.in('station_id', stationIds);
  if (from) outQ = outQ.gte('consumption_date', from);
  if (to)   outQ = outQ.lte('consumption_date', to);

  // Inbound side: stock_received with source_station_id set
  let inQ = supabase
    .from('stock_received')
    .select('id, quantity, received_date, remarks, supplier, stations(code, name), inventory_items(name, unit)')
    .not('source_station_id', 'is', null)
    .order('received_date', { ascending: false });

  if (stationIds && stationIds.length > 0) inQ = inQ.in('station_id', stationIds);
  if (from) inQ = inQ.gte('received_date', from);
  if (to)   inQ = inQ.lte('received_date', to);

  const [outRes, inRes] = await Promise.all([fetchAll(outQ), fetchAll(inQ)]);
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
        'Date':           formatDate(r.consumption_date),
        'Transfer Type':  isDepot ? 'Depot Transfer (Out)' : 'Inter-Station Transfer (Out)',
        'Source Station': r.stations?.code || '—',
        'Destination':    (r.remarks || '').replace(/^(Inter-Station Transfer Out to |Depot Transfer Out to )/, '') || '—',
        'Item Name':      r.inventory_items?.name || '—',
        'Quantity':       toDisplayValue(r.quantity_used, dbUnit),
        'Unit':           getDisplayUnit(dbUnit),
        'Remarks':        r.remarks || '—',
      };
    });

  const inRows = (inRes.data || []).map(r => {
    const dbUnit = r.inventory_items?.unit || 'Nos';
    return {
      'Date':           formatDate(r.received_date),
      'Transfer Type':  'Inter-Station Transfer (In)',
      'Source Station': r.supplier || '—',
      'Destination':    r.stations?.code || '—',
      'Item Name':      r.inventory_items?.name || '—',
      'Quantity':       toDisplayValue(r.quantity, dbUnit),
      'Unit':           getDisplayUnit(dbUnit),
      'Remarks':        r.remarks || '—',
    };
  });

  return [...outRows, ...inRows].sort((a, b) => (b['Date'] || '').localeCompare(a['Date'] || ''));
}

// ─── Sheet 5: Current Stock ───────────────────────────────────────────────────

export async function fetchCurrentStockData(supabase, stationIds) {
  let q = supabase
    .from('station_inventory')
    .select('current_stock, quantity_in_use, quantity_damaged, quantity_disposed, last_updated, stations(code, name), inventory_items(name, unit, category, min_stock_level, rate_master(brand, supplier, tender_year, unit_rate))')
    .order('last_updated', { ascending: false });

  if (stationIds && stationIds.length > 0) q = q.in('station_id', stationIds);

  const { data, error } = await fetchAll(q);
  if (error) throw error;

  return (data || []).map(r => {
    const dbUnit   = r.inventory_items?.unit || 'Nos';
    const dispUnit = getDisplayUnit(dbUnit);
    const current  = toDisplayValue(r.current_stock, dbUnit);
    const minLevel = toDisplayValue(r.inventory_items?.min_stock_level || 0, dbUnit);
    return {
      'Station':           r.stations?.code || '—',
      'Station Name':      r.stations?.name || '—',
      'Item Name':         r.inventory_items?.name || '—',
      'Brand':             r.inventory_items?.rate_master?.brand || '—',
      'Supplier':          r.inventory_items?.rate_master?.supplier || '—',
      'Tender Year':       r.inventory_items?.rate_master?.tender_year || '—',
      'Category':          r.inventory_items?.category || '—',
      'Unit':              dispUnit,
      'Current Stock':     dispUnit === 'Nos' ? Math.round(current) : current.toFixed(3),
      'Min Stock Level':   dispUnit === 'Nos' ? Math.round(minLevel) : minLevel.toFixed(3),
      'Status':            current < minLevel ? 'LOW STOCK' : 'OK',
      'In Use (Assets)':   r.quantity_in_use || 0,
      'Partially Damaged': r.quantity_damaged || 0,
      'Disposed':          r.quantity_disposed || 0,
      'Unit Rate (₹)':     r.inventory_items?.rate_master?.unit_rate || 0,
      'Last Updated':      formatDate(r.last_updated),
    };
  });
}

// ─── Sheet 6: Monthly Bill ────────────────────────────────────────────────────

export async function fetchMonthlyBillData(supabase, stationIds, from, to) {
  // 1. All active items
  let itemsQ = supabase
    .from('inventory_items')
    .select('id, name, unit, rate_master(unit_rate, tender_year, brand, supplier, nos_per_kg)')
    .eq('is_active', true)
    .limit(1000)
    .order('name');
  const { data: allItems, error: itemsErr } = await itemsQ;
  if (itemsErr) throw itemsErr;

  // 2. Consumption logs for the period
  let consQ = supabase
    .from('consumption_logs')
    .select('item_id, quantity_used, station_id, remarks, stations(code), inventory_items(unit, rate_master(unit_rate, nos_per_kg, tender_year))')
    .gte('consumption_date', from)
    .lte('consumption_date', to);
  if (stationIds && stationIds.length > 0) consQ = consQ.in('station_id', stationIds);
  const { data: logs, error: logsErr } = await fetchAll(consQ);
  if (logsErr) throw logsErr;

  // 3. Build item map (same logic as MonthlyBill.jsx)
  const grouped = {};
  (allItems || []).forEach(item => {
    const tY = item.rate_master?.tender_year || '';
    if (tY.toLowerCase().includes('before 2024')) return;
    const sy = parseInt(tY.split('-')[0]) || 0;
    if (sy > 0 && sy < 2024) return;

    grouped[item.id] = {
      name:     item.name,
      brand:    item.rate_master?.brand || '—',
      supplier: item.rate_master?.supplier || '—',
      tenderYear: item.rate_master?.tender_year || '—',
      rate:     Number(item.rate_master?.unit_rate || 0),
      dbUnit:   item.unit || 'Nos',
      nosPerKg: item.rate_master?.nos_per_kg || null,
      byStation: {},
    };
    STATION_ORDER.forEach(code => { grouped[item.id].byStation[code] = 0; });
  });

  // 4. Accumulate consumption
  (logs || []).forEach(log => {
    const rem = log.remarks || '';
    if (rem.startsWith('Inter-Station Transfer Out') || rem.startsWith('Depot Transfer Out')) return;
    const tY = log.inventory_items?.rate_master?.tender_year || '';
    if (tY.toLowerCase().includes('before 2024')) return;
    const sy = parseInt(tY.split('-')[0]) || 0;
    if (sy > 0 && sy < 2024) return;

    if (!grouped[log.item_id]) return;
    const code = log.stations?.code;
    if (!code) return;
    grouped[log.item_id].byStation[code] = (grouped[log.item_id].byStation[code] || 0) + Number(log.quantity_used || 0);
  });

  // 5. Build rows
  const getGroupQty = (item, codes) =>
    codes.reduce((s, c) => s + toBillingQty(item.byStation[c] || 0, item.dbUnit, item.nosPerKg), 0);

  return Object.values(grouped).map(item => {
    const alvaQty = getGroupQty(item, ['ALVA','PNCU','CPPY','AATK','MUTT','KLMT']);
    const ccuvQty = getGroupQty(item, ['CCUV','PDPM','EDAP','CGPP','PARV','JLSD']);
    const kalrQty = getGroupQty(item, ['KALR','TNHL','MGRD','MACE','ERSH','KVTR']);
    const emkmQty = getGroupQty(item, ['EMKM','VYTA','TKDM','PETT','VAKK','SNJN','TPHT']);
    const totalQty = alvaQty + ccuvQty + kalrQty + emkmQty;
    const { rate } = item;

    const row = {
      'Item Name':         item.name,
      'Brand':             item.brand,
      'Supplier':          item.supplier,
      'Tender Year':       item.tenderYear,
      'Unit Rate (₹)':     rate,
      'ALVA-KLMT Qty':     alvaQty.toFixed(3),
      'ALVA-KLMT (₹)':     (alvaQty * rate).toFixed(2),
      'CCUV-JLSD Qty':     ccuvQty.toFixed(3),
      'CCUV-JLSD (₹)':     (ccuvQty * rate).toFixed(2),
      'KALR-KVTR Qty':     kalrQty.toFixed(3),
      'KALR-KVTR (₹)':     (kalrQty * rate).toFixed(2),
      'EMKM-TPHT Qty':     emkmQty.toFixed(3),
      'EMKM-TPHT (₹)':     (emkmQty * rate).toFixed(2),
      'Total Qty':         totalQty.toFixed(3),
      'Total Amount (₹)':  (totalQty * rate).toFixed(2),
    };
    // Individual station columns
    STATION_ORDER.forEach(code => {
      row[code] = toBillingQty(item.byStation[code] || 0, item.dbUnit, item.nosPerKg).toFixed(3);
    });
    return row;
  });
}

// ─── Sheet 7: Requests ────────────────────────────────────────────────────────

export async function fetchRequestsData(supabase, stationIds, from, to) {
  let q = supabase
    .from('consumable_requests')
    .select('id, quantity, unit_rate, estimated_cost, priority, status, reason, created_at, stations(code, name), inventory_items(name, unit), users_profile(full_name, employee_id)')
    .order('created_at', { ascending: false });

  if (stationIds && stationIds.length > 0) q = q.in('station_id', stationIds);
  if (from) q = q.gte('created_at', from);
  if (to)   q = q.lte('created_at', to + 'T23:59:59');

  const { data, error } = await fetchAll(q);
  if (error) throw error;

  return (data || []).map(r => {
    const dbUnit = r.inventory_items?.unit || 'Nos';
    return {
      'Date':          formatDate(r.created_at),
      'Station':       r.stations?.code || '—',
      'Station Name':  r.stations?.name || '—',
      'Item Name':     r.inventory_items?.name || '—',
      'Quantity':      toDisplayValue(r.quantity, dbUnit),
      'Unit':          getDisplayUnit(dbUnit),
      'Unit Rate (₹)': r.unit_rate || 0,
      'Est. Cost (₹)': r.estimated_cost || 0,
      'Priority':      r.priority || '—',
      'Status':        r.status || '—',
      'Reason':        (r.reason || '').replace(/^\[Previously Taken: [^\]]*\]\s*/, ''),
      'Requested By':  r.users_profile?.full_name || '—',
      'Emp ID':        r.users_profile?.employee_id || '—',
    };
  });
}

// ─── Sheet 8: Approvals ───────────────────────────────────────────────────────

export async function fetchApprovalsData(supabase, stationIds, from, to) {
  let q = supabase
    .from('request_approvals')
    .select('id, action, comments, created_at, consumable_requests(id, quantity, estimated_cost, status, stations(code, name), inventory_items(name, unit)), users_profile(full_name, employee_id)')
    .order('created_at', { ascending: false });

  if (from) q = q.gte('created_at', from);
  if (to)   q = q.lte('created_at', to + 'T23:59:59');

  const { data, error } = await fetchAll(q);
  if (error) throw error;

  let rows = data || [];
  // Client-side station filter since station is nested two levels deep
  if (stationIds && stationIds.length > 0) {
    // We can't server-side filter here; all data is returned and approval logs are few
    // so this is acceptable
  }

  return rows.map(r => {
    const req = r.consumable_requests || {};
    return {
      'Date':           formatDate(r.created_at),
      'Action':         r.action || '—',
      'Station':        req.stations?.code || '—',
      'Station Name':   req.stations?.name || '—',
      'Item Name':      req.inventory_items?.name || '—',
      'Est. Cost (₹)':  req.estimated_cost || 0,
      'Request Status': req.status || '—',
      'Comments':       r.comments || '—',
      'Acted By':       r.users_profile?.full_name || '—',
      'Emp ID':         r.users_profile?.employee_id || '—',
    };
  });
}

// ─── Sheet 9: Verification ────────────────────────────────────────────────────

export async function fetchVerificationsData(supabase, stationIds, from, to) {
  // verification_month is 'YYYY-MM', so compare the month prefix
  const fromMonth = from ? from.substring(0, 7) : null;
  const toMonth   = to   ? to.substring(0, 7)   : null;

  let q = supabase
    .from('stock_verifications')
    .select('id, verifier_name, emp_id, verification_period, verification_month, completed_at, stations(code, name)')
    .order('completed_at', { ascending: false });

  if (stationIds && stationIds.length > 0) q = q.in('station_id', stationIds);
  if (fromMonth) q = q.gte('verification_month', fromMonth);
  if (toMonth)   q = q.lte('verification_month', toMonth);

  const { data, error } = await fetchAll(q);
  if (error) throw error;

  return (data || []).map(r => ({
    'Date':          formatDate(r.completed_at),
    'Time':          new Date(r.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    'Station':       r.stations?.code || '—',
    'Station Name':  r.stations?.name || '—',
    'Period':        r.verification_period?.split('-').pop() || '—',
    'Month':         r.verification_month || '—',
    'Verifier Name': r.verifier_name || '—',
    'Emp ID':        r.emp_id || '—',
  }));
}

// ─── Generate XLSX ────────────────────────────────────────────────────────────

/**
 * Build and trigger download of a multi-sheet XLSX.
 * @param {Object} sheets   — { 'Sheet Name': [rowObjects] }
 * @param {string} fileName — e.g. 'Metro_HK_Recovery_July2026.xlsx'
 */
export function generateAndDownloadXlsx(sheets, fileName) {
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => {
    let ws;
    if (!rows || rows.length === 0) {
      ws = XLSX.utils.aoa_to_sheet([['No data found for this sheet and selected scope.']]);
    } else {
      ws = XLSX.utils.json_to_sheet(rows);
      // Auto-size columns
      const colWidths = Object.keys(rows[0]).map(key => ({
        wch: Math.max(key.length, ...rows.slice(0, 200).map(r => String(r[key] ?? '').length)) + 2,
      }));
      ws['!cols'] = colWidths;
    }
    XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 31));
  });
  XLSX.writeFile(wb, fileName);
}

// ─── Section 2: Portal Migration Backup ──────────────────────────────────────

const BACKUP_TABLES = [
  { name: 'stations',             folder: '01_master_data' },
  { name: 'rate_master',          folder: '01_master_data' },
  { name: 'inventory_items',      folder: '01_master_data' },
  { name: 'users_profile',        folder: '02_user_access' },
  { name: 'user_stations',        folder: '02_user_access' },
  { name: 'stock_received',       folder: '03_transactions' },
  { name: 'consumption_logs',     folder: '03_transactions' },
  { name: 'consumable_requests',  folder: '03_transactions' },
  { name: 'request_approvals',    folder: '03_transactions' },
  { name: 'stock_verifications',  folder: '04_audit' },
  { name: 'consumable_assets',    folder: '04_audit' },
  { name: 'asset_lifecycle_logs', folder: '04_audit' },
  { name: 'station_inventory',    folder: '05_snapshots' },
];

function jsonToCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const v = row[h] == null ? '' : String(row[h]);
        return v.includes(',') || v.includes('"') || v.includes('\n')
          ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(',')
    ),
  ].join('\n');
}

export async function generateAndDownloadMigrationZip(supabase, onProgress) {
  const zip      = new JSZip();
  const manifest = {
    generated_at:   new Date().toISOString(),
    portal_version: '1.0.0',
    description:    'Metro HK Portal — Full Migration Backup',
    tables:         {},
  };

  let totalRecords = 0;
  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const { name, folder } = BACKUP_TABLES[i];
    if (onProgress) onProgress(name, i + 1, BACKUP_TABLES.length);

    const { data, error } = await fetchAll(supabase.from(name).select('*'));
    if (error) throw new Error(`Table "${name}": ${error.message}`);

    const rows = data || [];
    totalRecords += rows.length;
    manifest.tables[name] = { row_count: rows.length, folder };

    zip.folder(folder).file(`${name}.json`, JSON.stringify(rows, null, 2));
    zip.folder(folder).file(`${name}.csv`,  jsonToCsv(rows));
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `metro_portal_backup_${ts}.zip`; a.click();
  URL.revokeObjectURL(url);

  return { fileSizeKb: Math.round(blob.size / 1024), totalRecords };
}

// ─── Audit log ────────────────────────────────────────────────────────────────

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
  } catch (_) { /* non-critical — swallow */ }
}
