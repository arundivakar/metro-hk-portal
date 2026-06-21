import React, { useEffect, useState } from 'react';
import { Package, Search, AlertTriangle } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import { Badge } from '../components/ui/Badge';
import Alert from '../components/ui/Alert';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { useInventory } from '../hooks/useInventory';
import { ROLES } from '../lib/constants';
import { supabase } from '../lib/supabase';

export default function Inventory() {
  const { role } = useAuthStore();
  const { selectedStation } = useStationStore();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [allStationsInventory, setAllStationsInventory] = useState([]);
  const [stationFilter, setStationFilter] = useState('All');
  const [alsLoading, setAlsLoading] = useState(false);

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

  // Build display data
  const rawData = role === ROLES.ALS ? allStationsInventory : inventory;
  const isLoadingData = role === ROLES.ALS ? alsLoading : isLoading;

  const displayData = rawData
    .filter((row) => {
      const name = (row.item_name ?? '').toLowerCase();
      const matchSearch = !search || name.includes(search.toLowerCase());
      const matchCategory = categoryFilter === 'All' || row.category === categoryFilter;
      const matchStation = role !== ROLES.ALS || stationFilter === 'All' || row.station_code === stationFilter;
      return matchSearch && matchCategory && matchStation;
    })
    .map((row) => ({
      id: row.item_id + '-' + row.station_id,
      station_code: row.station_code,
      item_name: row.item_name ?? '—',
      category: row.category ?? '—',
      unit: row.unit ?? '—',
      tender_year: row.tender_year ?? '—',
      brand_name: row.brand_name ?? '—',
      unit_rate: row.unit_rate ? `₹${row.unit_rate}` : '—',
      current_stock: row.current_stock,
      min_stock_level: row.min_stock_level ?? 0,
      last_updated: row.last_updated ? new Date(row.last_updated).toLocaleDateString('en-IN') : '—',
      is_low: row.is_low_stock,
      _rowClass: row.is_low_stock ? 'low-stock-row' : '',
    }));

  const lowStockCount = displayData.filter((r) => r.is_low).length;

  // Station list for ALS filter
  const stationCodes = role === ROLES.ALS
    ? [...new Set(allStationsInventory.map((r) => r.station_code).filter(Boolean))].sort()
    : [];

  const columns = [
    ...(role === ROLES.ALS ? [{
      key: 'station_code', label: 'Station', sortable: true,
      render: (v) => <Badge variant="primary">{v}</Badge>,
    }] : []),
    { key: 'item_name', label: 'Item Name', sortable: true },
    { key: 'tender_year', label: 'Tender Year' },
    { key: 'brand_name', label: 'Brand Name' },
    { key: 'unit_rate', label: 'Rate' },
    {
      key: 'category', label: 'Category',
      render: (v) => <Badge variant={v === 'Chemical' ? 'info' : 'accent'}>{v}</Badge>,
    },
    { key: 'unit', label: 'Unit' },
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
            {role === ROLES.ALS && (
              <select
                id="station-filter"
                className="form-control"
                style={{ width: 'auto' }}
                value={stationFilter}
                onChange={(e) => setStationFilter(e.target.value)}
              >
                <option value="All">All Stations</option>
                {stationCodes.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            )}
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
