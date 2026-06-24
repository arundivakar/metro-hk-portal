import React, { useEffect, useState } from 'react';
import { Package, Search, AlertTriangle, UploadCloud, Download } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import { Badge } from '../components/ui/Badge';
import Alert from '../components/ui/Alert';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { useInventory } from '../hooks/useInventory';
import { ROLES, ALS_GROUPS } from '../lib/constants';
import { supabase } from '../lib/supabase';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import toast from 'react-hot-toast';

function parseCSVRow(str) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (inQuotes) {
      if (char === '"') {
        if (str[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else { current += char; }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ',') { result.push(current); current = ''; }
      else { current += char; }
    }
  }
  result.push(current);
  return result.map(s => s.trim());
}

export default function Inventory() {
  const { role } = useAuthStore();
  const { selectedStation, alsGroupFilter } = useStationStore();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [allStationsInventory, setAllStationsInventory] = useState([]);
  const [stationFilter, setStationFilter] = useState('All');
  const [alsLoading, setAlsLoading] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importWipe, setImportWipe] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const { inventory, isLoading, fetchInventory, getLowStockItems } = useInventory(
    role !== ROLES.ALS ? selectedStation?.id : null
  );

  useEffect(() => {
    if (role !== ROLES.ALS && selectedStation?.id) {
      fetchInventory(selectedStation.id);
    } else if (role === ROLES.ALS) {
      loadAllInventory();
    }
  }, [selectedStation?.id, role]); // eslint-disable-line

  const loadAllInventory = async () => {
    setAlsLoading(true);
    try {
      const { data, error } = await supabase
        .from('v_station_inventory_summary')
        .select('*')
        .order('station_code', { ascending: true })
        .order('item_name', { ascending: true });
      if (error) throw error;
      setAllStationsInventory(data ?? []);
    } catch (err) {
      console.error('ALS inventory error:', err);
    } finally {
      setAlsLoading(false);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      if (lines.length < 2) throw new Error("CSV is empty or missing data rows");

      const data = lines.slice(1).map(parseCSVRow).map(row => ({
        item_name: row[0],
        category: row[1] || 'Consumable',
        unit: row[2] || 'Nos',
        unit_rate: Number(row[3]) || 0,
        brand: row[4] || null,
        tender_year: row[5] || null,
        min_level: Number(row[6]) || 0,
        opening_stock: Number(row[7]) || 0
      }));

      const { error } = await supabase.rpc('fn_import_inventory', {
        p_station_id: selectedStation?.id || null,
        p_wipe_existing: importWipe,
        p_payload: data
      });

      if (error) throw error;
      toast.success("Inventory imported successfully!");
      setIsImportModalOpen(false);
      setImportWipe(false);
      if (role !== ROLES.ALS && selectedStation?.id) {
        fetchInventory(selectedStation.id);
      } else {
        loadAllInventory();
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Failed to import CSV");
    } finally {
      setIsImporting(false);
      e.target.value = ''; // reset file input
    }
  };

  const downloadTemplate = () => {
    const headers = "Item Name,Category,Unit,Unit Rate,Brand,Tender Year,Min Level,Opening Stock\n";
    const sample = 'Acrylic Dry Mop,"Consumable",Nos,120.50,Klean,2025-26,10,50\nBleaching Powder,"Chemical",Kg,45.00,Tricuesta,2025-26,5,100';
    const blob = new Blob([headers + sample], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventory_import_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Build display data
  const rawData = role === ROLES.ALS ? allStationsInventory : inventory;
  const isLoadingData = role === ROLES.ALS ? alsLoading : isLoading;

  let filteredData = rawData.filter((row) => {
    // ALS Group Filter logic
    const allowedStations = ALS_GROUPS[alsGroupFilter];
    if (role === ROLES.ALS && allowedStations && !allowedStations.includes(row.station_code)) {
      return false;
    }

    const name = (row.item_name ?? '').toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'All' || row.category === categoryFilter;
    const matchStation = role !== ROLES.ALS || stationFilter === 'All' || row.station_code === stationFilter;
    return matchSearch && matchCategory && matchStation;
  });

  if (role === ROLES.ALS) {
    // Aggregate data by item_id for ALS
    const grouped = {};
    filteredData.forEach((row) => {
      if (!grouped[row.item_id]) {
        grouped[row.item_id] = { ...row, current_stock: 0 };
      }
      grouped[row.item_id].current_stock += Number(row.current_stock);
    });
    filteredData = Object.values(grouped);
  }

  const displayData = filteredData.map((row) => ({
    id: role === ROLES.ALS ? row.item_id : (row.item_id + '-' + row.station_id),
    station_code: row.station_code,
    item_name: row.item_name ?? '—',
    category: row.category ?? '—',
    unit: row.unit ?? '—',
    tender_year: row.tender_year ?? '—',
    brand_name: row.brand_name ?? '—',
    unit_rate: row.unit_rate ? `₹${row.unit_rate}` : '—',
    current_stock: Number(row.current_stock).toFixed(2).replace(/\.00$/, ''),
    min_stock_level: row.min_stock_level ?? 0,
    last_updated: row.last_updated ? new Date(row.last_updated).toLocaleDateString('en-IN') : '—',
    is_low: role === ROLES.ALS ? false : row.is_low_stock, // Disable low stock highlighting for aggregated ALS view
    _rowClass: (role !== ROLES.ALS && row.is_low_stock) ? 'low-stock-row' : '',
  }));

  const lowStockCount = role === ROLES.ALS ? 0 : displayData.filter((r) => r.is_low).length;

  // Station list for ALS filter
  const stationCodes = role === ROLES.ALS
    ? [...new Set(allStationsInventory.map((r) => r.station_code).filter(Boolean))].sort()
    : [];

  const columns = [
    { key: 'item_name', label: 'Item Name', sortable: true },
    { key: 'tender_year', label: 'Tender Year' },
    { key: 'brand_name', label: 'Brand Name' },
    { key: 'unit_rate', label: 'Rate' },
    {
      key: 'category', label: 'Category',
      render: (v) => <Badge variant={v === 'Chemical' ? 'info' : 'accent'}>{v}</Badge>,
    },
    {
      key: 'current_stock', label: 'Current Stock', sortable: true,
      render: (v, row) => (
        <span style={{ fontWeight: 600, color: row.is_low ? 'var(--color-warning-600)' : 'var(--color-success-600)' }}>
          {v} {row.unit}
          {row.is_low && <AlertTriangle size={12} style={{ marginLeft: 6, display: 'inline' }} />}
        </span>
      ),
    },
    {
      key: 'min_stock_level', label: 'Min Level',
      render: (v, row) => v > 0 ? `${v} ${row.unit}` : '—',
    },
  ];

  return (
    <Layout
      title={role === ROLES.ALS ? 'All Station Inventory' : 'Inventory'}
      subtitle={role === ROLES.ALS ? 'Stock levels across all 25 stations' : selectedStation?.name}
    >
      {lowStockCount > 0 && (
        <Alert variant="warning" className="animate-fade-in" style={{ marginBottom: 'var(--space-4)' }}>
          <strong>{lowStockCount} item{lowStockCount > 1 ? 's' : ''}</strong> below minimum stock level.
          Highlighted in yellow below.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Inventory Stock Levels"
          icon={<Package size={16} />}
          subtitle={`${displayData.length} items`}
          action={
            (role === ROLES.SC || role === ROLES.ALS) && (
              <Button variant="outline" onClick={() => setIsImportModalOpen(true)}>
                <UploadCloud size={14} /> Import CSV
              </Button>
            )
          }
        />
        <CardBody>
          {/* Filter Bar */}
          <div className="filter-bar">
            <div className="search-input-wrapper">
              <Search size={15} className="search-input-icon" />
              <input
                id="inventory-search"
                type="search"
                className="search-input"
                placeholder="Search items…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              id="category-filter"
              className="form-control"
              style={{ width: 'auto' }}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="All">All Categories</option>
              <option value="Chemical">Chemical</option>
              <option value="Consumable">Consumable</option>
            </select>
          </div>
        </CardBody>
        <DataTable
          columns={columns}
          data={displayData}
          isLoading={isLoadingData}
          emptyTitle="No inventory items"
          emptyDesc="No inventory data found. Add items to rate master and assign to stations."
          emptyIcon={<Package size={28} />}
        />
      </Card>

      <Modal
        isOpen={isImportModalOpen}
        onClose={() => !isImporting && setIsImportModalOpen(false)}
        title="Import Inventory via CSV"
        size="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <Button variant="ghost" onClick={downloadTemplate} disabled={isImporting}>
              <Download size={14} /> Download Template
            </Button>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button variant="outline" onClick={() => setIsImportModalOpen(false)} disabled={isImporting}>Cancel</Button>
              <label className="btn btn-primary" style={{ cursor: isImporting ? 'not-allowed' : 'pointer' }}>
                <UploadCloud size={14} /> {isImporting ? 'Importing...' : 'Select CSV & Import'}
                <input type="file" accept=".csv" style={{ display: 'none' }} onChange={handleImport} disabled={isImporting} />
              </label>
            </div>
          </div>
        }
      >
        <div style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>
          <p style={{ marginBottom: 'var(--space-2)' }}>Upload a CSV file to initialize or replace your inventory items.</p>
          <ul style={{ listStyle: 'disc', paddingLeft: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
            <li>Must contain exactly 8 columns (see template).</li>
            <li><strong>Opening Stock</strong> will automatically be credited to your current station.</li>
          </ul>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3)', background: 'var(--color-danger-50)', border: '1px solid var(--color-danger-200)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
            <input type="checkbox" checked={importWipe} onChange={(e) => setImportWipe(e.target.checked)} disabled={isImporting} />
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-danger-700)' }}>
              Factory Reset: Wipe all existing catalogue items, stock, and logs before importing.
            </span>
          </label>
        </div>
      </Modal>
    </Layout>
  );
}
