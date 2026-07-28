import React, { useState, useEffect, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { ROLES, ALS_GROUPS, STATION_ORDER } from '../lib/constants';
import { useStationStore } from '../store/stationStore';
import Layout from '../components/layout/Layout';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import toast from 'react-hot-toast';
import { FileUp, DatabaseZap, ShieldAlert, FlaskConical, Eye, CheckCircle2, TriangleAlert, ArrowRight } from 'lucide-react';
import { formatStock, toDisplayValue, toBaseValue, getDisplayUnit } from '../utils/units';

export default function DataInitialization() {
  const { role } = useAuthStore();
  const { selectedStation } = useStationStore();
  const [stations, setStations] = useState([]);
  const isBusy = useRef(false);
  const stockBusy = useRef(false);
  
  // Master List State
  const [masterFile, setMasterFile] = useState(null);
  const [isWiping, setIsWiping] = useState(false);
  const [masterError, setMasterError] = useState('');

  // Station Stock State
  const [stockFile, setStockFile] = useState(null);
  const [selectedStationId, setSelectedStationId] = useState('');
  const [isUploadingStock, setIsUploadingStock] = useState(false);
  const [stockError, setStockError] = useState('');
  
  // Items list
  const [items, setItems] = useState([]);

  // ── July Opening Stock Correction state ───────────────────────────────────
  const [corrStationId, setCorrStationId] = useState('');
  const [corrItemId, setCorrItemId]       = useState('');
  const [corrNewQty, setCorrNewQty]       = useState('');
  const [corrReason, setCorrReason]       = useState('');
  const [corrCurrentOpening, setCorrCurrentOpening] = useState(null); // base units
  const [corrLoading, setCorrLoading]     = useState(false);
  const [corrError, setCorrError]         = useState('');
  const [corrPreview, setCorrPreview]     = useState(null);  // array of month objects
  const [previewLoading, setPreviewLoading] = useState(false);
  const [corrApplying, setCorrApplying]   = useState(false);

  // Fetch all txn data for selected station+item to compute July Opening Stock
  const fetchCorrectionData = useCallback(async (stationId, itemId) => {
    setCorrLoading(true);
    setCorrCurrentOpening(null);
    setCorrPreview(null);
    setCorrNewQty('');
    setCorrReason('');
    setCorrError('');
    try {
      const [{ data: inv }, { data: receipts }, { data: consumptions }] = await Promise.all([
        supabase.from('station_inventory').select('current_stock').eq('station_id', stationId).eq('item_id', itemId).maybeSingle(),
        supabase.from('stock_received').select('quantity, received_date, supplier').eq('station_id', stationId).eq('item_id', itemId),
        supabase.from('consumption_logs').select('quantity_used, consumption_date').eq('station_id', stationId).eq('item_id', itemId),
      ]);
      if (!inv) { setCorrError('No inventory record found for this item at the selected station.'); return; }
      // Compute July Opening Stock = visualOpeningStock for 2026-07
      const opening = computeJulyOpeningStock(inv.current_stock, receipts || [], consumptions || []);
      setCorrCurrentOpening(opening);
    } catch (err) {
      setCorrError(err.message || 'Failed to load stock data.');
    } finally {
      setCorrLoading(false);
    }
  }, []);

  useEffect(() => {
    if (corrStationId && corrItemId) fetchCorrectionData(corrStationId, corrItemId);
    else { setCorrCurrentOpening(null); setCorrPreview(null); setCorrNewQty(''); setCorrError(''); }
  }, [corrStationId, corrItemId, fetchCorrectionData]);

  // Build preview for all months from July 2026 to current month
  const handlePreview = async () => {
    if (!corrStationId || !corrItemId || corrNewQty === '' || !corrReason.trim()) {
      return setCorrError('Please fill Station, Item, Correct Opening Stock, and Reason before previewing.');
    }
    const selectedItem = items.find(i => i.id === corrItemId);
    if (!selectedItem) return;
    const dbUnit = selectedItem.unit || 'Nos';
    const newBaseQty = toBaseValue(Number(corrNewQty), dbUnit);
    if (isNaN(newBaseQty) || newBaseQty < 0) return setCorrError('Please enter a valid non-negative quantity.');

    setPreviewLoading(true);
    setCorrError('');
    setCorrPreview(null);
    try {
      const [{ data: inv }, { data: receipts }, { data: consumptions }] = await Promise.all([
        supabase.from('station_inventory').select('current_stock').eq('station_id', corrStationId).eq('item_id', corrItemId).maybeSingle(),
        supabase.from('stock_received').select('quantity, received_date, supplier').eq('station_id', corrStationId).eq('item_id', corrItemId),
        supabase.from('consumption_logs').select('quantity_used, consumption_date').eq('station_id', corrStationId).eq('item_id', corrItemId),
      ]);
      const delta = newBaseQty - corrCurrentOpening;
      const preview = buildMonthPreview(inv.current_stock, receipts || [], consumptions || [], delta, dbUnit);
      setCorrPreview(preview);
    } catch (err) {
      setCorrError(err.message || 'Failed to build preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApplyCorrection = async () => {
    if (!corrPreview) return;
    const selectedItem = items.find(i => i.id === corrItemId);
    if (!selectedItem) return;
    const dbUnit = selectedItem.unit || 'Nos';
    const newBaseQty = toBaseValue(Number(corrNewQty), dbUnit);
    setCorrApplying(true);
    setCorrError('');
    try {
      const { error } = await supabase.rpc('fn_correct_july_opening_stock', {
        p_station_id:        corrStationId,
        p_item_id:           corrItemId,
        p_old_opening_stock: corrCurrentOpening,
        p_new_opening_stock: newBaseQty,
        p_reason:            corrReason.trim(),
        p_applied_by:        profile?.id ?? null,
      });
      if (error) throw error;
      toast.success('July Opening Stock corrected successfully!');
      // Reset
      setCorrStationId('');
      setCorrItemId('');
      setCorrNewQty('');
      setCorrReason('');
      setCorrCurrentOpening(null);
      setCorrPreview(null);
    } catch (err) {
      setCorrError(err.message || 'Failed to apply correction.');
    } finally {
      setCorrApplying(false);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      const [stationRes, itemRes] = await Promise.all([
        supabase.from('stations').select('*').eq('is_active', true),
        supabase.from('inventory_items').select('id, name, unit, category, rate_master(brand, tender_year)').order('name')
      ]);

      if (stationRes.data) {
        const sorted = stationRes.data.sort((a, b) => {
          const indexA = STATION_ORDER.indexOf(a.code);
          const indexB = STATION_ORDER.indexOf(b.code);
          return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
        });
        setStations(sorted);
      }
      
      if (itemRes.data) {
        setItems(itemRes.data);
      }
    };
    fetchData();
  }, []);

  const handleMasterUpload = async () => {
    if (isBusy.current) return;
    if (!masterFile) return setMasterError('Please select a CSV file first.');
    if (!window.confirm('This will update master item information (rates, GST, supplier, category, unit etc.)\n\nStation stock quantities, transaction history, and all other data will be PRESERVED.\n\nOnly new items will be added. Existing items will have their pricing/details updated.\n\nContinue?')) return;

    isBusy.current = true;
    setMasterError('');
    setIsWiping(true);
    console.log('Starting Master List initialization...');

    const normalizeKeys = (row) => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        if (!key) continue;
        const lowerKey = key.toLowerCase().trim().replace(/\s+/g, ' ');
        if (lowerKey.includes('cleaning material') || lowerKey === 'item name' || lowerKey === 'name') {
          normalized['Cleaning Material'] = value;
        }
        else if (lowerKey.includes('chemical') || lowerKey === 'category') {
          const cat = (value || '').toLowerCase().trim();
          if (cat.includes('chemical')) normalized['Chemical/Consumable'] = 'Chemical';
          else if (cat.includes('disposable')) normalized['Chemical/Consumable'] = 'Disposable';
          else normalized['Chemical/Consumable'] = 'Consumable';
        }
        // Exact column names from the master CSV
        else if (lowerKey === 'final_rate' || lowerKey === 'final rate') {
          normalized['Rate including GST'] = value;
        }
        else if (lowerKey === 'base_rate' || lowerKey === 'base rate' || lowerKey === 'rate (ex-gst)' || lowerKey === 'basic rate') {
          normalized['Base Rate'] = value;
        }
        else if (lowerKey === 'gst_percentage' || lowerKey === 'gst%' || lowerKey === 'gst %' || lowerKey === 'gst percent' || lowerKey === 'gst') {
          normalized['GST %'] = value;
        }
        // Fallback: any 'rate' column → Rate including GST
        else if (lowerKey.includes('rate') && lowerKey.includes('gst')) normalized['Rate including GST'] = value;
        else if (lowerKey.includes('rate')) normalized['Rate including GST'] = value;
        else if (lowerKey.includes('brand'))    normalized['Brand'] = value;
        else if (lowerKey.includes('supplier')) normalized['Supplier'] = value;
        else if (lowerKey.includes('tender'))   normalized['Tender Year'] = value;
        else if (lowerKey === 'unit')           normalized['Unit'] = value;
        // Skip serial number columns
        else if (lowerKey === 'sl. no' || lowerKey === 'sl.no' || lowerKey === 'sl no' || lowerKey === 's.no') { /* skip */ }
        else normalized[key] = value;
      }
      return normalized;
    };

    Papa.parse(masterFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const payload = results.data.map(normalizeKeys);
          console.log('Parsed master payload count:', payload.length);
          
          // Validation: reject if this looks like the Station Stock CSV
          // Master CSV must have at least Brand or Supplier column
          if (payload.length > 0) {
            const firstRow = payload[0];
            if (!('Brand' in firstRow) && !('Supplier' in firstRow) && !('Rate including GST' in firstRow) && !('Base Rate' in firstRow)) {
              setIsWiping(false);
              isBusy.current = false;
              return setMasterError('Validation failed: This looks like the Station Stock CSV. Please upload the Master List CSV here.');
            }
          }

          // Safe UPSERT — no wipe, stock data preserved
          console.log('[MasterUpload] Safe upsert — sending', payload.length, 'rows...');
          const { error: importErr } = await supabase.rpc('fn_import_master_list', { p_payload: payload });
          if (importErr) throw importErr;

          // 3. Verify final count in DB
          const { count: finalCount } = await supabase.from('inventory_items').select('*', { count: 'exact', head: true });
          console.log('[MasterUpload] Step 5 — Final inventory_items count in DB:', finalCount);
          if (finalCount !== payload.length) {
            console.warn(`[MasterUpload] ⚠️ MISMATCH: CSV had ${payload.length} rows but DB now has ${finalCount} rows. This indicates a double-insert.`);
          } else {
            console.log(`[MasterUpload] ✅ MATCH: ${finalCount} rows in DB matches CSV.`);
          }

          toast.success(`Master list initialized! ${finalCount} items loaded.`);
          setMasterFile(null);
          // reset file input visually
          document.getElementById('masterFileInput').value = '';
        } catch (err) {
          console.error('Master initialization error:', err);
          setMasterError(err.message || 'Failed to initialize master list.');
        } finally {
          setIsWiping(false);
          isBusy.current = false;
        }
      },
      error: (error) => {
        console.error('CSV Parsing error:', error);
        setMasterError(error.message);
        setIsWiping(false);
        isBusy.current = false;
      }
    });
  };

  const handleStockUpload = async () => {
    if (stockBusy.current) return;
    if (!stockFile) return setStockError('Please select a CSV file first.');
    if (!selectedStationId) return setStockError('Please select a station.');
    if (!window.confirm('This will upload and merge stock data for the selected station. Continue?')) return;

    setStockError('');
    setIsUploadingStock(true);
    stockBusy.current = true;
    console.log('[StockUpload] Starting station stock initialization...');

    const normalizeKeys = (row) => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        if (!key) continue;
        const lowerKey = key.toLowerCase().trim();
        if (lowerKey.includes('cleaning material') || lowerKey === 'item name' || lowerKey === 'name') normalized['Cleaning Material'] = value;
        else if (lowerKey.includes('closing stock')) normalized['Closing Stock'] = value;
        else if (lowerKey.includes('good condition') || lowerKey.includes('in use') || lowerKey.includes('currently in use')) normalized['In Good condition (Currently in Use)'] = value;
        // IMPORTANT: check 'unusable' BEFORE 'usable' — 'unusable' contains 'usable' as a substring
        else if (lowerKey.includes('disposed') || lowerKey.includes('unusable')) normalized['Disposed Items available at station (unusable)'] = value;
        else if (lowerKey.includes('partially damaged') || lowerKey.includes('usable')) normalized['Partially Damaged Items available at station (Usable)'] = value;
        // Pass brand, supplier & tender year for precise DB matching
        else if (lowerKey.includes('brand')) normalized['Brand'] = value;
        else if (lowerKey.includes('supplier')) normalized['Supplier'] = value;
        else if (lowerKey.includes('tender')) normalized['Tender Year'] = value;
        else normalized[key] = value;
      }
      return normalized;
    };

    const toNum = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };

    // Filter rows: remove blank rows, sub-headers, and rows where ALL stock values are zero
    const isValidStockRow = (row) => {
      const name = (row['Cleaning Material'] || '').trim();
      if (!name) return false; // blank row
      // Skip rows that look like repeated headers or category sub-headings
      const nameLower = name.toLowerCase();
      if (nameLower === 'cleaning material' || nameLower === 'item name' || nameLower === 'name') return false;
      if (nameLower === 'chemical' || nameLower === 'consumable' || nameLower === 'disposable') return false;
      // Skip if Closing Stock is non-numeric text (likely a mid-table sub-header row)
      const closing = row['Closing Stock'];
      if (closing !== undefined && closing !== '' && isNaN(Number(closing))) return false;
      // Skip rows where ALL quantity fields are zero — nothing to store
      const totalStock = toNum(row['Closing Stock'])
        + toNum(row['In Good condition (Currently in Use)'])
        + toNum(row['Partially Damaged Items available at station (Usable)'])
        + toNum(row['Disposed Items available at station (unusable)']);
      if (totalStock === 0) return false;
      return true;
    };

    Papa.parse(stockFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const allRows = results.data.map(normalizeKeys);
          const payload = allRows.filter(isValidStockRow);
          console.log('[StockUpload] CSV rows parsed:', allRows.length, '| Valid rows after filtering:', payload.length);
          
          if (payload.length === 0) {
            setIsUploadingStock(false);
            stockBusy.current = false;
            return setStockError('No valid data rows found in the CSV. Please check the file.');
          }

          if (payload.length > 0) {
            const firstRow = payload[0];
            if (!('Closing Stock' in firstRow)) {
              setIsUploadingStock(false);
              stockBusy.current = false;
              return setStockError('Validation failed: This looks like the Master List CSV. Please upload the Station Stock CSV here.');
            }
          }
          
          // Import station stock
          console.log('[StockUpload] Sending', payload.length, 'rows to fn_import_station_stock...');
          const { error: importErr } = await supabase.rpc('fn_import_station_stock', { 
            p_station_id: selectedStationId,
            p_payload: payload 
          });
          if (importErr) throw importErr;
          console.log('[StockUpload] Import complete.');

          toast.success(`Station stock initialized! ${payload.length} items processed.`);
          setStockFile(null);
          setSelectedStationId('');
          // reset file input visually
          document.getElementById('stockFileInput').value = '';
        } catch (err) {
          console.error('[StockUpload] Error:', err);
          setStockError(err.message || 'Failed to initialize station stock.');
        } finally {
          setIsUploadingStock(false);
          stockBusy.current = false;
        }
      },
      error: (error) => {
        console.error('[StockUpload] CSV parse error:', error);
        setStockError(error.message);
        setIsUploadingStock(false);
        stockBusy.current = false;
      }
    });
  };

  // ── Helper: compute July Opening Stock for an item using the StockMovement formula ──
  // All dates are 'YYYY-MM-DD' strings.
  function computeJulyOpeningStock(currentStock, receipts, consumptions) {
    const julEnd = '2026-07-31';
    const receiptsAfter    = receipts.filter(r => r.received_date > julEnd).reduce((s, r) => s + Number(r.quantity), 0);
    const consumptionsAfter = consumptions.filter(c => c.consumption_date > julEnd).reduce((s, c) => s + Number(c.quantity_used), 0);
    const closingJul       = Number(currentStock) - receiptsAfter + consumptionsAfter;
    const receiptsDuring   = receipts.filter(r => r.received_date <= julEnd && r.supplier !== 'Opening Stock Initialization').reduce((s, r) => s + Number(r.quantity), 0);
    const initDuring       = receipts.filter(r => r.received_date <= julEnd && r.supplier === 'Opening Stock Initialization').reduce((s, r) => s + Number(r.quantity), 0);
    const consumpDuring    = consumptions.filter(c => c.consumption_date <= julEnd).reduce((s, c) => s + Number(c.quantity_used), 0);
    const trueOpening      = closingJul - (receiptsDuring + initDuring) + consumpDuring;
    return trueOpening + initDuring; // visualOpeningStock
  }

  // ── Helper: build month-by-month preview ──────────────────────────────────
  function buildMonthPreview(currentStock, receipts, consumptions, delta, dbUnit) {
    const today = new Date();
    const months = [];
    let yr = 2026, mo = 7;
    while (yr < today.getFullYear() || (yr === today.getFullYear() && mo <= today.getMonth() + 1)) {
      months.push({ yr, mo });
      mo++; if (mo > 12) { mo = 1; yr++; }
    }
    const disp = unit => getDisplayUnit(unit);
    const fmt = (v) => {
      const d = getDisplayUnit(dbUnit);
      const dv = toDisplayValue(v, dbUnit);
      return d === 'Nos' ? `${Math.round(dv)}` : `${dv.toFixed(2)}`;
    };

    return months.map(({ yr, mo }) => {
      const padMo = String(mo).padStart(2, '0');
      const lastDay = new Date(yr, mo, 0).getDate();
      const endDate = `${yr}-${padMo}-${String(lastDay).padStart(2, '0')}`;
      const startDate = `${yr}-${padMo}-01`;

      // BEFORE
      const rAfter  = receipts.filter(r => r.received_date > endDate).reduce((s, r) => s + Number(r.quantity), 0);
      const cAfter  = consumptions.filter(c => c.consumption_date > endDate).reduce((s, c) => s + Number(c.quantity_used), 0);
      const closingB = Math.max(0, Number(currentStock) - rAfter + cAfter);
      const rDuring  = receipts.filter(r => r.received_date <= endDate && r.received_date >= startDate && r.supplier !== 'Opening Stock Initialization').reduce((s, r) => s + Number(r.quantity), 0);
      const initD    = receipts.filter(r => r.received_date <= endDate && r.supplier === 'Opening Stock Initialization').reduce((s, r) => s + Number(r.quantity), 0);
      const cDuring  = consumptions.filter(c => c.consumption_date <= endDate).reduce((s, c) => s + Number(c.quantity_used), 0);
      const openB    = Math.max(0, closingB - (rDuring + initD) + cDuring + initD);

      // AFTER (shift current_stock by delta)
      const closingA = Math.max(0, (Number(currentStock) + delta) - rAfter + cAfter);
      const openA    = Math.max(0, closingA - (rDuring + initD) + cDuring + initD);

      const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return {
        label: `${MONTH_NAMES[mo]} ${yr}`,
        openBefore:   fmt(openB),
        openAfter:    fmt(openA),
        closeBefore:  fmt(closingB),
        closeAfter:   fmt(closingA),
        changed: openB !== openA || closingB !== closingA,
      };
    });
  }

  // Restrict Master List wipe to ALS and PNCU SC
  const canWipeMaster = role === ROLES.ALS || (role === ROLES.SC && selectedStation?.code === 'PNCU');

  // Filter stations based on role
  const allowedStationsForUser = stations.filter(s => {
    if (role === ROLES.SC) {
      return s.id === selectedStation?.id;
    }
    return true; // ALS and HKTL can see all stations
  });

  return (
    <Layout title="Data Initialization" subtitle="Upload Master Lists and Stock Data">
      <div className="two-col-grid" style={{ gridTemplateColumns: '1fr', maxWidth: '800px', margin: '0 auto' }}>
        
        {canWipeMaster && (
          <Card style={{ borderTop: '4px solid var(--color-danger-500)' }}>
            <CardHeader 
              title="1. Master List Initialization (Factory Reset)" 
              icon={<ShieldAlert size={20} color="var(--color-danger-600)" />} 
            />
            <CardBody>
              <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>
                <strong>DANGER:</strong> Uploading a new master list will completely wipe all current inventory, stocks, consumption logs, and requests. Use this only for starting a fresh month (e.g., July).
              </Alert>

              {masterError && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{masterError}</Alert>}

              <div className="form-group">
                <label className="form-label form-label-required">Upload Master List (CSV)</label>
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-500)', marginBottom: 'var(--space-2)' }}>
                  CSV must contain: <strong>Cleaning Material</strong>, <strong>Brand</strong>, <strong>Rate including GST</strong>, <strong>Tender Year</strong>, <strong>Chemical/Consumable</strong>, <strong>Unit</strong>.
                </p>
                <input 
                  id="masterFileInput"
                  type="file" 
                  accept=".csv" 
                  className="form-control" 
                  onChange={(e) => setMasterFile(e.target.files[0])}
                />
              </div>

              <Button 
                variant="danger" 
                onClick={handleMasterUpload} 
                isLoading={isWiping}
                disabled={!masterFile}
                style={{ width: '100%' }}
              >
                <DatabaseZap size={16} /> Wipe Database & Upload Master List
              </Button>
            </CardBody>
          </Card>
        )}

        <Card style={{ borderTop: '4px solid var(--color-primary-500)' }}>
          <CardHeader 
            title="2. Station Stock Initialization" 
            icon={<FileUp size={20} color="var(--color-primary-600)" />} 
          />
          <CardBody>
            <Alert variant="info" style={{ marginBottom: 'var(--space-4)' }}>
              Select a station and upload its stock CSV. The items will be matched automatically by the <strong>Cleaning Material</strong> name. Serial numbers are ignored.
            </Alert>

            {stockError && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{stockError}</Alert>}

            <div className="form-group">
              <label className="form-label form-label-required">Select Station</label>
              <select 
                className="form-control" 
                value={selectedStationId} 
                onChange={(e) => setSelectedStationId(e.target.value)}
              >
                <option value="">— Select Station —</option>
                {allowedStationsForUser.map(s => (
                  <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label form-label-required">Upload Station Stock (CSV)</label>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-500)', marginBottom: 'var(--space-2)' }}>
                CSV must contain: <strong>Cleaning Material</strong>, <strong>Closing Stock</strong>, <strong>In Good condition (Currently in Use)</strong>, <strong>Partially Damaged Items available at station (Usable)</strong>, <strong>Disposed Items available at station (unusable)</strong>.
              </p>
              <input 
                id="stockFileInput"
                type="file" 
                accept=".csv" 
                className="form-control" 
                onChange={(e) => setStockFile(e.target.files[0])}
              />
            </div>

            <Button 
              variant="primary" 
              onClick={handleStockUpload} 
              isLoading={isUploadingStock}
              disabled={!stockFile || !selectedStationId}
              style={{ width: '100%' }}
            >
              <FileUp size={16} /> Initialize Station Stock
            </Button>
          </CardBody>
        </Card>

        <Card style={{ borderTop: '4px solid var(--color-warning-500)' }}>
          <CardHeader
            title="3. Initial Opening Stock Correction (July Only)"
            icon={<FlaskConical size={20} color="var(--color-warning-600)" />}
          />
          <CardBody>

            {/* Warning banner */}
            <Alert variant="warning" style={{ marginBottom: 'var(--space-4)' }}>
              <strong><TriangleAlert size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />One-Time Stabilization Tool.</strong>{' '}
              This corrects the initial July Opening Stock only. It adjusts all subsequent months automatically by propagating the delta forward.
              Do NOT use this for normal inventory adjustments or any month other than July.
            </Alert>

            {corrError && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{corrError}</Alert>}

            {/* Station */}
            <div className="form-group">
              <label className="form-label form-label-required">Station</label>
              <select className="form-control" value={corrStationId} onChange={e => { setCorrStationId(e.target.value); setCorrItemId(''); }}>
                <option value="">— Select Station —</option>
                {allowedStationsForUser.map(s => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
              </select>
            </div>

            {/* Item */}
            <div className="form-group">
              <label className="form-label form-label-required">Item</label>
              <select className="form-control" value={corrItemId} onChange={e => setCorrItemId(e.target.value)} disabled={!corrStationId}>
                <option value="">— Select Item —</option>
                {items.map(item => {
                  const rm = Array.isArray(item.rate_master) ? item.rate_master[0] : item.rate_master;
                  const brand = rm?.brand ? ` | ${rm.brand}` : '';
                  const dispUnit = getDisplayUnit(item.unit || 'Nos');
                  return <option key={item.id} value={item.id}>{item.name}{brand} ({dispUnit})</option>;
                })}
              </select>
            </div>

            {/* Current Opening Stock (read-only) */}
            {corrItemId && (
              <div className="form-group">
                <label className="form-label">Current July Opening Stock (Read Only)</label>
                <div style={{
                  padding: '0.5rem 0.75rem',
                  background: 'var(--color-gray-50)',
                  border: '1px solid var(--color-gray-200)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 600,
                  color: 'var(--color-gray-700)',
                  minHeight: '2.5rem',
                  display: 'flex',
                  alignItems: 'center',
                }}>
                  {corrLoading ? 'Loading…' : corrCurrentOpening !== null
                    ? formatStock(corrCurrentOpening, items.find(i => i.id === corrItemId)?.unit || 'Nos')
                    : '—'}
                </div>
              </div>
            )}

            {/* Correct Opening Stock */}
            {corrCurrentOpening !== null && (() => {
              const selectedItem = items.find(i => i.id === corrItemId);
              const dbUnit = selectedItem?.unit || 'Nos';
              const dispUnit = getDisplayUnit(dbUnit);
              const currentDisp = toDisplayValue(corrCurrentOpening, dbUnit);
              const newDisp = corrNewQty !== '' ? Number(corrNewQty) : null;
              const diffDisp = newDisp !== null ? (newDisp - currentDisp) : null;
              return (
                <>
                  <div className="form-group">
                    <label className="form-label form-label-required">Correct July Opening Stock ({dispUnit})</label>
                    <input
                      type="number" step="0.01" min="0"
                      className="form-control"
                      placeholder={`Enter correct value in ${dispUnit}`}
                      value={corrNewQty}
                      onChange={e => { setCorrNewQty(e.target.value); setCorrPreview(null); }}
                    />
                    {diffDisp !== null && diffDisp !== 0 && (
                      <div style={{
                        marginTop: '0.4rem', fontSize: '0.82rem', fontWeight: 600,
                        color: diffDisp > 0 ? 'var(--color-success-600)' : 'var(--color-danger-600)',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        <ArrowRight size={13} />
                        Difference: {diffDisp > 0 ? '+' : ''}{diffDisp.toFixed(dispUnit === 'Nos' ? 0 : 2)} {dispUnit}
                      </div>
                    )}
                  </div>

                  {/* Reason */}
                  <div className="form-group">
                    <label className="form-label form-label-required">Reason for Correction</label>
                    <textarea
                      className="form-control"
                      rows={2}
                      placeholder="Describe why the opening stock needs correction…"
                      value={corrReason}
                      onChange={e => { setCorrReason(e.target.value); setCorrPreview(null); }}
                      style={{ resize: 'vertical' }}
                    />
                  </div>

                  {/* Preview Button */}
                  <Button
                    variant="secondary"
                    onClick={handlePreview}
                    isLoading={previewLoading}
                    disabled={corrNewQty === '' || !corrReason.trim() || previewLoading}
                    style={{ width: '100%', marginBottom: 'var(--space-3)' }}
                  >
                    <Eye size={15} /> Preview Impact
                  </Button>

                  {/* Preview Panel */}
                  {corrPreview && (
                    <div style={{
                      border: '1px solid var(--color-gray-200)',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                      marginBottom: 'var(--space-4)',
                    }}>
                      <div style={{
                        background: 'var(--color-primary-50)',
                        borderBottom: '1px solid var(--color-gray-200)',
                        padding: '0.5rem 0.75rem',
                        fontWeight: 700,
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--color-primary-700)',
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: '0.5rem',
                      }}>
                        <span>Month</span>
                        <span>Opening Stock</span>
                        <span>Closing Stock</span>
                      </div>
                      {corrPreview.map((row, i) => (
                        <div key={i} style={{
                          padding: '0.5rem 0.75rem',
                          borderBottom: i < corrPreview.length - 1 ? '1px solid var(--color-gray-100)' : 'none',
                          background: row.changed ? 'var(--color-warning-50)' : 'white',
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr 1fr',
                          gap: '0.5rem',
                          fontSize: 'var(--font-size-xs)',
                          alignItems: 'center',
                        }}>
                          <span style={{ fontWeight: 600, color: 'var(--color-gray-800)' }}>{row.label}</span>
                          <span>
                            {row.changed && row.openBefore !== row.openAfter ? (
                              <><span style={{ color: 'var(--color-danger-500)', textDecoration: 'line-through' }}>{row.openBefore}</span>{' '}
                                <ArrowRight size={10} style={{ verticalAlign: 'middle', color: 'var(--color-gray-400)' }} />{' '}
                                <span style={{ color: 'var(--color-success-600)', fontWeight: 700 }}>{row.openAfter}</span></>
                            ) : <span style={{ color: 'var(--color-gray-500)' }}>{row.openAfter}</span>}
                          </span>
                          <span>
                            {row.changed && row.closeBefore !== row.closeAfter ? (
                              <><span style={{ color: 'var(--color-danger-500)', textDecoration: 'line-through' }}>{row.closeBefore}</span>{' '}
                                <ArrowRight size={10} style={{ verticalAlign: 'middle', color: 'var(--color-gray-400)' }} />{' '}
                                <span style={{ color: 'var(--color-success-600)', fontWeight: 700 }}>{row.closeAfter}</span></>
                            ) : <span style={{ color: 'var(--color-gray-500)' }}>{row.closeAfter}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Apply Button */}
                  {corrPreview && (
                    <Button
                      variant="primary"
                      onClick={handleApplyCorrection}
                      isLoading={corrApplying}
                      disabled={corrApplying}
                      style={{ width: '100%', background: 'var(--color-warning-600)' }}
                    >
                      <CheckCircle2 size={15} /> Apply Correction
                    </Button>
                  )}
                </>
              );
            })()}

          </CardBody>
        </Card>

      </div>
    </Layout>
  );
}
