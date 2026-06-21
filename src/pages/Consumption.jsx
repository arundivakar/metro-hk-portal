import React, { useEffect, useState } from 'react';
import { TrendingDown, Plus } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import SearchableSelect from '../components/ui/SearchableSelect';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { useInventory } from '../hooks/useInventory';
import { supabase } from '../lib/supabase';
import { ROLES, SHIFTS, ALS_GROUPS } from '../lib/constants';
import { generateMonthlyBillPdf } from '../lib/pdfGenerator';
import toast from 'react-hot-toast';

const today = new Date().toISOString().split('T')[0];

export default function Consumption() {
  const { role, profile } = useAuthStore();
  const { selectedStation, alsGroupFilter } = useStationStore();
  const { logConsumption, fetchConsumptionLogs, fetchInventoryItems } = useInventory(selectedStation?.id);

  const [logs, setLogs] = useState([]);
  const [items, setItems] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [allLogs, setAllLogs] = useState([]);
  const [stations, setStations] = useState([]);
  const [alsStation, setAlsStation] = useState('All');
  const [showBillModal, setShowBillModal] = useState(false);
  const [billMonth, setBillMonth] = useState(new Date().toISOString().substring(0, 7));
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const [form, setForm] = useState({
    item_id: '', quantity_used: '', consumption_date: today, remarks: '',
  });

  useEffect(() => { loadData(); }, [selectedStation?.id, role]); // eslint-disable-line

  const loadData = async () => {
    setIsLoading(true);
    try {
      const itemsData = await fetchInventoryItems();
      setItems(itemsData);

      if (role === ROLES.ALS) {
        const [logsRes, stationsRes] = await Promise.all([
          supabase.from('consumption_logs')
            .select('*, inventory_items(name,unit), stations(code,name), users_profile(full_name)')
            .order('consumption_date', { ascending: false }).limit(200),
          supabase.from('stations').select('id,code,name').eq('is_active', true).order('code'),
        ]);
        setAllLogs(logsRes.data ?? []);
        setStations(stationsRes.data ?? []);
      } else if (selectedStation?.id) {
        const [logsData, invRes] = await Promise.all([
          fetchConsumptionLogs(selectedStation.id),
          supabase.from('station_inventory')
            .select('*, inventory_items(name,unit)')
            .eq('station_id', selectedStation.id),
        ]);
        setLogs(logsData);
        setInventory(invRes.data ?? []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedItemStock = inventory.find((i) => i.item_id === form.item_id);
  const baseUnit = selectedItemStock?.inventory_items?.unit || '';

  // Calculate the display unit (Grams for Kg, ml for Ltr)
  let displayUnit = baseUnit;
  if (baseUnit === 'Kg') displayUnit = 'Grams';
  if (baseUnit === 'Ltr') displayUnit = 'ml';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.item_id || !form.quantity_used) {
      setError('Item and quantity are required.');
      return;
    }
    let finalQty = parseFloat(form.quantity_used);
    
    // Automatically convert Grams to Kg or ml to Ltr for database storage
    if (baseUnit === 'Kg' || baseUnit === 'Ltr') {
      finalQty = finalQty / 1000;
    }

    if (available !== null && finalQty > available) {
      setError(`Cannot consume ${finalQty} ${baseUnit}. Only ${available} ${baseUnit} available in stock.`);
      return;
    }
    setSubmitting(true);
    try {
      await logConsumption({
        station_id: selectedStation.id,
        item_id: form.item_id,
        quantity_used: finalQty,
        consumption_date: form.consumption_date,
        remarks: form.remarks || null,
        logged_by: profile.id,
      });
      toast.success('Consumption logged and stock updated!');
      setShowForm(false);
      setForm({ item_id: '', quantity_used: '', consumption_date: today, remarks: '' });
      setSearchTerm('');
      loadData();
    } catch (err) {
      setError(err.message.includes('Insufficient') ? err.message : 'Failed to log consumption. ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateBill = async () => {
    setGeneratingPdf(true);
    try {
      const [year, month] = billMonth.split('-');
      const startDate = `${year}-${month}-01`;
      const endDate = new Date(year, month, 0).toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('consumption_logs')
        .select('*, inventory_items(name, rate_master(brand, unit_rate)), stations(code)')
        .gte('consumption_date', startDate)
        .lte('consumption_date', endDate);

      if (error) throw error;

      generateMonthlyBillPdf(month, year, data || [], items);
      setShowBillModal(false);
      toast.success('Monthly Bill generated successfully!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate bill: ' + (err.message || err.toString()));
    } finally {
      setGeneratingPdf(false);
    }
  };

  const allowedStations = ALS_GROUPS[alsGroupFilter];

  const displayLogs = role === ROLES.ALS
    ? (alsStation === 'All' ? allLogs : allLogs.filter((l) => l.stations?.code === alsStation))
      .filter((l) => !allowedStations || allowedStations.includes(l.stations?.code))
    : logs;

  const columns = [
    ...(role === ROLES.ALS ? [{ key: 'station', label: 'Station', render: (_, row) => row.stations?.code ?? '—' }] : []),
    { key: 'consumption_date', label: 'Date', sortable: true },
    { key: 'item', label: 'Item', render: (_, row) => row.inventory_items?.name ?? '—' },
    { key: 'quantity_used', label: 'Quantity Used', render: (v, row) => `${v} ${row.inventory_items?.unit ?? ''}` },
    { key: 'logged_by', label: 'Logged By', render: (_, row) => row.users_profile?.full_name ?? '—' },
    { key: 'remarks', label: 'Remarks', render: (v) => v ?? '—' },
  ];

  return (
    <Layout
      title="Daily Consumption"
      subtitle={role === ROLES.ALS ? 'All stations' : selectedStation?.name}
      actions={
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {role === ROLES.ALS && (
            <Button variant="outline" onClick={() => setShowBillModal(true)}>
              Generate Monthly Bill
            </Button>
          )}
          {role === ROLES.SC && (
            <Button variant="warning" leftIcon={<Plus size={16} />} onClick={() => setShowForm(true)}>
              Log Consumption
            </Button>
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
        <CardHeader title="Consumption Log" icon={<TrendingDown size={16} />} subtitle={`${displayLogs.length} records`} />
        <DataTable
          columns={columns}
          data={displayLogs.map((r) => ({ ...r, id: r.id }))}
          isLoading={isLoading}
          emptyTitle="No consumption records"
          emptyDesc="Daily consumption logs will appear here."
          emptyIcon={<TrendingDown size={28} />}
        />
      </Card>

      {/* Log Consumption Modal */}
      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setError(''); }}
        title="Log Daily Consumption"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="warning" form="consumption-form" type="submit" isLoading={submitting}>
              Log Consumption
            </Button>
          </>
        }
      >
        {error && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}
        <form id="consumption-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label form-label-required" htmlFor="con-item">Search & Select Item</label>
            <SearchableSelect
              options={items.map((i) => ({
                value: i.id,
                label: i.name,
                sublabel: i.rate_master?.tender_year ? `Tender: ${i.rate_master.tender_year}` : null
              }))}
              value={form.item_id}
              onChange={(val) => setForm(f => ({ ...f, item_id: val }))}
              placeholder="Search items..."
              required
            />
          </div>
          {selectedItemStock && (
            <Alert variant="info" style={{ marginBottom: 'var(--space-3)' }}>
              Available stock: <strong>{selectedItemStock.current_stock} {selectedItemStock.inventory_items?.unit}</strong>
            </Alert>
          )}
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="con-qty">Quantity Used {displayUnit ? `(${displayUnit})` : ''}</label>
              <input id="con-qty" type="number" min="0.001" step="any" className="form-control"
                value={form.quantity_used} onChange={(e) => setForm((f) => ({ ...f, quantity_used: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="con-date">Date</label>
              <input id="con-date" type="date" className="form-control"
                value={form.consumption_date} onChange={(e) => setForm((f) => ({ ...f, consumption_date: e.target.value }))} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="con-remarks">Remarks</label>
            <textarea id="con-remarks" className="form-control" rows={2}
              value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </div>
        </form>
      </Modal>

      {/* Generate Bill Modal */}
      <Modal
        isOpen={showBillModal}
        onClose={() => setShowBillModal(false)}
        title="Generate Monthly Bill"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowBillModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleGenerateBill} isLoading={generatingPdf}>
              Download PDF
            </Button>
          </>
        }
      >
        <Alert variant="info" style={{ marginBottom: 'var(--space-4)' }}>
          This will generate a consolidated monthly bill (KMRL-O&M-OPC-FOR-150 format) for all station segments.
        </Alert>
        <div className="form-group">
          <label className="form-label" htmlFor="bill-month">Select Month</label>
          <input 
            id="bill-month"
            type="month" 
            className="form-control" 
            value={billMonth}
            onChange={(e) => setBillMonth(e.target.value)}
          />
        </div>
      </Modal>
    </Layout>
  );
}
