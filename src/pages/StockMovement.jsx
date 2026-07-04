import React, { useEffect, useState, useMemo } from 'react';
import { toDisplayValue, getDisplayUnit } from '../utils/units';
import { TrendingDown, Calendar, FileText, Calculator, History, Pencil, Trash2 } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { useInventory } from '../hooks/useInventory';
import { supabase } from '../lib/supabase';
import { ROLES, ALS_GROUPS } from '../lib/constants';
import { generateMonthlyBillPdf } from '../lib/pdfGenerator';
import { formatDate } from '../utils/dateHelpers';
import toast from 'react-hot-toast';

export default function StockMovement() {
  const { role, profile } = useAuthStore();
  const { selectedStation, alsGroupFilter } = useStationStore();
  const { logConsumption, fetchInventoryItems } = useInventory(selectedStation?.id);

  const [items, setItems] = useState([]);
  const [currentStock, setCurrentStock] = useState([]);
  const [receivedLogs, setReceivedLogs] = useState([]);
  const [consumptionLogs, setConsumptionLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Month Selection
  const today = new Date();
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr);

  // Modals
  const [showConsumptionForm, setShowConsumptionForm] = useState(false);
  const [selectedItemForAction, setSelectedItemForAction] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  const [activeTab, setActiveTab] = useState('aggregate'); // 'aggregate' or 'history'

  // Editing state for history logs
  const [editingLog, setEditingLog] = useState(null);
  const [editForm, setEditForm] = useState({ quantity_used: '', consumption_date: '', remarks: '' });
  
  // Filter for history logs
  const [historyItemFilter, setHistoryItemFilter] = useState('All');
  
  // Search filter for aggregate table
  const [searchTerm, setSearchTerm] = useState('');

  // Form States
  const [formQty, setFormQty] = useState('');
  const [formDate, setFormDate] = useState(today.toISOString().split('T')[0]);
  const [formRemarks, setFormRemarks] = useState('');

  // Bill Generation
  const [showBillModal, setShowBillModal] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedStation?.id, selectedMonth, role]); // eslint-disable-line

  const loadData = async () => {
    if (role !== ROLES.SC && role !== ROLES.ALS) return;
    setIsLoading(true);
    try {
      const itemsData = await fetchInventoryItems();
      setItems(itemsData);

      const [year, month] = selectedMonth.split('-');
      const startDate = `${year}-${month}-01`;
      const endDate = new Date(year, month, 0).toISOString().split('T')[0];

      if (role === ROLES.SC && selectedStation?.id) {
        // Fetch current stock
        const { data: stockData } = await supabase
          .from('station_inventory')
          .select('*')
          .eq('station_id', selectedStation.id);
        setCurrentStock(stockData ?? []);

        // Fetch received logs strictly AFTER or DURING this month
        const { data: receivedData } = await supabase
          .from('stock_received')
          .select('*')
          .eq('station_id', selectedStation.id)
          .gte('received_date', startDate);
        setReceivedLogs(receivedData ?? []);

        // Fetch consumption logs strictly AFTER or DURING this month
        const { data: consumedData } = await supabase
          .from('consumption_logs')
          .select('*')
          .eq('station_id', selectedStation.id)
          .gte('consumption_date', startDate);
        setConsumptionLogs(consumedData ?? []);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load stock data');
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate table rows
  const tableData = useMemo(() => {
    const [year, monthStr] = selectedMonth.split('-');
    const d = new Date(year, monthStr, 0); // Last day of month
    const endDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const rawData = items.map((item, index) => {
      const stockRow = currentStock.find(s => s.item_id === item.id);
      const currentQty = stockRow?.current_stock || 0;

      const itemReceipts = receivedLogs.filter(l => l.item_id === item.id);
      const itemConsumptions = consumptionLogs.filter(l => l.item_id === item.id);

      const receiptsAfterMonth = itemReceipts
        .filter(l => l.received_date > endDateStr)
        .reduce((sum, l) => sum + Number(l.quantity), 0);
        
      const consumptionsAfterMonth = itemConsumptions
        .filter(l => l.consumption_date > endDateStr)
        .reduce((sum, l) => sum + Number(l.quantity_used), 0);

      const closingStock = currentQty - receiptsAfterMonth + consumptionsAfterMonth;

      const receiptsDuringMonth = itemReceipts
        .filter(l => l.received_date <= endDateStr && l.supplier !== 'Opening Stock Initialization')
        .reduce((sum, l) => sum + Number(l.quantity), 0);

      const initDuringMonth = itemReceipts
        .filter(l => l.received_date <= endDateStr && l.supplier === 'Opening Stock Initialization')
        .reduce((sum, l) => sum + Number(l.quantity), 0);

      const consumptionsDuringMonth = itemConsumptions
        .filter(l => l.consumption_date <= endDateStr)
        .reduce((sum, l) => sum + Number(l.quantity_used), 0);

      const trueOpeningStock = closingStock - (receiptsDuringMonth + initDuringMonth) + consumptionsDuringMonth;
      const visualOpeningStock = trueOpeningStock + initDuringMonth;

      const dbUnit  = item.unit || 'Nos';
      const unit     = getDisplayUnit(dbUnit);   // Ltr / Kg / Nos for display
      const toDisp = (v) => toDisplayValue(v, dbUnit);
      const fmtDisp = (v) => {
        const dv = toDisp(v);
        return unit === 'Nos' ? `${Math.round(dv)}` : `${dv.toFixed(2)}`;
      };

      return {
        id: item.id,
        item_name: item.name,
        brand: item.rate_master?.brand || 'ORDINARY',
        supplier: 'Tricuesta',
        tender_year: item.rate_master?.tender_year || '2024-25',
        unit,
        opening_stock: fmtDisp(visualOpeningStock > 0 ? visualOpeningStock : 0),
        received_transferred: fmtDisp(receiptsDuringMonth),
        consumption: fmtDisp(consumptionsDuringMonth),
        closing_stock: fmtDisp(closingStock > 0 ? closingStock : 0),
        closing_stock_raw: toDisp(closingStock > 0 ? closingStock : 0),
        _zeroStock: closingStock <= 0,
        _visualOpeningStock: visualOpeningStock,
        _receiptsDuringMonth: receiptsDuringMonth,
        _consumptionsDuringMonth: consumptionsDuringMonth
      };
    });

    const activeData = rawData.filter(row => 
      row.closing_stock_raw > 0 || 
      row._consumptionsDuringMonth > 0 || 
      row._receiptsDuringMonth > 0 || 
      row._visualOpeningStock > 0
    );

    // Sort the data: stock > 0 first, then by consumption (descending), then by name
    activeData.sort((a, b) => {
      const aHasStock = a.closing_stock > 0;
      const bHasStock = b.closing_stock > 0;
      
      if (aHasStock && !bHasStock) return -1;
      if (!aHasStock && bHasStock) return 1;
      
      if (b.consumption !== a.consumption) {
        return b.consumption - a.consumption; // mostly used items first
      }
      
      return a.item_name.localeCompare(b.item_name);
    });
    
    // Add sl_no after sorting
    return activeData.map((item, index) => ({
      ...item,
      sl_no: index + 1
    }));
  }, [items, currentStock, receivedLogs, consumptionLogs, selectedMonth]);

  // Filter tableData by search term
  const filteredTableData = useMemo(() => {
    if (!searchTerm) return tableData;
    const lowerSearch = searchTerm.toLowerCase();
    return tableData.filter(item => 
      item.item_name.toLowerCase().includes(lowerSearch) || 
      item.brand.toLowerCase().includes(lowerSearch)
    );
  }, [tableData, searchTerm]);

  const handleConsumptionSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const finalQty = parseFloat(formQty);
    if (!finalQty || finalQty <= 0) return setError('Enter a valid quantity.');
    // formQty is entered in display units (Ltr/Kg/Nos); convert to base (ml/g/Nos) for DB storage
    const dbUnit = selectedItemForAction?.dbUnit || selectedItemForAction?.unit || 'Nos';
    const baseQty = (dbUnit === 'ml' || dbUnit === 'g' || dbUnit === 'Ltr' || dbUnit === 'Kg')
      ? finalQty * 1000
      : finalQty;
    if (finalQty > (selectedItemForAction?.closing_stock_raw ?? 0)) return setError('Not enough stock available.');

    setSubmitting(true);
    try {
      await logConsumption({
        station_id: selectedStation.id,
        item_id: selectedItemForAction.id,
        quantity_used: baseQty,
        consumption_date: formDate,
        remarks: formRemarks || null,
        logged_by: profile.id,
      });
      toast.success('Consumption logged successfully!');
      setShowConsumptionForm(false);
      loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (log) => {
    setEditingLog(log);
    setEditForm({
      quantity_used: log.quantity_used,
      consumption_date: log.consumption_date,
      remarks: log.remarks || ''
    });
    setError('');
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const { error: err } = await supabase.rpc('fn_edit_consumption', {
        p_log_id: editingLog.id,
        p_new_quantity: parseFloat(editForm.quantity_used),
        p_new_date: editForm.consumption_date,
        p_remarks: editForm.remarks || null
      });
      if (err) throw err;
      toast.success('Consumption log updated!');
      setEditingLog(null);
      loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (log) => {
    if (!window.confirm('Are you sure you want to delete this consumption log? Physical stock will be refunded.')) return;
    try {
      const { error: err } = await supabase.rpc('fn_delete_consumption', { p_log_id: log.id });
      if (err) throw err;
      toast.success('Log deleted successfully.');
      loadData();
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    }
  };

  const handleGenerateBill = async () => {
    setGeneratingPdf(true);
    try {
      const [year, month] = selectedMonth.split('-');
      const startDate = `${year}-${month}-01`;
      const endDate = new Date(year, month, 0).toISOString().split('T')[0];

      // Fresh fetch of ALL active items — explicit limit avoids Supabase row cap
      const { data: allItemsData, error: itemsErr } = await supabase
        .from('inventory_items')
        .select('*, rate_master ( unit_rate, tender_year, brand, supplier, nos_per_kg )')
        .eq('is_active', true)
        .limit(1000)
        .order('name');
      if (itemsErr) throw itemsErr;

      // Fetch all consumption logs for the selected month across all stations
      const { data, error } = await supabase
        .from('consumption_logs')
        .select('*, inventory_items(name, unit, rate_master(brand, unit_rate, nos_per_kg, tender_year)), stations(code)')
        .gte('consumption_date', startDate)
        .lte('consumption_date', endDate)
        .limit(5000);

      if (error) throw error;

      await generateMonthlyBillPdf(month, year, data || [], allItemsData || []);
      setShowBillModal(false);
      toast.success('Monthly Bill generated successfully!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate bill: ' + (err.message || err.toString()));
    } finally {
      setGeneratingPdf(false);
    }
  };


  const columns = [
    { key: 'sl_no', label: 'Sl.No', width: 60, render: (v) => <span style={{ color: 'var(--color-gray-500)' }}>{v}</span> },
    { key: 'item_name', label: 'Item Name', sortable: true, render: (v) => <strong>{v}</strong> },
    { key: 'brand', label: 'Brand' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'tender_year', label: 'Tender Year', width: 100, render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span> },
    { key: 'opening_stock',        label: 'Opening',            render: (v, row) => `${v} ${row.unit}` },
    { key: 'received_transferred', label: 'Received', width: 100, render: (v, row) => `${v} ${row.unit}` },
    { key: 'consumption',          label: 'Consumed',  render: (v, row) => `${v} ${row.unit}` },
    { key: 'closing_stock',        label: 'Closing',           render: (v, row) => <strong style={{ color: Number(row.closing_stock_raw) === 0 ? 'var(--color-danger-600)' : 'inherit' }}>{v} {row.unit}</strong> },
    ...(role === ROLES.SC ? [{
      key: 'actions', label: 'Actions', render: (_, row) => (
        <Button variant="outline" onClick={() => {
          setSelectedItemForAction(row);
          setFormQty(''); setFormRemarks(''); setFormDate(today.toISOString().split('T')[0]);
          setShowConsumptionForm(true);
        }}>
          Log Consumed
        </Button>
      )
    }] : [])
  ];

  const historyColumns = [
    { key: 'consumption_date', label: 'Date', sortable: true, render: (v) => formatDate(v) },
    { key: 'item', label: 'Item', render: (_, r) => items.find(i => i.id === r.item_id)?.name || 'Unknown Item' },
    { key: 'quantity', label: 'Qty Consumed', render: (_, r) => {
        const item = items.find(i => i.id === r.item_id);
        const dbUnit = item?.unit || 'Nos';
        const dispUnit = getDisplayUnit(dbUnit);
        const dispVal = toDisplayValue(r.quantity_used, dbUnit);
        const formatted = dispUnit === 'Nos' ? Math.round(dispVal) : dispVal.toFixed(2);
        return `${formatted} ${dispUnit}`;
      }
    },
    { key: 'remarks', label: 'Remarks', render: (v) => v || '—' },
    { 
      key: 'actions', 
      label: 'Actions', 
      render: (_, row) => {
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

  return (
    <Layout
      title="Consumption Log"
      subtitle={role === ROLES.ALS ? 'All stations (Aggregated)' : selectedStation?.name}
      actions={
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ fontSize: '13px', fontWeight: 600 }}>Select Month:</label>
          <input 
            type="month" 
            className="form-control" 
            value={selectedMonth} 
            onChange={e => setSelectedMonth(e.target.value)}
          />
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
        <button 
          className={`btn ${activeTab === 'aggregate' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('aggregate')}
          style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: activeTab === 'aggregate' ? 'none' : '' }}
        >
          <Calculator size={16} /> Monthly Aggregated View
        </button>
        <button 
          className={`btn ${activeTab === 'history' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('history')}
          style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: activeTab === 'history' ? 'none' : '' }}
        >
          <History size={16} /> Consumption log history
        </button>
      </div>

      {activeTab === 'aggregate' && (
        <Card>
          <div className="filter-bar" style={{ padding: 'var(--space-4) var(--space-4) 0', marginBottom: 0, display: 'flex', gap: 'var(--space-2)' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
              <input 
                type="text" 
                className="form-control" 
                placeholder="Search materials by name or brand..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ paddingLeft: '32px' }}
              />
              <svg 
                style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--color-gray-400)' }} 
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
          </div>
          <CardHeader title="Comprehensive Stock Movement" icon={<FileText size={16} />} subtitle={`${filteredTableData.length} materials tracked`} />
          <div style={{ overflowX: 'auto' }}>
            <DataTable
              columns={columns}
              data={filteredTableData}
              isLoading={isLoading}
              emptyTitle="No stock records found"
            />
          </div>
        </Card>
      )}

      {activeTab === 'history' && (
        <Card>
          <div className="filter-bar" style={{ padding: 'var(--space-4) var(--space-4) 0', marginBottom: 0 }}>
            <select className="form-control" style={{ width: 'auto', minWidth: '200px' }} value={historyItemFilter} onChange={(e) => setHistoryItemFilter(e.target.value)}>
              <option value="All">All Materials</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <CardHeader 
            title="Consumption Logs" 
            icon={<History size={16} />} 
            subtitle={`${consumptionLogs.filter(l => historyItemFilter === 'All' || l.item_id === historyItemFilter).length} records`} 
          />
          <DataTable
            columns={historyColumns}
            data={consumptionLogs.filter(l => historyItemFilter === 'All' || l.item_id === historyItemFilter).map(l => ({ ...l, id: l.id }))}
            isLoading={isLoading}
            emptyTitle="No consumptions recorded"
            emptyDesc="Entries will appear here when you log consumption."
          />
        </Card>
      )}

      {/* Consumption Modal */}
      <Modal
        isOpen={showConsumptionForm}
        onClose={() => setShowConsumptionForm(false)}
        title={`Log Consumption for ${selectedItemForAction?.item_name}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowConsumptionForm(false)}>Cancel</Button>
            <Button variant="warning" form="consumption-form" type="submit" isLoading={submitting}>Log Consumption</Button>
          </>
        }
      >
        {error && <Alert variant="danger" style={{ marginBottom: '16px' }}>{error}</Alert>}
        <form id="consumption-form" onSubmit={handleConsumptionSubmit}>
          <Alert variant="info" style={{ marginBottom: '16px' }}>
            Current Balance: <strong>{selectedItemForAction?.closing_stock} {selectedItemForAction?.unit}</strong>
          </Alert>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label form-label-required">Quantity Used</label>
              <input type="number" step="any" min="0.001" className="form-control" value={formQty} onChange={e => setFormQty(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label form-label-required">Date</label>
              <input type="date" className="form-control" value={formDate} onChange={e => setFormDate(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Remarks (Optional)</label>
            <textarea className="form-control" rows={2} value={formRemarks} onChange={e => setFormRemarks(e.target.value)} />
          </div>
        </form>
      </Modal>

      {/* Edit Log Modal */}
      <Modal
        isOpen={!!editingLog}
        onClose={() => setEditingLog(null)}
        title="Edit Consumption Log"
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
              <p><strong>Item:</strong> {items.find(i => i.id === editingLog.item_id)?.name}</p>
              <p><strong>Original Quantity:</strong> {editingLog.quantity_used}</p>
            </div>
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="el-qty">New Quantity</label>
              <input id="el-qty" type="number" min="0.001" step="any" className="form-control"
                value={editForm.quantity_used} onChange={(e) => setEditForm(f => ({ ...f, quantity_used: e.target.value }))} required />
              <small style={{ color: 'var(--color-text-muted)' }}>Inventory stock will be updated to reflect this new value.</small>
            </div>
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="el-date">Consumption Date</label>
              <input id="el-date" type="date" className="form-control"
                value={editForm.consumption_date} onChange={(e) => setEditForm(f => ({ ...f, consumption_date: e.target.value }))} required />
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
