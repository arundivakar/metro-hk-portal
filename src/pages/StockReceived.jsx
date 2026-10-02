import React, { useEffect, useState } from 'react';
import { PackagePlus, Plus, Pencil, Trash2, ArrowLeftRight, Calendar, Warehouse, FileText, MessageSquare, Check, Package } from 'lucide-react';
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
import { toDisplayValue, getDisplayUnit, toBaseValue, toBillingQty } from '../utils/units';
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

  // Helper to create a new blank row for multi-item batch entry
  const createBlankBatchRow = () => ({
    id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
    item_id: '',
    quantity: '',
    unit_rate: '',
    remarks: '',
  });

  // Batch Stock Received state (entered once for the entire batch)
  const [batchHeader, setBatchHeader] = useState({
    received_date: today,
    source: 'KDS', // 'KDS' for Main Store KDS, 'DEPOT' for Depot
    invoice_number: '',
    remarks: '',
  });
  const [batchItems, setBatchItems] = useState([createBlankBatchRow()]);
  const [activeDropdownRowId, setActiveDropdownRowId] = useState(null);

  // Dedicated Inter-Station Transfer (IST) state
  const [showIstForm, setShowIstForm] = useState(false);
  const [istForm, setIstForm] = useState({
    item_id: '',
    quantity: '',
    received_date: today,
    source_station_id: '',
    unit_rate: '',
    remarks: '',
  });

  // Maps station_id → current_stock (base units) for the selected item
  const [stationStockMap, setStationStockMap] = useState({});

  const [showDepotForm, setShowDepotForm] = useState(false);
  const [showDepotAddForm, setShowDepotAddForm] = useState(false);
  const [depotLogs, setDepotLogs] = useState([]);
  const [depotLogsLoading, setDepotLogsLoading] = useState(false);
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
          .select('*, inventory_items(name,unit,rate_master(nos_per_kg)), stations!station_id(code,name), users_profile(full_name)')
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

        // Exclude Opening Stock entries in JS (avoids broken .or() Supabase filter syntax)
        const rawLogs = (logsRes.data ?? []).filter(
          (l) => l.supplier !== 'Opening Stock Initialization'
        );
        setAllLogs(rawLogs);
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

  // Batch Entry Row Handlers
  const handleAddBatchRow = () => {
    setBatchItems(prev => [...prev, createBlankBatchRow()]);
  };

  const handleRemoveBatchRow = (rowId) => {
    setBatchItems(prev => {
      if (prev.length <= 1) {
        return [createBlankBatchRow()];
      }
      return prev.filter(r => r.id !== rowId);
    });
  };

  const handleBatchItemChange = (rowId, itemId) => {
    const item = items.find(i => i.id === itemId);
    setBatchItems(prev => prev.map(row => {
      if (row.id !== rowId) return row;
      return {
        ...row,
        item_id: itemId,
        unit_rate: item?.rate_master?.unit_rate ?? '',
      };
    }));
  };

  const handleBatchFieldChange = (rowId, field, value) => {
    setBatchItems(prev => prev.map(row => {
      if (row.id !== rowId) return row;
      return { ...row, [field]: value };
    }));
  };

  const validateBatch = () => {
    if (!batchHeader.received_date) {
      return 'Received Date is required.';
    }

    if (!batchItems || batchItems.length === 0) {
      return 'Please add at least one item.';
    }

    for (let i = 0; i < batchItems.length; i++) {
      const row = batchItems[i];
      const rowNum = i + 1;

      if (!row.item_id) {
        return `Row ${rowNum}: Please select an item.`;
      }

      const qty = parseFloat(row.quantity);
      if (!row.quantity || isNaN(qty) || qty <= 0) {
        const selected = items.find(item => item.id === row.item_id);
        return `Row ${rowNum} (${selected?.name || 'Item'}): Please enter a valid quantity greater than zero.`;
      }

      if (row.unit_rate !== '' && (isNaN(parseFloat(row.unit_rate)) || parseFloat(row.unit_rate) < 0)) {
        return `Row ${rowNum}: Unit rate must be zero or positive.`;
      }
    }

    // Check for duplicate items in the same batch
    const seen = new Set();
    for (let i = 0; i < batchItems.length; i++) {
      if (seen.has(batchItems[i].item_id)) {
        const dupItem = items.find(it => it.id === batchItems[i].item_id);
        return `Duplicate item detected: "${dupItem?.name || 'Item'}" appears more than once. Please combine quantities into a single row.`;
      }
      seen.add(batchItems[i].item_id);
    }

    return null;
  };

  const totalBatchValue = batchItems.reduce((sum, row) => {
    const item = items.find(i => i.id === row.item_id);
    if (!item || !row.quantity || !row.unit_rate) return sum;
    const qty = parseFloat(row.quantity) || 0;
    const rate = parseFloat(row.unit_rate) || 0;
    const baseQty = toBaseValue(qty, item.unit || 'Nos');
    const billingQty = toBillingQty(baseQty, item.unit || 'Nos', item.rate_master?.nos_per_kg);
    return sum + (billingQty * rate);
  }, 0);

  const handleBatchSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const validationErr = validateBatch();
    if (validationErr) {
      setError(validationErr);
      return;
    }

    setSubmitting(true);
    try {
      const payloadArray = batchItems.map(row => {
        const item = items.find(i => i.id === row.item_id);
        const baseQty = toBaseValue(parseFloat(row.quantity), item?.unit || 'Nos');
        return {
          station_id:        selectedStation.id,
          item_id:           row.item_id,
          quantity:          baseQty,
          received_date:     batchHeader.received_date,
          invoice_number:    batchHeader.invoice_number?.trim() || null,
          source_station_id: null,
          supplier:          batchHeader.source === 'DEPOT' ? 'DEPOT' : (item?.rate_master?.supplier || 'KDS'),
          unit_rate:         row.unit_rate !== '' && !isNaN(parseFloat(row.unit_rate)) ? parseFloat(row.unit_rate) : null,
          remarks:           [batchHeader.remarks?.trim(), row.remarks?.trim()].filter(Boolean).join(' - ') || null,
          received_by:       profile.id,
        };
      });

      await bulkAddStockReceived(payloadArray);

      toast.success(`Successfully saved ${payloadArray.length} stock received ${payloadArray.length === 1 ? 'item' : 'items'}!`);
      setShowForm(false);
      setActiveDropdownRowId(null);
      setBatchHeader({ received_date: today, source: 'KDS', invoice_number: '', remarks: '' });
      setBatchItems([createBlankBatchRow()]);
      loadData();
    } catch (err) {
      setError('Failed to save entries: ' + (err.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  // Dedicated Inter-Station Transfer handlers
  const handleIstItemChange = async (val) => {
    const item = items.find((i) => i.id === val);
    setIstForm((f) => ({ 
      ...f, 
      item_id: val, 
      unit_rate: item?.rate_master?.unit_rate ?? '', 
      source_station_id: '', 
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

  const handleIstSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!istForm.item_id || !istForm.quantity || !istForm.received_date || !istForm.source_station_id) {
      setError('Item, source station, quantity, and date are required.');
      return;
    }

    const selectedIstItem = items.find(i => i.id === istForm.item_id);
    const baseQty = toBaseValue(parseFloat(istForm.quantity), selectedIstItem?.unit || 'Nos');

    if (!istForm.quantity || parseFloat(istForm.quantity) <= 0 || isNaN(parseFloat(istForm.quantity))) {
      setError('Quantity must be a positive number greater than zero.');
      return;
    }

    const srcAvail = stationStockMap[istForm.source_station_id] || 0;
    if (baseQty > srcAvail) {
      const dispUnit = getDisplayUnit(selectedIstItem?.unit || 'Nos');
      const availDisp = toDisplayValue(srcAvail, selectedIstItem?.unit || 'Nos');
      const availFmt = dispUnit === 'Nos'
        ? `${Math.round(availDisp)} Nos`
        : `${availDisp.toFixed(2)} ${dispUnit}`;
      setError(`Insufficient stock at source station. Available: ${availFmt}`);
      return;
    }

    setSubmitting(true);
    try {
      const { error: rpcErr } = await supabase.rpc('fn_inter_station_transfer', {
        p_source_station_id: istForm.source_station_id,
        p_dest_station_id:   selectedStation.id,
        p_item_id:           istForm.item_id,
        p_quantity:          baseQty,
        p_transfer_date:     istForm.received_date,
        p_dest_station_code: selectedStation.code,
        p_logged_by:         profile.id,
        p_remarks:           istForm.remarks || null,
        p_unit_rate:         istForm.unit_rate ? parseFloat(istForm.unit_rate) : null,
      });
      if (rpcErr) throw new Error(rpcErr.message);

      toast.success('Inter-station transfer completed!');
      setShowIstForm(false);
      setIstForm({ item_id: '', quantity: '', received_date: today, source_station_id: '', unit_rate: '', remarks: '' });
      setStationStockMap({});
      loadData();
    } catch (err) {
      setError(err.message.includes('Insufficient') ? err.message : 'Transfer failed: ' + err.message);
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
      supplier: log.supplier || log.stations?.code || '',
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
        p_remarks: editForm.remarks || null,
        p_new_supplier: editForm.supplier || null
      });
      if (err) throw err;
      toast.success('Stock received log updated!');
      setEditingLog(null);
      loadData();
    } catch (err) {
      if (err.message && err.message.includes('chk_stock_non_negative')) {
        setError("You cannot edit this entry because reducing the quantity would cause the physical stock to become negative. The item has likely already been consumed.");
      } else {
        setError(err.message);
      }
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
      if (err.message && err.message.includes('chk_stock_non_negative')) {
        toast.error("You cannot delete this entry because the physical stock will become negative. The item has already been consumed.", { duration: 5000 });
      } else {
        toast.error('Failed to delete: ' + err.message);
      }
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

  const loadDepotLogs = async () => {
    setDepotLogsLoading(true);
    try {
      const { data } = await supabase
        .from('consumption_logs')
        .select('*, inventory_items(name, unit), stations(code, name)')
        .like('remarks', 'Depot Transfer Out%')
        .order('consumption_date', { ascending: false })
        .limit(200);
      setDepotLogs(data ?? []);
    } catch (err) {
      console.error('Failed to load depot logs:', err);
    } finally {
      setDepotLogsLoading(false);
    }
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
      setShowDepotAddForm(false);
      setDepotForm({ source_station_id: '', item_id: '', quantity: '', transfer_date: today, destination: 'Depot', remarks: '' });
      setDepotItems([]);
      setDepotStockMap({});
      loadDepotLogs(); // refresh log
      loadData();
    } catch (err) {
      setError(err.message.includes('Insufficient') ? err.message : 'Transfer failed: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Stations that have stock > 0 for the selected IST item (used to filter source dropdown)
  const availableSourceStations = stations.filter(s => {
    if (s.id === selectedStation?.id) return false; // exclude self
    if (!istForm.item_id) return true;              // no item selected yet — show all
    return (stationStockMap[s.id] || 0) > 0;        // only stations with stock
  }).sort((a, b) => a.code.localeCompare(b.code));

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
      const nosPerKg = row.inventory_items?.rate_master?.nos_per_kg || null;
      const billingQty = toBillingQty(row.quantity, row.inventory_items?.unit || 'Nos', nosPerKg);
      return `₹${(billingQty * row.unit_rate).toFixed(2)}`;
    }},
    { key: 'source_station', label: 'Received From', render: (_, row) => {
        if (row.source_station_id) {
          const srcStation = stations.find(s => s.id === row.source_station_id);
          return srcStation ? `${srcStation.code} — ${srcStation.name}` : 'Other Station';
        }
        if (row.supplier === 'DEPOT') return '🏭 Depot';
        const legacyStation = stations.find(s => s.code.toLowerCase() === row.supplier?.trim().toLowerCase());
        if (legacyStation) {
          return `${legacyStation.code} — ${legacyStation.name}`;
        }
        return 'Main Store KDS';
    }},
    { key: 'invoice_number', label: 'Invoice #', render: (v) => v ?? '—' },
    { key: 'received_by', label: 'Received By', render: (_, row) => row.users_profile?.full_name ?? '—' },
    { 
      key: 'actions', 
      label: 'Actions', 
      render: (_, row) => {
        // Can only edit/delete if ALS or if SC owns the log
        const canAction = role === ROLES.ALS || (role === ROLES.SC && row.station_id === selectedStation?.id);
        if (!canAction) return null;

        if (row.source_station_id) {
          // Inter-station transfers can only be deleted, not edited
          return (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-ghost" style={{ padding: '4px', color: 'var(--color-danger-600)' }} onClick={() => handleDelete(row)} title="Delete Transfer (will restore source stock)">
                <Trash2 size={16} />
              </button>
            </div>
          );
        }

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
              <Button variant="outline" leftIcon={<ArrowLeftRight size={16} />} onClick={() => { setShowIstForm(true); setError(''); }}>
                Inter-Station Transfer
              </Button>
              <Button variant="accent" leftIcon={<PackagePlus size={16} />} onClick={() => { setShowForm(true); setError(''); }}>
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

      {/* Add Stock Received Multi-Item Batch Modal */}
      {role === ROLES.SC && (
      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setActiveDropdownRowId(null); setError(''); }}
        title="Add Stock Received"
        subtitle="Record multiple items received in a single delivery"
        icon={PackagePlus}
        size="xl"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '6px', 
                padding: '4px 10px', 
                borderRadius: 'var(--radius-full)', 
                background: 'var(--color-gray-100)', 
                border: '1px solid var(--color-gray-200)', 
                fontSize: '12px', 
                fontWeight: 600, 
                color: 'var(--color-gray-700)' 
              }}>
                <Package size={13} style={{ color: 'var(--color-primary-600)' }} />
                {batchItems.length} {batchItems.length === 1 ? 'item' : 'items'}
              </span>
              {totalBatchValue > 0 && (
                <span style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  padding: '4px 10px', 
                  borderRadius: 'var(--radius-full)', 
                  background: 'var(--color-primary-50)', 
                  border: '1px solid var(--color-primary-200)', 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: 'var(--color-primary-800)' 
                }}>
                  Total: ₹{totalBatchValue.toFixed(2)}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button variant="outline" onClick={() => { setShowForm(false); setActiveDropdownRowId(null); setError(''); }}>
                Cancel
              </Button>
              <Button variant="accent" onClick={handleBatchSubmit} isLoading={submitting} leftIcon={<Check size={16} />}>
                Confirm & Save All
              </Button>
            </div>
          </div>
        }
      >
        {error && <Alert variant="danger" style={{ marginBottom: '8px', flexShrink: 0 }}>{error}</Alert>}
        
        {/* Section 1: Common Batch Header (Ultra-Compact, ~120px max height) */}
        <div style={{ 
          background: 'var(--color-gray-50)', 
          border: '1px solid var(--color-gray-200)', 
          borderRadius: 'var(--radius-lg)', 
          padding: '8px 12px', 
          marginBottom: '10px',
          flexShrink: 0
        }}>
          <div style={{ 
            fontSize: '11px', 
            fontWeight: 700, 
            color: 'var(--color-primary-800)', 
            textTransform: 'uppercase', 
            letterSpacing: '0.05em', 
            marginBottom: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-primary-600)' }} />
            Batch Information
            <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--color-gray-500)', textTransform: 'none', letterSpacing: 'normal' }}>
              (Applied to all items in this delivery)
            </span>
          </div>

          {/* ROW 1: Date | Source | Invoice */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
            gap: '10px', 
            marginBottom: '6px' 
          }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label form-label-required" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--color-gray-700)', marginBottom: '3px' }}>
                <Calendar size={12} style={{ color: 'var(--color-primary-600)' }} /> Received Date
              </label>
              <input 
                type="date" 
                className="form-control" 
                style={{ height: '32px', fontSize: '12px', padding: '0 8px' }}
                value={batchHeader.received_date} 
                onChange={(e) => setBatchHeader(h => ({ ...h, received_date: e.target.value }))} 
                required 
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label form-label-required" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--color-gray-700)', marginBottom: '3px' }}>
                <Warehouse size={12} style={{ color: 'var(--color-primary-600)' }} /> Received From (Source)
              </label>
              <select 
                className="form-control" 
                style={{ height: '32px', fontSize: '12px', padding: '0 8px' }}
                value={batchHeader.source} 
                onChange={(e) => setBatchHeader(h => ({ ...h, source: e.target.value }))}
              >
                <option value="KDS">Main Store KDS</option>
                <option value="DEPOT">🏭 Depot</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--color-gray-700)', marginBottom: '3px' }}>
                <FileText size={12} style={{ color: 'var(--color-gray-500)' }} /> Invoice Number
              </label>
              <input 
                type="text" 
                className="form-control" 
                style={{ height: '32px', fontSize: '12px', padding: '0 8px' }}
                placeholder="Optional (e.g. INV-2026-001)" 
                value={batchHeader.invoice_number} 
                onChange={(e) => setBatchHeader(h => ({ ...h, invoice_number: e.target.value }))} 
              />
            </div>
          </div>

          {/* ROW 2: Batch Remarks */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--color-gray-700)', marginBottom: '3px' }}>
              <MessageSquare size={12} style={{ color: 'var(--color-gray-500)' }} /> Batch Remarks
            </label>
            <input 
              type="text" 
              className="form-control" 
              style={{ height: '30px', fontSize: '12px', padding: '0 8px' }}
              placeholder="Common remarks for all items in this delivery (optional)..." 
              value={batchHeader.remarks} 
              onChange={(e) => setBatchHeader(h => ({ ...h, remarks: e.target.value }))} 
            />
          </div>
        </div>

        {/* Section 2: Items Section (Scrollable main content area) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Header row with Items count & Add Another Item button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-gray-800)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Items
              </span>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-primary-700)', background: 'var(--color-primary-50)', border: '1px solid var(--color-primary-200)', borderRadius: 'var(--radius-full)', padding: '1px 8px' }}>
                {batchItems.length}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--color-gray-500)' }}>
                • Add items received in this delivery
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={handleAddBatchRow}
              style={{ fontWeight: 600, fontSize: '12px', padding: '4px 10px' }}
            >
              + Add Another Item
            </Button>
          </div>

          {/* Desktop Column Titles (Fixed above scrollable list) */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '28px minmax(260px, 3.2fr) minmax(130px, 1.2fr) minmax(110px, 1fr) minmax(140px, 1.5fr) 32px', 
            gap: '8px', 
            padding: '5px 10px', 
            fontSize: '11px', 
            fontWeight: 700, 
            color: 'var(--color-gray-500)',
            textTransform: 'uppercase', 
            letterSpacing: '0.05em', 
            borderBottom: '1px solid var(--color-gray-200)',
            flexShrink: 0,
            marginBottom: '6px'
          }}>
            <div style={{ textAlign: 'center' }}>#</div>
            <div>Item <span style={{ color: 'var(--color-danger-500)' }}>*</span></div>
            <div>Quantity <span style={{ color: 'var(--color-danger-500)' }}>*</span></div>
            <div>Unit Rate (₹)</div>
            <div>Remarks</div>
            <div></div>
          </div>

          {/* Scrollable Item Rows Container */}
          <div style={{ 
            flex: 1, 
            minHeight: 0, 
            overflowY: 'auto', 
            overflowX: 'visible',
            paddingRight: '4px', 
            paddingBottom: '260px', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '6px' 
          }}>
            {batchItems.map((row, index) => {
              const selectedRowItem = items.find(i => i.id === row.item_id);
              const dispUnit = selectedRowItem ? getDisplayUnit(selectedRowItem.unit) : '';

              return (
                <div 
                  key={row.id} 
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '28px minmax(260px, 3.2fr) minmax(130px, 1.2fr) minmax(110px, 1fr) minmax(140px, 1.5fr) 32px', 
                    gap: '8px', 
                    alignItems: 'center', 
                    padding: '6px 10px', 
                    borderRadius: 'var(--radius-md)', 
                    background: 'var(--color-white)', 
                    border: '1px solid var(--color-gray-200)', 
                    boxShadow: 'var(--shadow-xs)', 
                    position: 'relative', 
                    zIndex: activeDropdownRowId === row.id ? 100 : (batchItems.length - index + 10), 
                    flexShrink: 0 
                  }}
                >
                  {/* Row Number Badge */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <span style={{ 
                      width: '24px', 
                      height: '24px', 
                      borderRadius: 'var(--radius-sm)', 
                      background: 'var(--color-gray-100)', 
                      border: '1px solid var(--color-gray-200)', 
                      color: 'var(--color-gray-600)', 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontSize: '11px', 
                      fontWeight: 700, 
                      userSelect: 'none' 
                    }}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>

                  {/* Item selection */}
                  <div>
                    <SearchableSelect
                      options={items.map((i) => ({
                        value: i.id,
                        label: i.name,
                        sublabel: i.rate_master?.tender_year ? `Tender: ${i.rate_master.tender_year}` : null
                      }))}
                      value={row.item_id}
                      onChange={(val) => handleBatchItemChange(row.id, val)}
                      onOpenChange={(isOpen) => setActiveDropdownRowId(isOpen ? row.id : null)}
                      placeholder="Search & select item..."
                      required
                    />
                  </div>

                  {/* Quantity input with integrated unit badge */}
                  <div>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input 
                        type="number" 
                        min="0.001" 
                        step="any" 
                        className="form-control" 
                        placeholder="0.00"
                        style={{ 
                          paddingRight: dispUnit ? '48px' : '10px', 
                          height: '34px', 
                          fontSize: '13px' 
                        }}
                        value={row.quantity} 
                        onChange={(e) => handleBatchFieldChange(row.id, 'quantity', e.target.value)} 
                        required 
                      />
                      {dispUnit && (
                        <span style={{ 
                          position: 'absolute', 
                          right: '6px', 
                          fontSize: '11px', 
                          fontWeight: 700, 
                          color: 'var(--color-primary-700)', 
                          background: 'var(--color-primary-50)', 
                          border: '1px solid var(--color-primary-100)', 
                          padding: '2px 5px', 
                          borderRadius: 'var(--radius-sm)',
                          pointerEvents: 'none'
                        }}>
                          {dispUnit}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Unit Rate input with currency prefix */}
                  <div>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <span style={{ 
                        position: 'absolute', 
                        left: '8px', 
                        fontSize: '12px', 
                        fontWeight: 500, 
                        color: 'var(--color-gray-400)', 
                        pointerEvents: 'none' 
                      }}>
                        ₹
                      </span>
                      <input 
                        type="number" 
                        min="0" 
                        step="0.01" 
                        className="form-control" 
                        placeholder="0.00"
                        style={{ 
                          paddingLeft: '20px', 
                          height: '34px', 
                          fontSize: '13px' 
                        }}
                        value={row.unit_rate} 
                        onChange={(e) => handleBatchFieldChange(row.id, 'unit_rate', e.target.value)} 
                      />
                    </div>
                  </div>

                  {/* Row Remarks */}
                  <div>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="Remarks..." 
                      style={{ height: '34px', fontSize: '13px' }}
                      value={row.remarks} 
                      onChange={(e) => handleBatchFieldChange(row.id, 'remarks', e.target.value)} 
                    />
                  </div>

                  {/* Remove row button */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button 
                      type="button" 
                      className="btn btn-ghost" 
                      style={{ 
                        width: '30px', 
                        height: '30px', 
                        padding: 0, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        borderRadius: 'var(--radius-md)', 
                        color: 'var(--color-gray-400)',
                        transition: 'all var(--transition-fast)' 
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = 'var(--color-danger-600)';
                        e.currentTarget.style.background = 'var(--color-danger-50)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = 'var(--color-gray-400)';
                        e.currentTarget.style.background = 'transparent';
                      }}
                      onClick={() => handleRemoveBatchRow(row.id)}
                      title="Remove item"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Bottom Add Another Item Button */}
            <div style={{ marginTop: '2px', flexShrink: 0 }}>
              <Button 
                type="button" 
                variant="outline" 
                leftIcon={<Plus size={14} />} 
                onClick={handleAddBatchRow}
                style={{ 
                  width: '100%', 
                  borderStyle: 'dashed', 
                  borderColor: 'var(--color-gray-300)',
                  color: 'var(--color-primary-700)',
                  background: 'var(--color-gray-50)',
                  padding: '7px 14px', 
                  fontSize: '12px',
                  fontWeight: 600,
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-md)'
                }}
              >
                + Add Another Item
              </Button>
            </div>
          </div>
        </div>
      </Modal>
      )}

      {/* Inter-Station Transfer Modal (Dedicated Single-Item Workflow) */}
      {role === ROLES.SC && (
      <Modal
        isOpen={showIstForm}
        onClose={() => { setShowIstForm(false); setError(''); }}
        title="Inter-Station Transfer (Receive from Station)"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setShowIstForm(false); setError(''); }}>Cancel</Button>
            <Button variant="accent" form="ist-form" type="submit" isLoading={submitting}>
              Complete Transfer
            </Button>
          </>
        }
      >
        {error && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}
        <form id="ist-form" onSubmit={handleIstSubmit}>
          <div className="form-group">
            <label className="form-label form-label-required" htmlFor="ist-item">Search & Select Item</label>
            <SearchableSelect
              options={items.map((i) => ({
                value: i.id,
                label: i.name,
                sublabel: i.rate_master?.tender_year ? `Tender: ${i.rate_master.tender_year}` : null
              }))}
              value={istForm.item_id}
              onChange={handleIstItemChange}
              placeholder="Search items..."
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label form-label-required" htmlFor="ist-source">Source Station (Transfer From)</label>
            <select 
              id="ist-source" 
              className="form-control" 
              value={istForm.source_station_id}
              onChange={(e) => setIstForm(f => ({ ...f, source_station_id: e.target.value }))}
              required
            >
              <option value="">Select source station...</option>
              {availableSourceStations.map(s => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                  {istForm.item_id && stationStockMap[s.id] !== undefined ? ` (${(() => {
                    const selectedIstItem = items.find(i => i.id === istForm.item_id);
                    const unit = selectedIstItem?.unit || 'Nos';
                    const dispUnit = getDisplayUnit(unit);
                    const dispVal = toDisplayValue(stationStockMap[s.id] || 0, unit);
                    return dispUnit === 'Nos' ? `${Math.round(dispVal)} Nos` : `${dispVal.toFixed(2)} ${dispUnit}`;
                  })()})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Stock transfer stock-info alert */}
          {istForm.source_station_id && istForm.item_id && (() => {
            const selectedIstItem = items.find(i => i.id === istForm.item_id);
            const unit = selectedIstItem?.unit || 'Nos';
            const dispUnit = getDisplayUnit(unit);
            const raw = stationStockMap[istForm.source_station_id] || 0;
            const dispVal = toDisplayValue(raw, unit);
            const formatted = dispUnit === 'Nos' ? `${Math.round(dispVal)} Nos` : `${dispVal.toFixed(2)} ${dispUnit}`;
            const srcStation = stations.find(s => s.id === istForm.source_station_id);
            return (
              <Alert variant={raw > 0 ? 'info' : 'danger'} style={{ marginBottom: 'var(--space-3)' }}>
                {raw > 0
                  ? `✓ Available at ${srcStation?.code || 'source station'}: ${formatted} (This will be automatically deducted from ${srcStation?.code || 'source station'})`
                  : `⚠ No stock available at selected source station for this item.`}
              </Alert>
            );
          })()}

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="ist-qty">
                Quantity ({items.find(i => i.id === istForm.item_id) ? getDisplayUnit(items.find(i => i.id === istForm.item_id).unit) : 'Units'})
              </label>
              <input 
                id="ist-qty" 
                type="number" 
                min="0.001" 
                step="any" 
                className="form-control"
                value={istForm.quantity} 
                onChange={(e) => setIstForm((f) => ({ ...f, quantity: e.target.value }))} 
                required 
              />
            </div>
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="ist-date">Transfer Date</label>
              <input 
                id="ist-date" 
                type="date" 
                className="form-control"
                value={istForm.received_date} 
                onChange={(e) => setIstForm((f) => ({ ...f, received_date: e.target.value }))} 
                required 
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="ist-rate">Unit Rate (₹)</label>
            <input 
              id="ist-rate" 
              type="number" 
              min="0" 
              step="0.01" 
              className="form-control"
              value={istForm.unit_rate} 
              onChange={(e) => setIstForm((f) => ({ ...f, unit_rate: e.target.value }))} 
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="ist-remarks">Remarks</label>
            <textarea 
              id="ist-remarks" 
              className="form-control" 
              rows={2}
              placeholder="e.g. Emergency transfer"
              value={istForm.remarks} 
              onChange={(e) => setIstForm((f) => ({ ...f, remarks: e.target.value }))} 
            />
          </div>
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
              <p>
                <strong>Received From:</strong>{' '}
                {editingLog.source_station_id 
                  ? (stations.find(s => s.id === editingLog.source_station_id) 
                      ? `${stations.find(s => s.id === editingLog.source_station_id).code} — ${stations.find(s => s.id === editingLog.source_station_id).name}` 
                      : 'Station Transfer')
                  : editingLog.supplier === 'DEPOT' 
                    ? '🏭 Depot' 
                    : 'Main Store KDS'}
              </p>
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
