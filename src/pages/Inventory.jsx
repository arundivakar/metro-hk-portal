import React, { useEffect, useState } from 'react';
import { toDisplayValue, getDisplayUnit, toDBUnit } from '../utils/units';
import { Package, Search, AlertTriangle, ClipboardList, Pencil } from 'lucide-react';
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

  // Edit permission: HKTL role OR SC user at PNCU station
  const canEditMaster = role === ROLES.HKTL || (role === ROLES.SC && selectedStation?.code === 'PNCU');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [allStationsInventory, setAllStationsInventory] = useState([]);
  const [stationFilter, setStationFilter] = useState('All');
  const [alsLoading, setAlsLoading] = useState(false);

  // Edit Master state
  const [editingItem, setEditingItem] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    itemId: '', rmId: '', itemName: '', category: 'Consumable',
    unit: 'Nos', brand: '', supplier: '', tenderYear: '',
    gstPercent: '', baseRate: '', rateInclGST: '', nosPerKg: '',
  });

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
      let allData = [];
      let from = 0;
      const step = 1000;
      
      while (true) {
        const { data, error } = await supabase
          .from('v_station_inventory_summary')
          .select('*')
          .order('station_code', { ascending: true })
          .order('item_name', { ascending: true })
          .range(from, from + step - 1);
          
        if (error) throw error;
        if (!data || data.length === 0) break;
        
        allData = allData.concat(data);
        if (data.length < step) break;
        from += step;
      }
      
      setAllStationsInventory(allData);
    } catch (err) {
      console.error('ALS inventory error:', err);
    } finally {
      setAlsLoading(false);
    }
  };

  // --- Edit master item ---
  const handleEditClick = async (itemId) => {
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, name, category, unit, rate_master(id, item_name, brand, supplier, tender_year, unit_rate, base_rate, gst_percent, nos_per_kg, category)')
        .eq('id', itemId)
        .single();
      if (error || !data) throw error || new Error('Item not found');
      const rm = data.rate_master || {};
      const dbUnit = data.unit || 'Nos';
      setEditForm({
        itemId:     data.id,
        rmId:       rm.id || '',
        itemName:   data.name || rm.item_name || '',
        category:   data.category || 'Consumable',
        unit:       getDisplayUnit(dbUnit),
        brand:      rm.brand || '',
        supplier:   rm.supplier || '',
        tenderYear: rm.tender_year || '',
        gstPercent:  rm.gst_percent != null ? String(rm.gst_percent) : '',
        baseRate:    rm.base_rate   != null ? String(rm.base_rate)   : '',
        rateInclGST: rm.unit_rate   != null ? String(rm.unit_rate)   : '',
        nosPerKg:    rm.nos_per_kg  != null ? String(rm.nos_per_kg)  : '',
      });
      setEditingItem(true);
    } catch (err) {
      toast.error('Failed to load item: ' + err.message);
    }
  };

  const handleEditChange = (field, value) => {
    setEditForm(prev => {
      const updated = { ...prev, [field]: value };
      const gst  = Number(updated.gstPercent) || 0;
      const base = Number(updated.baseRate)    || 0;
      const incl = Number(updated.rateInclGST) || 0;

      // Auto-calculate rate including GST when base rate or GST% changes
      if ((field === 'baseRate' || field === 'gstPercent') && Number(updated.baseRate) > 0) {
        updated.rateInclGST = (Number(updated.baseRate) * (1 + gst / 100)).toFixed(2);
      }
      // Auto-calculate base rate when rate incl. GST changes (if GST% is known)
      if (field === 'rateInclGST' && incl > 0 && gst > 0) {
        updated.baseRate = (incl / (1 + gst / 100)).toFixed(2);
      }
      return updated;
    });
  };

  const handleSaveEdit = async () => {
    if (!editForm.rmId || !editForm.itemId) return toast.error('Missing item reference. Please reload and try again.');
    setIsSavingEdit(true);
    try {
      const dbUnit = toDBUnit(editForm.unit);
      const minStock = dbUnit === 'g' ? 1000 : dbUnit === 'ml' ? 5000 : 2;

      // Update rate_master
      const { error: rmErr } = await supabase
        .from('rate_master')
        .update({
          item_name:   editForm.itemName.trim(),
          category:    editForm.category,
          unit:        dbUnit,
          brand:       editForm.brand.trim() || null,
          supplier:    editForm.supplier.trim() || null,
          tender_year: editForm.tenderYear.trim() || null,
          gst_percent: Number(editForm.gstPercent) || 0,
          base_rate:   Number(editForm.baseRate)   || 0,
          unit_rate:   Number(editForm.rateInclGST) || 0,
          nos_per_kg:  editForm.nosPerKg !== '' ? Number(editForm.nosPerKg) : null,
          updated_at:  new Date().toISOString(),
        })
        .eq('id', editForm.rmId);
      if (rmErr) throw rmErr;

      // Update inventory_items
      const { error: iiErr } = await supabase
        .from('inventory_items')
        .update({
          name:           editForm.itemName.trim(),
          category:       editForm.category,
          unit:           dbUnit,
          min_stock_level: minStock,
        })
        .eq('id', editForm.itemId);
      if (iiErr) throw iiErr;

      toast.success('Item updated successfully!');
      setEditingItem(false);
      if (role === ROLES.ALS || role === ROLES.HKTL) {
        loadAllInventory();
      } else {
        fetchInventory(selectedStation.id);
      }
    } catch (err) {
      toast.error('Save failed: ' + err.message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Build display data
  const rawData = (role === ROLES.ALS || role === ROLES.HKTL) ? allStationsInventory : inventory;
  const isLoadingData = (role === ROLES.ALS || role === ROLES.HKTL) ? alsLoading : isLoading;

  let filteredData = rawData.filter((row) => {
    // Completely hide items before 2024-25 from the Inventory tab
    const tYearStr = row.tender_year || '';
    if (tYearStr.toLowerCase().includes('before 2024')) {
      return false;
    }
    const match = tYearStr.match(/^(\d{4})/);
    if (match && parseInt(match[1], 10) < 2024) {
      return false;
    }

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
      item_id: row.item_id,  // raw item_id for edit
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
      _zeroStock: rawStock === 0,
    };
  });

  // Sort display data: Tender Year (Desc) > Normal Stock > Low Stock > Zero Stock > Alphabetical
  displayData.sort((a, b) => {
    // 1. Sort by Tender Year descending
    const yearA = a.tender_year === '—' ? '' : (a.tender_year || '');
    const yearB = b.tender_year === '—' ? '' : (b.tender_year || '');
    if (yearA !== yearB) {
      return yearB.localeCompare(yearA); // e.g. "2025-26" comes before "2024-25"
    }

    // 2. Sort by Stock Level
    const getStockLevel = (item) => {
      if (item.current_stock <= 0) return 0; // Zero stock
      if (item.is_low) return 1;             // Low stock
      return 2;                              // Normal stock
    };
    
    const levelA = getStockLevel(a);
    const levelB = getStockLevel(b);
    
    if (levelA !== levelB) {
      return levelB - levelA; // 2 -> 1 -> 0
    }
    
    // 3. Alphabetical
    return (a.item_name || '').localeCompare(b.item_name || '');
  });

  const lowStockCount = (role === ROLES.ALS || role === ROLES.HKTL) ? 0 : displayData.filter((r) => r.is_low).length;

  const stationCodes = (role === ROLES.ALS || role === ROLES.HKTL)
    ? [...new Set(allStationsInventory.map((r) => r.station_code).filter(Boolean))].sort()
    : [];

  const columns = [
    { key: 'item_name', label: 'Item Name', sortable: true },
    { key: 'tender_year', label: 'Tender Year' },
    { key: 'brand_name', label: 'Brand Name' },
    { key: 'unit_rate', label: 'Rate (incl. GST)' },
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
    // Edit button — HKTL and SC at PNCU only
    ...(canEditMaster ? [{
      key: 'edit', label: 'Edit',
      render: (_, row) => (
        <button
          className="btn btn-ghost"
          style={{ padding: '4px 8px', color: 'var(--color-primary-600)', display: 'flex', alignItems: 'center', gap: '4px' }}
          onClick={() => handleEditClick(row.item_id)}
          title="Edit master item details"
        >
          <Pencil size={14} /> Edit
        </button>
      ),
    }] : []),
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
              <Button variant="outline" onClick={() => window.open('/stock-verification', '_blank')}>
                <ClipboardList size={14} /> Digital Stock Verification
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

      {/* Edit Master Item Modal — ALS only */}
      <Modal
        isOpen={editingItem}
        onClose={() => setEditingItem(false)}
        title="Edit Inventory Master Item"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingItem(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSaveEdit} isLoading={isSavingEdit}>Save Changes</Button>
          </>
        }
      >
        <Alert variant="info" style={{ marginBottom: 'var(--space-4)' }}>
          Only master item details (rates, GST, supplier etc.) are updated. Station stock quantities remain unchanged.
        </Alert>

        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {/* Item Name */}
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label form-label-required">Item Name</label>
            <input
              type="text"
              className="form-control"
              value={editForm.itemName}
              onChange={e => handleEditChange('itemName', e.target.value)}
            />
          </div>

          {/* Category */}
          <div className="form-group">
            <label className="form-label form-label-required">Category</label>
            <select className="form-control" value={editForm.category} onChange={e => handleEditChange('category', e.target.value)}>
              <option value="Consumable">Consumable</option>
              <option value="Chemical">Chemical</option>
            </select>
          </div>

          {/* Unit */}
          <div className="form-group">
            <label className="form-label form-label-required">Unit</label>
            <select className="form-control" value={editForm.unit} onChange={e => handleEditChange('unit', e.target.value)}>
              <option value="Nos">Nos (count)</option>
              <option value="Ltr">Ltr (stored as ml)</option>
              <option value="Kg">Kg (stored as g)</option>
            </select>
          </div>

          {/* Brand */}
          <div className="form-group">
            <label className="form-label">Brand</label>
            <input type="text" className="form-control" value={editForm.brand} onChange={e => handleEditChange('brand', e.target.value)} />
          </div>

          {/* Supplier */}
          <div className="form-group">
            <label className="form-label">Supplier</label>
            <input type="text" className="form-control" value={editForm.supplier} onChange={e => handleEditChange('supplier', e.target.value)} />
          </div>

          {/* Tender Year */}
          <div className="form-group">
            <label className="form-label">Tender Year</label>
            <input type="text" className="form-control" placeholder="e.g. 2024-25" value={editForm.tenderYear} onChange={e => handleEditChange('tenderYear', e.target.value)} />
          </div>

          {/* GST % */}
          <div className="form-group">
            <label className="form-label">GST %</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              className="form-control"
              placeholder="e.g. 18"
              value={editForm.gstPercent}
              onChange={e => handleEditChange('gstPercent', e.target.value)}
            />
          </div>

          {/* Base Rate */}
          <div className="form-group">
            <label className="form-label">Base Rate (ex-GST) ₹</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="form-control"
              placeholder="Auto-calculated"
              value={editForm.baseRate}
              onChange={e => handleEditChange('baseRate', e.target.value)}
            />
            <small style={{ color: 'var(--color-text-muted)' }}>
              Changes here auto-update Rate incl. GST
            </small>
          </div>

          {/* Rate incl. GST */}
          <div className="form-group">
            <label className="form-label form-label-required">Rate incl. GST ₹</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="form-control"
              placeholder="Rate per unit (billing rate)"
              value={editForm.rateInclGST}
              onChange={e => handleEditChange('rateInclGST', e.target.value)}
            />
            <small style={{ color: 'var(--color-text-muted)' }}>
              This is the rate used for billing (per {editForm.unit})
            </small>
          </div>

          {/* Nos per Kg — only for Nos items billed by weight (e.g. garbage covers) */}
          {editForm.unit === 'Nos' && (
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Nos per Kg <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(only for items billed by weight)</span></label>
              <input
                type="number"
                step="1"
                min="1"
                className="form-control"
                placeholder="Leave blank if billed per piece (Nos)"
                value={editForm.nosPerKg}
                onChange={e => handleEditChange('nosPerKg', e.target.value)}
                style={{ maxWidth: 240 }}
              />
              <small style={{ color: 'var(--color-text-muted)' }}>
                {editForm.nosPerKg
                  ? `Billing: ${editForm.nosPerKg} pieces = 1 Kg → Rate ₹${editForm.rateInclGST || '?'}/Kg`
                  : 'Example: Small garbage cover = 30 (30 Nos = 1 Kg at ₹45/Kg), Big = 10'}
              </small>
            </div>
          )}
        </div>

      </Modal>
    </Layout>
  );
}
