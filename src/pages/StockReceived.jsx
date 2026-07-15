import React, { useEffect, useState } from 'react';
import { PackagePlus, Plus, Pencil, Trash2 } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import SearchableSelect from '../components/ui/SearchableSelect';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { useInventory } from '../hooks/useInventory';
import { supabase } from '../lib/supabase';
import { ROLES, ALS_GROUPS, STATION_ORDER } from '../lib/constants';
import { toDisplayValue, getDisplayUnit, toBaseValue } from '../utils/units';
import { formatDate } from '../utils/dateHelpers';
import toast from 'react-hot-toast';

const today = new Date().toISOString().split('T')[0];

export default function StockReceived() {
  const { role, profile } = useAuthStore();
  const { selectedStation, alsGroupFilter } = useStationStore();
  const { addStockReceived, bulkAddStockReceived, fetchStockReceived, fetchInventoryItems, addNewCatalogueItem } = useInventory(selectedStation?.id);

  const [logs, setLogs] = useState([]);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showNewItemForm, setShowNewItemForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Month selection (same as Consumption Log)
  const todayDate = new Date();
  const currentMonthStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr);

  // Editing state
  const [editingLog, setEditingLog] = useState(null);
  const [editForm, setEditForm] = useState({ quantity: '', received_date: '', remarks: '' });

  // ALS station filter
  const [stations, setStations] = useState([]);
  const [alsStation, setAlsStation] = useState('All');
  const [allLogs, setAllLogs] = useState([]);

  const [form, setForm] = useState({
    item_id: '',
    quantity: '',
    received_date: today,
    invoice_number: '',
    source_station_id: '', // New field for Inter-station transfers
    supplier: '', // Fallback or KDS supplier name
    unit_rate: '',
    remarks: '',
  });

  // Maps station_id → current_stock (base units) for the selected item
  const [stationStockMap, setStationStockMap] = useState({});

  // ── Depot Transfer State (MUTT SC only) ─────────────────────────────────────
  const [showDepotForm, setShowDepotForm] = useState(false);
  const [depotForm, setDepotForm] = useState({
    source_station_id: '',
    item_id: '',
    quantity: '',
    transfer_date: today,
    destination: 'Depot', // 'Depot' or 'CCR'
    remarks: '',
  });
  const [depotStockMap, setDepotStockMap] = useState({});
  const [depotItems, setDepotItems] = useState([]);

  const [newItemForm, setNewItemForm] = useState({
    item_name: '', category: 'Consumable', unit: 'Nos', base_rate: '', gst_percent: '18', unit_rate: '', tender_year: '', brand: '', remarks: ''
  });

  useEffect(() => {
    loadData();
  }, [selectedStation?.id, role, alsGroupFilter, selectedMonth]); // eslint-disable-line

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [itemsData] = await Promise.all([fetchInventoryItems()]);
      setItems(itemsData);

      if (role === ROLES.ALS) {
        const [year, month] = selectedMonth.split('-');
        const startDate = `${year}-${month}-01`;
        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
        const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

        let logsQuery = supabase.from('stock_received')
          .select('*, inventory_items(name,unit), stations!inner(code,name), users_profile(full_name)')
          .or('supplier.neq.Opening Stock Initialization,supplier.is.null')
          .gte('received_date', startDate)
          .lte('received_date', endDate)
          .order('received_date', { ascending: false })
          .limit(500);
          
        const allowedStations = ALS_GROUPS[alsGroupFilter];
        if (allowedStations) {
          logsQuery = logsQuery.in('stations.code', allowedStations);
        }

        const [logsRes, stationsRes] = await Promise.all([
          logsQuery,
          supabase.from('stations').select('id,code,name').eq('is_active', true),
        ]);
        setAllLogs(logsRes.data ?? []);
        const sortedStations = (stationsRes.data ?? []).sort((a, b) => {
          const indexA = STATION_ORDER.indexOf(a.code);
          const indexB = STATION_ORDER.indexOf(b.code);
          return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
        });
        setStations(sortedStations);
      } else if (selectedStation?.id) {
        const [year, month] = selectedMonth.split('-');
        const startDate = `${year}-${month}-01`;
        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
        const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
        const data = await fetchStockReceived(selectedStation.id, { from: startDate, to: endDate });
        setLogs(data);
        const stationsRes = await supabase.from('stations').select('id,code,name').eq('is_active', true);
        const sortedStations = (stationsRes.data ?? []).sort((a, b) => {
          const indexA = STATION_ORDER.indexOf(a.code);
          const indexB = STATION_ORDER.indexOf(b.code);
          return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
        });
        setStations(sortedStations);

      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.item_id || !form.quantity || !form.received_date) {
      setError('Item, quantity and date are required.');
      return;
    }

    const isTransfer = !!form.source_station_id;
    const baseQty = toBaseValue(parseFloat(form.quantity), selectedItem?.unit || 'Nos');

    // Validate stock availability for inter-station transfer
    if (isTransfer) {
      const srcAvail = stationStockMap[form.source_station_id] || 0;
      if (baseQty > srcAvail) {
        const dispUnit = getDisplayUnit(selectedItem?.unit || 'Nos');
        const availDisp = toDisplayValue(srcAvail, selectedItem?.unit || 'Nos');
        const availFmt = dispUnit === 'Nos'
          ? `${Math.round(availDisp)} Nos`
          : `${availDisp.toFixed(2)} ${dispUnit}`;
        setError(`Insufficient stock at source station. Available: ${availFmt}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isTransfer) {
        // Inter-station transfer: use the atomic SECURITY DEFINER RPC.
        // This single call handles BOTH the destination receipt AND the source deduction
        // inside one Postgres transaction, bypassing RLS for cross-station writes.
        const { error: rpcErr } = await supabase.rpc('fn_inter_station_transfer', {
          p_source_station_id: form.source_station_id,
          p_dest_station_id:   selectedStation.id,
          p_item_id:           form.item_id,
          p_quantity:          baseQty,
          p_transfer_date:     form.received_date,
          p_dest_station_code: selectedStation.code,
          p_logged_by:         profile.id,
          p_remarks:           form.remarks || null,
          p_unit_rate:         form.unit_rate ? parseFloat(form.unit_rate) : null,
        });
        if (rpcErr) throw new Error(rpcErr.message);
      } else {
        // Normal KDS / external supplier receipt — unchanged
        await addStockReceived({
          station_id:        selectedStation.id,
          item_id:           form.item_id,
          quantity:          baseQty,
          received_date:     form.received_date,
          invoice_number:    form.invoice_number || null,
          source_station_id: null,
          supplier:          form.supplier || 'KDS',
          unit_rate:         form.unit_rate ? parseFloat(form.unit_rate) : null,
          remarks:           form.remarks || null,
          received_by:       profile.id,
        });
      }

      toast.success(isTransfer ? 'Inter-station transfer completed!' : 'Stock received entry added successfully!');
      setShowForm(false);
      const resetForm = { item_id: '', quantity: '', received_date: today, invoice_number: '', source_station_id: '', supplier: '', unit_rate: '', remarks: '' };
      setForm(resetForm);
      setStationStockMap({});
      loadData();
    } catch (err) {
      setError(err.message.includes('Insufficient') ? err.message : 'Failed to save entry: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddNewItem = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await addNewCatalogueItem({
        ...newItemForm,
        base_rate: parseFloat(newItemForm.base_rate) || 0,
        gst_percent: parseFloat(newItemForm.gst_percent) || 0,
        unit_rate: parseFloat(newItemForm.unit_rate) || 0
      });
      toast.success('New item added to master catalogue!');
      setShowNewItemForm(false);
      setNewItemForm({ item_name: '', category: 'Consumable', unit: 'Nos', base_rate: '', gst_percent: '18', unit_rate: '', tender_year: '', brand: '', remarks: '' });
      loadData(); // Refresh the items list
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (log) => {
    setEditingLog(log);
    setEditForm({
      quantity: log.quantity,
      received_date: log.received_date,
      remarks: log.remarks || ''
    });
    setError('');
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const { error: err } = await supabase.rpc('fn_edit_stock_received', {
        p_log_id: editingLog.id,
        p_new_quantity: parseFloat(editForm.quantity),
        p_new_date: editForm.received_date,
        p_remarks: editForm.remarks || null
      });
      if (err) throw err;
      toast.success('Stock received log updated!');
      setEditingLog(null);
      loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (log) => {
    if (!window.confirm('Are you sure you want to delete this log? Physical stock will be deducted accordingly.')) return;
    try {
      const { error: err } = await supabase.rpc('fn_delete_stock_received', { p_log_id: log.id });
      if (err) throw err;
      toast.success('Log deleted successfully.');
      loadData();
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    }
  };

  const selectedItem = items.find((i) => i.id === form.item_id);

  // Fetch per-station stock when item changes, to power source dropdown filtering
  const handleItemChange = async (val) => {
    const item = items.find((i) => i.id === val);
    setForm((f) => ({ 
      ...f, 
      item_id: val, 
      unit_rate: item?.rate_master?.unit_rate ?? '', 
      source_station_id: '', 
      supplier: item?.rate_master?.supplier || 'KDS',
      quantity: '' 
    }));
    if (val) {
      const { data } = await supabase
        .from('v_station_inventory_summary')
        .select('station_id, current_stock')
        .eq('item_id', val);
      const map = {};
      (data || []).forEach(r => { map[r.station_id] = Number(r.current_stock || 0); });
      setStationStockMap(map);
    } else {
      setStationStockMap({});
    }
  };

  // Depot Transfer: fetch item stock when source station changes
  const handleDepotStationChange = async (stationId) => {
    setDepotForm(f => ({ ...f, source_station_id: stationId, item_id: '', quantity: '' }));
    setDepotItems([]);
    setDepotStockMap({});
    if (!stationId) return;
    // Use the existing summary view which correctly joins station_inventory + inventory_items
    const { data } = await supabase
      .from('v_station_inventory_summary')
      .select('item_id, item_name, unit, current_stock')
      .eq('station_id', stationId)
      .gt('current_stock', 0)
      .order('item_name');
    const map = {};
    const itemList = [];
    (data || []).forEach(r => {
      map[r.item_id] = r.current_stock;
      itemList.push({ id: r.item_id, name: r.item_name, unit: r.unit });
    });
    setDepotStockMap(map);
    setDepotItems(itemList);
  };

  const handleDepotTransferSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!depotForm.source_station_id || !depotForm.item_id || !depotForm.quantity || !depotForm.transfer_date) {
      setError('All fields are required.');
      return;
    }
    const depotItem = depotItems.find(i => i.id === depotForm.item_id);
    const baseQty = toBaseValue(parseFloat(depotForm.quantity), depotItem?.unit || 'Nos');
    const srcAvail = depotStockMap[depotForm.item_id] || 0;
    if (baseQty > srcAvail) {
      const dispUnit = getDisplayUnit(depotItem?.unit || 'Nos');
      const availDisp = toDisplayValue(srcAvail, depotItem?.unit || 'Nos');
      const availFmt = dispUnit === 'Nos' ? `${Math.round(availDisp)} Nos` : `${availDisp.toFixed(2)} ${dispUnit}`;
      setError(`Insufficient stock at source station. Available: ${availFmt}`);
      return;
    }
    const sourceStation = stations.find(s => s.id === depotForm.source_station_id);
    setSubmitting(true);
    try {
      const { error: rpcErr } = await supabase.rpc('fn_transfer_to_depot', {
        p_source_station_id:   depotForm.source_station_id,
        p_item_id:             depotForm.item_id,
        p_quantity:            baseQty,
        p_transfer_date:       depotForm.transfer_date,
        p_source_station_code: sourceStation?.code || '',
        p_logged_by:           profile.id,
        p_remarks:             `to ${depotForm.destination}${depotForm.remarks ? ' - ' + depotForm.remarks : ''}`,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      toast.success(`Stock from ${sourceStation?.code} transferred to ${depotForm.destination} successfully!`);
      setShowDepotForm(false);
      setDepotForm({ source_station_id: '', item_id: '', quantity: '', transfer_date: today, destination: 'Depot', remarks: '' });
      setDepotItems([]);
      setDepotStockMap({});
    } catch (err) {
      setError(err.message.includes('Insufficient') ? err.message : 'Transfer failed: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Stations that have stock > 0 for the selected item (used to filter source dropdown)
  const availableSourceStations = stations.filter(s => {
    if (s.id === selectedStation?.id) return false; // exclude self
    if (!form.item_id) return true;                  // no item selected yet — show all
    return (stationStockMap[s.id] || 0) > 0;         // only stations with stock
  });

  const allowedStations = ALS_GROUPS[alsGroupFilter];

  const displayLogs = role === ROLES.ALS
    ? (alsStation === 'All' ? allLogs : allLogs.filter((l) => l.stations?.code === alsStation))
      .filter((l) => !allowedStations || allowedStations.includes(l.stations?.code))
    : logs;

  const columns = [
    ...(role === ROLES.ALS ? [{ key: 'station', label: 'Station', render: (_, row) => row.stations?.code ?? '—' }] : []),
    { key: 'received_date', label: 'Date', sortable: true, render: (v) => formatDate(v) },
    { key: 'item', label: 'Item', render: (_, row) => row.inventory_items?.name ?? '—' },
    { key: 'quantity', label: 'Qty Received', render: (_, row) => {
      const dispUnit = getDisplayUnit(row.inventory_items?.unit || 'Nos');
      const dispVal = toDisplayValue(row.quantity, row.inventory_items?.unit || 'Nos');
      return dispUnit === 'Nos' ? `${Math.round(dispVal)} Nos` : `${dispVal.toFixed(2)} ${dispUnit}`;
    }},
    { key: 'unit_rate', label: 'Unit Rate', render: (v) => v ? `₹${Number(v).toFixed(2)}` : '—' },
    { key: 'total_value', label: 'Total Value', render: (_, row) => {
      if (!row.unit_rate) return '—';
      const dispQty = toDisplayValue(row.quantity, row.inventory_items?.unit || 'Nos');
      return `₹${(dispQty * row.unit_rate).toFixed(2)}`;
    }},
    { key: 'source_station', label: 'Received From', render: (_, row) => {
        if (row.source_station_id) {
          const srcStation = stations.find(s => s.id === row.source_station_id);
          return srcStation ? `${srcStation.code}` : 'Other Station';
        }
        if (row.supplier === 'DEPOT') return '🏭 Depot';
        return row.supplier || 'KDS';
    }},
    { key: 'invoice_number', label: 'Invoice #', render: (v) => v ?? '—' },
    { key: 'received_by', label: 'Received By', render: (_, row) => row.users_profile?.full_name ?? '—' },
    { 
      key: 'actions', 
      label: 'Actions', 
      render: (_, row) => {
        // Can only edit if ALS or if SC owns the log
        const canEdit = role === ROLES.ALS || (role === ROLES.SC && row.station_id === selectedStation?.id);
        if (!canEdit) return null;
        return (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-ghost" style={{ padding: '4px', color: 'var(--color-primary-600)' }} onClick={() => handleEdit(row)} title="Edit">
              <Pencil size={16} />
            </button>
            <button className="btn btn-ghost" style={{ padding: '4px', color: 'var(--color-danger-600)' }} onClick={() => handleDelete(row)} title="Delete">
              <Trash2 size={16} />
            </button>
          </div>
        );
      }
    }
  ];

  const tableData = displayLogs.map((r) => ({ ...r, id: r.id }));

  return (
    <Layout
      title="Stock Received"
      subtitle={role === ROLES.ALS ? 'All stations' : selectedStation?.name}
      actions={
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ fontSize: '13px', fontWeight: 600 }}>Select Month:</label>
          <input
            type="month"
            className="form-control"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
          />
          {selectedStation?.code === 'PNCU' && (
            <Button variant="outline" leftIcon={<Plus size={16} />} onClick={() => setShowNewItemForm(true)}>
              Add New Catalogue Item
            </Button>
          )}
          {role === ROLES.SC && (
            <>
              {selectedStation?.code === 'MUTT' && (
                <Button
                  variant="outline"
                  leftIcon={<PackagePlus size={16} />}
                  onClick={() => { setShowDepotForm(true); setError(''); }}
                  style={{ borderColor: 'var(--color-warning-400)', color: 'var(--color-warning-700)' }}
                >
                  Ext. Transfer
                </Button>
              )}
              <Button variant="accent" leftIcon={<PackagePlus size={16} />} onClick={() => setShowForm(true)}>
                Receive Stock
              </Button>
            </>
          )}
        </div>
      }
    >
      {role === ROLES.ALS && (
        <div className="filter-bar" style={{ marginBottom: 'var(--space-4)' }}>
          <select className="form-control" style={{ width: 'auto' }} value={alsStation} onChange={(e) => setAlsStation(e.target.value)}>
            <option value="All">All Stations</option>
            {stations.filter(s => !allowedStations || allowedStations.includes(s.code)).map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
          </select>
        </div>
      )}

      <Card>
        <CardHeader title="Stock Received Log" icon={<PackagePlus size={16} />} subtitle={`${tableData.length} records`} />
        <DataTable
          columns={columns}
          data={tableData}
          isLoading={isLoading}
          emptyTitle="No stock received records"
          emptyDesc="Stock received entries will appear here once added."
          emptyIcon={<PackagePlus size={28} />}
        />
      </Card>

      {/* Add Stock Received Modal */}
      {role === ROLES.SC && (
      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setError(''); }}
        title="Add Stock Received"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="accent" form="stock-form" type="submit" isLoading={submitting}>
              Save Entry
            </Button>
          </>
        }
      >
        {error && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}
        <form id="stock-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label form-label-required" htmlFor="sr-item">Search & Select Item</label>
            <SearchableSelect
              options={items.map((i) => ({
                value: i.id,
                label: i.name,
                sublabel: i.rate_master?.tender_year ? `Tender: ${i.rate_master.tender_year}` : null
              }))}
              value={form.item_id}
              onChange={handleItemChange}
              placeholder="Search items..."
              required
            />
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="sr-qty">Quantity ({selectedItem ? getDisplayUnit(selectedItem.unit) : 'Units'})</label>
              <input id="sr-qty" type="number" min="0.001" step="any" className="form-control"
                value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="sr-date">Received Date</label>
              <input id="sr-date" type="date" className="form-control"
                value={form.received_date} onChange={(e) => setForm((f) => ({ ...f, received_date: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="sr-invoice">Invoice Number</label>
              <input id="sr-invoice" type="text" className="form-control"
                value={form.invoice_number} onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="sr-rate">Unit Rate (₹)</label>
              <input id="sr-rate" type="number" min="0" step="0.01" className="form-control"
                value={form.unit_rate} onChange={(e) => setForm((f) => ({ ...f, unit_rate: e.target.value }))} />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="sr-source">Received From (Source)</label>
              <select id="sr-source" className="form-control" value={form.source_station_id}
                onChange={(e) => setForm(f => ({ ...f, source_station_id: e.target.value, supplier: e.target.value === '' ? (selectedItem?.rate_master?.supplier || 'KDS') : e.target.value === 'DEPOT' ? 'DEPOT' : '', quantity: '' }))}>
                <option value="">Main Store (KDS / Supplier)</option>
                <option value="DEPOT">🏭 Depot</option>
                <optgroup label="Inter-Station Transfer">
                  {availableSourceStations.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                      {form.item_id && stationStockMap[s.id] !== undefined ? ` (${(() => {
                        const unit = selectedItem?.unit || 'Nos';
                        const dispUnit = getDisplayUnit(unit);
                        const dispVal = toDisplayValue(stationStockMap[s.id] || 0, unit);
                        return dispUnit === 'Nos' ? `${Math.round(dispVal)} Nos` : `${dispVal.toFixed(2)} ${dispUnit}`;
                      })()})` : ''}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            {(form.source_station_id === '' || form.source_station_id === 'DEPOT') && (
              <div className="form-group">
                <label className="form-label" htmlFor="sr-supplier">External Supplier Name</label>
                <input id="sr-supplier" type="text" className="form-control" placeholder="Optional"
                  value={form.supplier} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} />
              </div>
            )}
            {/* Stock transfer stock-info alert: only for inter-station, not DEPOT */}
            {form.source_station_id && form.source_station_id !== 'DEPOT' && selectedItem && (() => {
            const unit = selectedItem.unit || 'Nos';
            const dispUnit = getDisplayUnit(unit);
            const raw = stationStockMap[form.source_station_id] || 0;
            const dispVal = toDisplayValue(raw, unit);
            const formatted = dispUnit === 'Nos' ? `${Math.round(dispVal)} Nos` : `${dispVal.toFixed(2)} ${dispUnit}`;
            return (
              <Alert variant={raw > 0 ? 'info' : 'danger'} style={{ marginBottom: 'var(--space-3)' }}>
                {raw > 0
                  ? `✓ Available at source: ${formatted}`
                  : `⚠ No stock available at selected source station for this item.`}
              </Alert>
            );
          })()}
          </div>
          {selectedItem && form.quantity && form.unit_rate && (
            <Alert variant="info" style={{ marginBottom: 'var(--space-3)' }}>
              Total Value: ₹{(parseFloat(form.quantity) * parseFloat(form.unit_rate)).toFixed(2)}
            </Alert>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="sr-remarks">Remarks</label>
            <textarea id="sr-remarks" className="form-control" rows={2}
              value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </div>
        </form>
      </Modal>
      )}

      {/* MUTT SC ONLY: External Transfer Modal (Depot / CCR) */}
      {selectedStation?.code === 'MUTT' && role === ROLES.SC && (
      <Modal
        isOpen={showDepotForm}
        onClose={() => { setShowDepotForm(false); setError(''); }}
        title="External Location Transfer"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setShowDepotForm(false); setError(''); }}>Cancel</Button>
            <Button variant="warning" form="depot-form" type="submit" isLoading={submitting}>Confirm Transfer</Button>
          </>
        }
      >
        <Alert variant="warning" style={{ marginBottom: 'var(--space-4)' }}>
          <strong>External Transfer:</strong> Stock will be deducted from the selected station. This creates an audit log and <strong>does not affect billing</strong>.
        </Alert>
        {error && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}
        <form id="depot-form" onSubmit={handleDepotTransferSubmit}>
          {/* Destination selector */}
          <div className="form-group">
            <label className="form-label form-label-required">Destination</label>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '4px' }}>
              {['Depot', 'CCR'].map(dest => (
                <label key={dest} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: depotForm.destination === dest ? 700 : 400 }}>
                  <input type="radio" name="ext-destination" value={dest}
                    checked={depotForm.destination === dest}
                    onChange={() => setDepotForm(f => ({ ...f, destination: dest }))}
                  />
                  {dest === 'Depot' ? '🏭 Depot' : '🏢 CCR'}
                </label>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label form-label-required">Source Station (Stock Coming From)</label>
            <select className="form-control" value={depotForm.source_station_id}
              onChange={(e) => handleDepotStationChange(e.target.value)} required>
              <option value="">— Select Station —</option>
              {stations.filter(s => s.id !== selectedStation?.id).map(s => (
                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
              ))}
            </select>
          </div>
          {depotForm.source_station_id && (
            <div className="form-group">
              <label className="form-label form-label-required">Item</label>
              <select className="form-control" value={depotForm.item_id}
                onChange={(e) => setDepotForm(f => ({ ...f, item_id: e.target.value, quantity: '' }))} required>
                <option value="">— Select Item —</option>
                {depotItems.map(i => {
                  const dispUnit = getDisplayUnit(i.unit);
                  const raw = depotStockMap[i.id] || 0;
                  const dispVal = toDisplayValue(raw, i.unit);
                  const fmt = dispUnit === 'Nos' ? `${Math.round(dispVal)} Nos` : `${dispVal.toFixed(2)} ${dispUnit}`;
                  return <option key={i.id} value={i.id}>{i.name} (Stock: {fmt})</option>;
                })}
              </select>
              {depotItems.length === 0 && <small style={{ color: 'var(--color-warning-600)' }}>No items with stock found at this station.</small>}
            </div>
          )}
          {depotForm.item_id && (() => {
            const depotItem = depotItems.find(i => i.id === depotForm.item_id);
            const unit = depotItem?.unit || 'Nos';
            const dispUnit = getDisplayUnit(unit);
            const raw = depotStockMap[depotForm.item_id] || 0;
            const dispVal = toDisplayValue(raw, unit);
            const fmt = dispUnit === 'Nos' ? `${Math.round(dispVal)} Nos` : `${dispVal.toFixed(2)} ${dispUnit}`;
            return (
              <>
                <Alert variant="info" style={{ marginBottom: 'var(--space-3)' }}>Available at source: <strong>{fmt}</strong></Alert>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label form-label-required">Quantity ({dispUnit})</label>
                    <input type="number" min="0.001" step="any" className="form-control"
                      value={depotForm.quantity} onChange={(e) => setDepotForm(f => ({ ...f, quantity: e.target.value }))} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label form-label-required">Transfer Date</label>
                    <input type="date" className="form-control"
                      value={depotForm.transfer_date} onChange={(e) => setDepotForm(f => ({ ...f, transfer_date: e.target.value }))} required />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Remarks (Optional)</label>
                  <textarea className="form-control" rows={2}
                    value={depotForm.remarks} onChange={(e) => setDepotForm(f => ({ ...f, remarks: e.target.value }))} />
                </div>
              </>
            );
          })()}
        </form>
      </Modal>
      )}

      {/* PNCU ONLY: Add New Master Item Modal */}
      {selectedStation?.code === 'PNCU' && (
      <Modal
        isOpen={showNewItemForm}
        onClose={() => { setShowNewItemForm(false); setError(''); }}
        title="Add New Catalogue Item"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowNewItemForm(false)}>Cancel</Button>
            <Button variant="primary" form="new-item-form" type="submit" isLoading={submitting}>
              Add to Master Catalogue
            </Button>
          </>
        }
      >
        <Alert variant="warning" style={{ marginBottom: 'var(--space-4)' }}>
          <strong>PNCU Admin Feature:</strong> Items added here will immediately become available in the dropdown for <strong>all 25 stations</strong> to use.
        </Alert>
        {error && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}
        
        <form id="new-item-form" onSubmit={handleAddNewItem}>
          <div className="form-group">
            <label className="form-label form-label-required" htmlFor="ni-name">Item Name</label>
            <input id="ni-name" type="text" className="form-control" placeholder="e.g. Toilet Bowl Cleaner"
              value={newItemForm.item_name} onChange={(e) => setNewItemForm(f => ({ ...f, item_name: e.target.value }))} required />
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="ni-cat">Category</label>
              <select id="ni-cat" className="form-control" value={newItemForm.category} 
                onChange={(e) => setNewItemForm(f => ({ ...f, category: e.target.value }))} required>
                <option value="Chemical">Chemical</option>
                <option value="Consumable">Consumable</option>
                <option value="Disposable">Disposable</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="ni-unit">Unit</label>
              <select id="ni-unit" className="form-control" value={newItemForm.unit} 
                onChange={(e) => setNewItemForm(f => ({ ...f, unit: e.target.value }))} required>
                <option value="Nos">Nos (Numbers)</option>
                <option value="Kg">Kg</option>
                <option value="Ltr">Ltr</option>
                <option value="Pkt">Pkt</option>
                <option value="Roll">Roll</option>
                <option value="Set">Set</option>
              </select>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="ni-base-rate">Base Price (₹)</label>
              <input id="ni-base-rate" type="number" min="0" step="0.01" className="form-control"
                value={newItemForm.base_rate} 
                onChange={(e) => {
                  const br = parseFloat(e.target.value) || 0;
                  const gst = parseFloat(newItemForm.gst_percent) || 0;
                  const ur = (br + (br * gst / 100)).toFixed(2);
                  setNewItemForm(f => ({ ...f, base_rate: e.target.value, unit_rate: ur }));
                }} 
                required 
              />
            </div>
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="ni-gst">GST (%)</label>
              <input id="ni-gst" type="number" min="0" step="0.01" className="form-control"
                value={newItemForm.gst_percent} 
                onChange={(e) => {
                  const gst = parseFloat(e.target.value) || 0;
                  const br = parseFloat(newItemForm.base_rate) || 0;
                  const ur = (br + (br * gst / 100)).toFixed(2);
                  setNewItemForm(f => ({ ...f, gst_percent: e.target.value, unit_rate: ur }));
                }} 
                required 
              />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="ni-rate">Final Price with GST (₹)</label>
              <input id="ni-rate" type="number" className="form-control"
                value={newItemForm.unit_rate} readOnly style={{ backgroundColor: 'var(--color-gray-100)' }} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="ni-tender">Tender Year</label>
              <input id="ni-tender" type="text" className="form-control" placeholder="e.g. 2025-26"
                value={newItemForm.tender_year} onChange={(e) => setNewItemForm(f => ({ ...f, tender_year: e.target.value }))} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="ni-brand">Brand</label>
            <input id="ni-brand" type="text" className="form-control" placeholder="e.g. Taski"
              value={newItemForm.brand} onChange={(e) => setNewItemForm(f => ({ ...f, brand: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ni-remarks">Remarks</label>
            <textarea id="ni-remarks" className="form-control" rows={2}
              value={newItemForm.remarks} onChange={(e) => setNewItemForm(f => ({ ...f, remarks: e.target.value }))} />
          </div>
        </form>
      </Modal>
      )}

      {/* Edit Log Modal */}
      <Modal
        isOpen={!!editingLog}
        onClose={() => setEditingLog(null)}
        title="Edit Stock Received Log"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingLog(null)}>Cancel</Button>
            <Button variant="accent" form="edit-log-form" type="submit" isLoading={submitting}>
              Save Changes
            </Button>
          </>
        }
      >
        {editingLog && (
          <form id="edit-log-form" onSubmit={handleSaveEdit}>
            {error && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}
            <div style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>
              <p><strong>Item:</strong> {editingLog.inventory_items?.name}</p>
              <p><strong>Original Quantity:</strong> {editingLog.quantity}</p>
            </div>
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="el-qty">New Quantity</label>
              <input id="el-qty" type="number" min="0.001" step="any" className="form-control"
                value={editForm.quantity} onChange={(e) => setEditForm(f => ({ ...f, quantity: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="el-date">Received Date</label>
              <input id="el-date" type="date" className="form-control"
                value={editForm.received_date} onChange={(e) => setEditForm(f => ({ ...f, received_date: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="el-remarks">Remarks</label>
              <textarea id="el-remarks" className="form-control" rows={2}
                value={editForm.remarks} onChange={(e) => setEditForm(f => ({ ...f, remarks: e.target.value }))} />
            </div>
          </form>
        )}
      </Modal>
    </Layout>
  );
}
