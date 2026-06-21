import React, { useEffect, useState } from 'react';
import { PackagePlus, Plus, X } from 'lucide-react';
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
import { ROLES } from '../lib/constants';
import toast from 'react-hot-toast';

const today = new Date().toISOString().split('T')[0];

export default function StockReceived() {
  const { role, profile } = useAuthStore();
  const { selectedStation } = useStationStore();
  const { addStockReceived, bulkAddStockReceived, fetchStockReceived, fetchInventoryItems, addNewCatalogueItem } = useInventory(selectedStation?.id);

  const [logs, setLogs] = useState([]);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [showNewItemForm, setShowNewItemForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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

  const [newItemForm, setNewItemForm] = useState({
    item_name: '', category: 'Consumable', unit: 'Nos', unit_rate: '', tender_year: '', brand: '', remarks: ''
  });

  const [bulkForm, setBulkForm] = useState({}); // { [item_id]: quantity_string }

  useEffect(() => {
    loadData();
  }, [selectedStation?.id, role]); // eslint-disable-line

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [itemsData] = await Promise.all([fetchInventoryItems()]);
      setItems(itemsData);

      if (role === ROLES.ALS) {
        const [logsRes, stationsRes] = await Promise.all([
          supabase.from('stock_received')
            .select('*, inventory_items(name,unit), stations(code,name), users_profile(full_name)')
            .order('received_date', { ascending: false }).limit(200),
          supabase.from('stations').select('id,code,name').eq('is_active', true).order('code'),
        ]);
        setAllLogs(logsRes.data ?? []);
        setStations(stationsRes.data ?? []);
      } else if (selectedStation?.id) {
        const [data, stationsRes] = await Promise.all([
          fetchStockReceived(selectedStation.id),
          supabase.from('stations').select('id,code,name').eq('is_active', true).order('code'),
        ]);
        setLogs(data);
        setStations(stationsRes.data ?? []);
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
    setSubmitting(true);
    try {
      await addStockReceived({
        station_id: selectedStation.id,
        item_id: form.item_id,
        quantity: parseFloat(form.quantity),
        received_date: form.received_date,
        invoice_number: form.invoice_number || null,
        source_station_id: form.source_station_id || null, // Capture source station
        supplier: form.source_station_id ? null : (form.supplier || 'KDS'),
        unit_rate: form.unit_rate ? parseFloat(form.unit_rate) : null,
        remarks: form.remarks || null,
        received_by: profile.id,
      });
      toast.success('Stock received entry added successfully!');
      setShowForm(false);
      setForm({ item_id: '', quantity: '', received_date: today, invoice_number: '', source_station_id: '', supplier: '', unit_rate: '', remarks: '' });
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
        unit_rate: parseFloat(newItemForm.unit_rate)
      });
      toast.success('New item added to master catalogue!');
      setShowNewItemForm(false);
      setNewItemForm({ item_name: '', category: 'Consumable', unit: 'Nos', unit_rate: '', tender_year: '', brand: '', remarks: '' });
      loadData(); // Refresh the items list
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    // Filter out empty/zero entries
    const entriesToSubmit = Object.entries(bulkForm)
      .filter(([itemId, qty]) => qty && parseFloat(qty) > 0)
      .map(([itemId, qty]) => {
        const item = items.find(i => i.id === itemId);
        return {
          station_id: selectedStation.id,
          item_id: itemId,
          quantity: parseFloat(qty),
          received_date: today,
          invoice_number: null,
          source_station_id: null,
          supplier: 'Opening Stock Initialization',
          unit_rate: item?.rate_master?.unit_rate ? parseFloat(item.rate_master.unit_rate) : null,
          remarks: 'Opening Stock Initialization via Bulk Entry',
          received_by: profile.id,
        };
      });

    if (entriesToSubmit.length === 0) {
      setError('Please enter quantities for at least one item.');
      return;
    }

    setSubmitting(true);
    try {
      await bulkAddStockReceived(entriesToSubmit);
      toast.success(`Successfully initialized stock for ${entriesToSubmit.length} items!`);
      setShowBulkForm(false);
      setBulkForm({});
      loadData();
    } catch (err) {
      setError('Failed to bulk initialize stock: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedItem = items.find((i) => i.id === form.item_id);

  const displayLogs = role === ROLES.ALS
    ? (alsStation === 'All' ? allLogs : allLogs.filter((l) => l.stations?.code === alsStation))
    : logs;

  const columns = [
    ...(role === ROLES.ALS ? [{ key: 'station', label: 'Station', render: (_, row) => row.stations?.code ?? '—' }] : []),
    { key: 'received_date', label: 'Date', sortable: true },
    { key: 'item', label: 'Item', render: (_, row) => row.inventory_items?.name ?? '—' },
    { key: 'quantity', label: 'Qty Received', render: (_, row) => `${row.quantity} ${row.inventory_items?.unit ?? ''}` },
    { key: 'unit_rate', label: 'Unit Rate', render: (v) => v ? `₹${Number(v).toFixed(2)}` : '—' },
    { key: 'total_value', label: 'Total Value', render: (v) => v ? `₹${Number(v).toFixed(2)}` : '—' },
    { key: 'source_station', label: 'Received From', render: (_, row) => {
        if (row.source_station_id) {
          const srcStation = stations.find(s => s.id === row.source_station_id);
          return srcStation ? `${srcStation.code}` : 'Other Station';
        }
        return row.supplier || 'KDS';
    }},
    { key: 'invoice_number', label: 'Invoice #', render: (v) => v ?? '—' },
    { key: 'received_by', label: 'Received By', render: (_, row) => row.users_profile?.full_name ?? '—' },
  ];

  const tableData = displayLogs.map((r) => ({ ...r, id: r.id }));

  return (
    <Layout
      title="Stock Received"
      subtitle={role === ROLES.ALS ? 'All stations' : selectedStation?.name}
      actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          {selectedStation?.code === 'PNCU' && (
            <Button variant="outline" leftIcon={<Plus size={16} />} onClick={() => setShowNewItemForm(true)}>
              Add New Catalogue Item
            </Button>
          )}
          {role === ROLES.SC && (
            <>
              <Button variant="outline" leftIcon={<PackagePlus size={16} />} onClick={() => setShowBulkForm(true)}>
                Initialize Opening Stock
              </Button>
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
            {stations.map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
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

      {/* Bulk Entry Opening Stock Modal */}
      <Modal
        isOpen={showBulkForm}
        onClose={() => { setShowBulkForm(false); setError(''); }}
        title="Initialize Opening Stock (Bulk Entry)"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowBulkForm(false)}>Cancel</Button>
            <Button variant="accent" form="bulk-stock-form" type="submit" isLoading={submitting}>
              Save All Opening Stock
            </Button>
          </>
        }
      >
        <Alert variant="info" style={{ marginBottom: 'var(--space-4)' }}>
          Enter the current quantities you have on-hand for any items. Leave the field blank for items you don't have.
        </Alert>
        {error && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}
        
        <form id="bulk-stock-form" onSubmit={handleBulkSubmit}>
          <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '8px' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Item Name</th>
                  <th>Category</th>
                  <th style={{ width: '150px' }}>Quantity</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      {item.rate_master?.tender_year && <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Tender: {item.rate_master.tender_year}</div>}
                    </td>
                    <td>{item.category}</td>
                    <td>
                      <input 
                        type="number" 
                        min="0" 
                        step="any" 
                        className="form-control"
                        placeholder="0"
                        value={bulkForm[item.id] || ''}
                        onChange={(e) => setBulkForm({ ...bulkForm, [item.id]: e.target.value })}
                        style={{ padding: '6px', height: '32px' }}
                      />
                    </td>
                    <td>{item.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </form>
      </Modal>

      {/* Add Stock Received Modal */}
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
              onChange={(val) => {
                const item = items.find((i) => i.id === val);
                setForm((f) => ({ ...f, item_id: val, unit_rate: item?.rate_master?.unit_rate ?? '' }));
              }}
              placeholder="Search items..."
              required
            />
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="sr-qty">Quantity</label>
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
                onChange={(e) => setForm(f => ({ ...f, source_station_id: e.target.value, supplier: e.target.value === '' ? 'KDS' : '' }))}>
                <option value="">Main Store (KDS / Supplier)</option>
                <optgroup label="Inter-Station Transfer">
                  {stations.filter(s => s.id !== selectedStation.id).map(s => (
                    <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            {form.source_station_id === '' && (
              <div className="form-group">
                <label className="form-label" htmlFor="sr-supplier">External Supplier Name</label>
                <input id="sr-supplier" type="text" className="form-control" placeholder="Optional"
                  value={form.supplier} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} />
              </div>
            )}
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

      {/* PNCU ONLY: Add New Master Item Modal */}
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
              <label className="form-label form-label-required" htmlFor="ni-rate">Unit Rate (₹)</label>
              <input id="ni-rate" type="number" min="0" step="0.01" className="form-control"
                value={newItemForm.unit_rate} onChange={(e) => setNewItemForm(f => ({ ...f, unit_rate: e.target.value }))} required />
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
    </Layout>
  );
}
