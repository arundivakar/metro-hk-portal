import React, { useEffect, useState } from 'react';
import { toDisplayValue, getDisplayUnit } from '../utils/units';
import { Package, Search, AlertTriangle, ClipboardList } from 'lucide-react';
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


export default function Inventory() {
  const { role } = useAuthStore();
  const { selectedStation, alsGroupFilter } = useStationStore();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [allStationsInventory, setAllStationsInventory] = useState([]);
  const [stationFilter, setStationFilter] = useState('All');
  const [alsLoading, setAlsLoading] = useState(false);

  const { inventory, isLoading, fetchInventory, getLowStockItems } = useInventory(
    (role !== ROLES.ALS && role !== ROLES.HKTL) ? selectedStation?.id : null
  );

  useEffect(() => {
    if ((role !== ROLES.ALS && role !== ROLES.HKTL) && selectedStation?.id) {
      fetchInventory(selectedStation.id);
    } else if ((role === ROLES.ALS || role === ROLES.HKTL)) {
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


  // Build display data
  const rawData = (role === ROLES.ALS || role === ROLES.HKTL) ? allStationsInventory : inventory;
  const isLoadingData = (role === ROLES.ALS || role === ROLES.HKTL) ? alsLoading : isLoading;

  let filteredData = rawData.filter((row) => {
    // ALS Group Filter logic
    const allowedStations = ALS_GROUPS[alsGroupFilter];
    if ((role === ROLES.ALS || role === ROLES.HKTL) && allowedStations && !allowedStations.includes(row.station_code)) {
      return false;
    }

    const name = (row.item_name ?? '').toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'All' || row.category === categoryFilter;
    const matchStation = (role !== ROLES.ALS && role !== ROLES.HKTL) || stationFilter === 'All' || row.station_code === stationFilter;
    return matchSearch && matchCategory && matchStation;
  });

  if ((role === ROLES.ALS || role === ROLES.HKTL)) {
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

  const displayData = filteredData.map((row) => {
    const dbUnit   = row.unit ?? 'Nos';
    const dispUnit = getDisplayUnit(dbUnit);
    const rawStock = Number(row.current_stock) || 0;
    const displayVal = toDisplayValue(rawStock, dbUnit);
    const minBase    = Number(row.min_stock_level) || 0;
    const minDisplay = toDisplayValue(minBase, dbUnit);
    return {
      id: (role === ROLES.ALS || role === ROLES.HKTL) ? row.item_id : (row.item_id + '-' + row.station_id),
      station_code: row.station_code,
      item_name: row.item_name ?? '—',
      category: row.category ?? '—',
      unit: dispUnit,
      dbUnit,
      tender_year: row.tender_year ?? '—',
      brand_name: row.brand_name ?? '—',
      unit_rate: row.unit_rate ? `₹${row.unit_rate}` : '—',
      current_stock: displayVal,
      current_stock_display: dispUnit === 'Nos'
        ? `${Math.round(displayVal)} Nos`
        : `${displayVal.toFixed(2)} ${dispUnit}`,
      min_stock_level: minDisplay,
      min_stock_display: dispUnit === 'Nos'
        ? `${Math.round(minDisplay)} Nos`
        : `${minDisplay.toFixed(2)} ${dispUnit}`,
      last_updated: row.last_updated ? new Date(row.last_updated).toLocaleDateString('en-IN') : '—',
      is_low: (role === ROLES.ALS || role === ROLES.HKTL) ? false : row.is_low_stock,
      _rowClass: ((role !== ROLES.ALS && role !== ROLES.HKTL) && row.is_low_stock) ? 'low-stock-row' : '',
    };
  });

  const lowStockCount = (role === ROLES.ALS || role === ROLES.HKTL) ? 0 : displayData.filter((r) => r.is_low).length;

  // Station list for ALS filter
  const stationCodes = (role === ROLES.ALS || role === ROLES.HKTL)
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
          {row.current_stock_display}
          {row.is_low && <AlertTriangle size={12} style={{ marginLeft: 6, display: 'inline' }} />}
        </span>
      ),
    },
    {
      key: 'min_stock_level', label: 'Min Level',
      render: (v, row) => v > 0 ? row.min_stock_display : '—',
    },
  ];

  return (
    <Layout
      title={(role === ROLES.ALS || role === ROLES.HKTL) ? 'All Station Inventory' : 'Inventory'}
      subtitle={(role === ROLES.ALS || role === ROLES.HKTL) ? 'Stock levels across all 25 stations' : selectedStation?.name}
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
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button variant="outline" onClick={() => window.open('/print-checklist', '_blank')}>
                <ClipboardList size={14} /> Print Verification Checklist
              </Button>
            </div>
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
    </Layout>
  );
}
