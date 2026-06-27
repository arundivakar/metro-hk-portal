import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { ROLES, ALS_GROUPS } from '../lib/constants';
import { useStationStore } from '../store/stationStore';
import Layout from '../components/layout/Layout';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import toast from 'react-hot-toast';
import { FileUp, DatabaseZap, ShieldAlert } from 'lucide-react';

export default function DataInitialization() {
  const { role } = useAuthStore();
  const { selectedStation } = useStationStore();
  const [stations, setStations] = useState([]);
  
  // Master List State
  const [masterFile, setMasterFile] = useState(null);
  const [isWiping, setIsWiping] = useState(false);
  const [masterError, setMasterError] = useState('');

  // Station Stock State
  const [stockFile, setStockFile] = useState(null);
  const [selectedStationId, setSelectedStationId] = useState('');
  const [isUploadingStock, setIsUploadingStock] = useState(false);
  const [stockError, setStockError] = useState('');

  useEffect(() => {
    const fetchStations = async () => {
      const { data } = await supabase.from('stations').select('*').eq('is_active', true).order('code');
      if (data) setStations(data);
    };
    fetchStations();
  }, []);

  const handleMasterUpload = async () => {
    if (!masterFile) return setMasterError('Please select a CSV file first.');
    if (!window.confirm('WARNING: This will wipe ALL current inventory and stock data. Are you absolutely sure?')) return;

    setMasterError('');
    setIsWiping(true);

    const normalizeKeys = (row) => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        if (!key) continue;
        const lowerKey = key.toLowerCase().trim();
        if (lowerKey.includes('cleaning material') || lowerKey === 'item name' || lowerKey === 'name') normalized['Cleaning Material'] = value;
        else if (lowerKey.includes('chemical') || lowerKey.includes('category')) {
          const cat = (value || '').toLowerCase().trim();
          normalized['Chemical/Consumable'] = cat.includes('chemical') ? 'Chemical' : 'Consumable';
        }
        else if (lowerKey.includes('rate')) normalized['Rate including GST'] = value;
        else if (lowerKey.includes('brand')) normalized['Brand'] = value;
        else if (lowerKey.includes('tender')) normalized['Tender Year'] = value;
        else if (lowerKey === 'unit') normalized['Unit'] = value;
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
          
          if (payload.length > 0) {
            const firstRow = payload[0];
            if (!('Rate including GST' in firstRow) && !('Brand' in firstRow) && !('Tender Year' in firstRow)) {
              setIsWiping(false);
              return setMasterError('Validation failed: This looks like the Station Stock CSV. Please upload the Master List CSV here.');
            }
          }
          
          // 1. Wipe database
          const { error: wipeErr } = await supabase.rpc('fn_wipe_database');
          if (wipeErr) throw wipeErr;

          // 2. Import new list
          const { error: importErr } = await supabase.rpc('fn_import_master_list', { p_payload: payload });
          if (importErr) throw importErr;

          toast.success('Master list successfully initialized!');
          setMasterFile(null);
          // reset file input visually
          document.getElementById('masterFileInput').value = '';
        } catch (err) {
          console.error(err);
          setMasterError(err.message || 'Failed to initialize master list.');
        } finally {
          setIsWiping(false);
        }
      },
      error: (error) => {
        setMasterError(error.message);
        setIsWiping(false);
      }
    });
  };

  const handleStockUpload = async () => {
    if (!stockFile) return setStockError('Please select a CSV file first.');
    if (!selectedStationId) return setStockError('Please select a station.');
    if (!window.confirm('This will upload and merge stock data for the selected station. Continue?')) return;

    setStockError('');
    setIsUploadingStock(true);

    const normalizeKeys = (row) => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        if (!key) continue;
        const lowerKey = key.toLowerCase().trim();
        if (lowerKey.includes('cleaning material') || lowerKey === 'item name' || lowerKey === 'name') normalized['Cleaning Material'] = value;
        else if (lowerKey.includes('closing stock')) normalized['Closing Stock'] = value;
        else if (lowerKey.includes('good condition') || lowerKey.includes('in use') || lowerKey.includes('currently in use')) normalized['In Good condition (Currently in Use)'] = value;
        else if (lowerKey.includes('partially damaged') || lowerKey.includes('usable')) normalized['Partially Damaged Items available at station (Usable)'] = value;
        else if (lowerKey.includes('disposed') || lowerKey.includes('unusable')) normalized['Disposed Items available at station (unusable)'] = value;
        else normalized[key] = value;
      }
      return normalized;
    };

    Papa.parse(stockFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const payload = results.data.map(normalizeKeys);
          
          if (payload.length > 0) {
            const firstRow = payload[0];
            if (!('Closing Stock' in firstRow)) {
              setIsUploadingStock(false);
              return setStockError('Validation failed: This looks like the Master List CSV. Please upload the Station Stock CSV here.');
            }
          }
          
          // Import station stock
          const { error: importErr } = await supabase.rpc('fn_import_station_stock', { 
            p_station_id: selectedStationId,
            p_payload: payload 
          });
          if (importErr) throw importErr;

          toast.success('Station stock successfully initialized!');
          setStockFile(null);
          setSelectedStationId('');
          // reset file input visually
          document.getElementById('stockFileInput').value = '';
        } catch (err) {
          console.error(err);
          setStockError(err.message || 'Failed to initialize station stock.');
        } finally {
          setIsUploadingStock(false);
        }
      },
      error: (error) => {
        setStockError(error.message);
        setIsUploadingStock(false);
      }
    });
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

      </div>
    </Layout>
  );
}
