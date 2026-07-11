import React, { useState, useEffect, useRef } from 'react';
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
import { FileUp, DatabaseZap, ShieldAlert, Pencil } from 'lucide-react';
import { formatStock } from '../utils/units';

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
  
  // Manual Stock State
  const [items, setItems] = useState([]);
  const [manualStationId, setManualStationId] = useState('');
  const [manualItemId, setManualItemId] = useState('');
  const [manualQty, setManualQty] = useState('');
  const [isUpdatingManual, setIsUpdatingManual] = useState(false);
  const [manualError, setManualError] = useState('');
  
  const [currentStockVal, setCurrentStockVal] = useState(null);
  const [isFetchingStock, setIsFetchingStock] = useState(false);

  useEffect(() => {
    if (manualStationId && manualItemId) {
      const fetchStock = async () => {
        setIsFetchingStock(true);
        const { data } = await supabase
          .from('station_inventory')
          .select('current_stock')
          .eq('station_id', manualStationId)
          .eq('item_id', manualItemId)
          .maybeSingle();
        setCurrentStockVal(data?.current_stock ?? 0);
        setIsFetchingStock(false);
      };
      fetchStock();
    } else {
      setCurrentStockVal(null);
    }
  }, [manualStationId, manualItemId]);

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

  const handleManualStockUpdate = async () => {
    if (!manualStationId || !manualItemId || manualQty === '') {
      return setManualError('Please fill all fields');
    }
    
    setManualError('');
    setIsUpdatingManual(true);
    
    try {
      const selectedItem = items.find(i => i.id === manualItemId);
      if (!selectedItem) throw new Error('Item not found');
      
      const qty = Number(manualQty);
      if (isNaN(qty) || qty < 0) throw new Error('Quantity must be a positive number');
      
      // Convert to base unit for storage (e.g. Ltr -> ml)
      let baseQty = qty;
      const unit = selectedItem.unit || 'Nos';
      const u = unit.toLowerCase();
      if (u === 'ml' || u === 'ltr' || u === 'l' || u === 'g' || u === 'kg') {
        baseQty = qty * 1000;
      }

      // Check if inventory record already exists for this station/item
      const { data: existing, error: fetchErr } = await supabase
        .from('station_inventory')
        .select('id')
        .eq('station_id', manualStationId)
        .eq('item_id', manualItemId)
        .maybeSingle();
        
      if (fetchErr) throw fetchErr;

      const now = new Date().toISOString();

      if (existing) {
        const { error: updateErr } = await supabase
          .from('station_inventory')
          .update({ current_stock: baseQty, last_updated: now })
          .eq('id', existing.id);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from('station_inventory')
          .insert({
            station_id: manualStationId,
            item_id: manualItemId,
            current_stock: baseQty,
            balance_stock: baseQty,
            last_updated: now
          });
        if (insertErr) throw insertErr;
      }

      toast.success('Stock updated successfully!');
      setManualQty('');
      setManualItemId('');
    } catch (err) {
      console.error(err);
      setManualError(err.message || 'Failed to update stock');
    } finally {
      setIsUpdatingManual(false);
    }
  };

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
            title="3. Manual Stock Adjustment" 
            icon={<Pencil size={20} color="var(--color-warning-600)" />} 
          />
          <CardBody>
            <Alert variant="warning" style={{ marginBottom: 'var(--space-4)' }}>
              Use this tool to directly edit the current stock of a specific item at a station. This bypasses CSV uploads and applies immediately.
            </Alert>

            {manualError && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{manualError}</Alert>}

            <div className="form-group">
              <label className="form-label form-label-required">Select Station</label>
              <select 
                className="form-control" 
                value={manualStationId} 
                onChange={(e) => setManualStationId(e.target.value)}
              >
                <option value="">— Select Station —</option>
                {allowedStationsForUser.map(s => (
                  <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label form-label-required">Select Item</label>
              <select 
                className="form-control" 
                value={manualItemId} 
                onChange={(e) => setManualItemId(e.target.value)}
              >
                <option value="">— Select Item —</option>
                {items.map(item => {
                   let displayUnit = 'Nos';
                   const u = (item.unit || '').toLowerCase();
                   if (u === 'ml' || u === 'ltr' || u === 'l') displayUnit = 'Ltr';
                   if (u === 'g' || u === 'kg') displayUnit = 'Kg';
                   
                   const rm = Array.isArray(item.rate_master) ? item.rate_master[0] : item.rate_master;
                   const brand = rm?.brand;
                   const tenderYear = rm?.tender_year;
                   
                   const brandStr = brand ? ` | ${brand}` : '';
                   const tenderStr = tenderYear && tenderYear !== '—' ? ` | ${tenderYear}` : '';

                   return <option key={item.id} value={item.id}>{item.name}{brandStr}{tenderStr} ({displayUnit})</option>;
                })}
              </select>
              {currentStockVal !== null && manualStationId && manualItemId && (
                <div style={{ marginTop: '0.4rem', fontSize: '0.85rem', color: 'var(--color-primary-700)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {isFetchingStock ? (
                    'Fetching current stock...'
                  ) : (
                    <>Current Stock: {formatStock(currentStockVal, items.find(i => i.id === manualItemId)?.unit || 'Nos')}</>
                  )}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label form-label-required">New Quantity</label>
              <input 
                type="number"
                step="0.01"
                min="0"
                className="form-control"
                placeholder="Enter new quantity in Ltr, Kg, or Nos"
                value={manualQty}
                onChange={(e) => setManualQty(e.target.value)}
              />
            </div>

            <Button 
              variant="primary" 
              onClick={handleManualStockUpdate} 
              isLoading={isUpdatingManual}
              disabled={!manualStationId || !manualItemId || manualQty === ''}
              style={{ width: '100%', background: 'var(--color-warning-600)' }}
            >
              <Pencil size={16} /> Update Stock
            </Button>
          </CardBody>
        </Card>

      </div>
    </Layout>
  );
}
