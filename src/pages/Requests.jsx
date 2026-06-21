import React, { useEffect, useState } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import { RequestStatusBadge, PriorityBadge } from '../components/ui/Badge';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { useInventory } from '../hooks/useInventory';
import { supabase } from '../lib/supabase';
import { ROLES, PRIORITY, APPROVAL_THRESHOLD, ALS_GROUPS } from '../lib/constants';
import toast from 'react-hot-toast';

const today = new Date().toISOString().split('T')[0];

export default function Requests() {
  const { role, profile } = useAuthStore();
  const { selectedStation, alsGroupFilter } = useStationStore();
  const { fetchInventoryItems } = useInventory(selectedStation?.id);

  const [requests, setRequests] = useState([]);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const [form, setForm] = useState({
    item_id: '', quantity: '', priority: PRIORITY.NORMAL, reason: '',
  });

  useEffect(() => { loadData(); }, [selectedStation?.id, role]); // eslint-disable-line

  const loadData = async () => {
    setIsLoading(true);
    try {
      const itemsData = await fetchInventoryItems();
      setItems(itemsData);

      let query = supabase.from('consumable_requests')
        .select(`
          *,
          inventory_items ( name, unit ),
          stations ( code, name ),
          users_profile!consumable_requests_requested_by_fkey ( full_name )
        `)
        .order('created_at', { ascending: false });

      if (role === ROLES.HKS && selectedStation?.id) {
        query = query.eq('station_id', selectedStation.id);
      } else if (role === ROLES.SC && selectedStation?.id) {
        query = query.eq('station_id', selectedStation.id);
      }
      // ALS: no filter — sees all

      const { data, error: err } = await query;
      if (err) throw err;
      
      let filteredData = data ?? [];
      if (role === ROLES.ALS) {
        const allowedStations = ALS_GROUPS[alsGroupFilter];
        if (allowedStations) {
          filteredData = filteredData.filter(r => r.stations && allowedStations.includes(r.stations.code));
        }
      }
      
      setRequests(filteredData);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedItem = items.find((i) => i.id === form.item_id);
  const unitRate = selectedItem?.rate_master?.unit_rate ?? 0;
  const estimatedCost = form.quantity && unitRate ? parseFloat(form.quantity) * unitRate : 0;
  const willForward = estimatedCost > APPROVAL_THRESHOLD;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.item_id || !form.quantity) {
      setError('Item and quantity are required.');
      return;
    }
    setSubmitting(true);
    try {
      const { error: err } = await supabase.from('consumable_requests').insert({
        station_id: selectedStation.id,
        item_id: form.item_id,
        requested_by: profile.id,
        quantity: parseFloat(form.quantity),
        unit_rate: unitRate,
        priority: form.priority,
        reason: form.reason || null,
      });
      if (err) throw err;
      toast.success(
        willForward
          ? `Request forwarded to ALS (cost ₹${estimatedCost.toFixed(2)} > ₹${APPROVAL_THRESHOLD})`
          : 'Request created successfully!'
      );
      setShowForm(false);
      setForm({ item_id: '', quantity: '', priority: PRIORITY.NORMAL, reason: '' });
      loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRequests = statusFilter === 'All'
    ? requests
    : requests.filter((r) => r.status === statusFilter);

  const columns = [
    { key: 'created_at', label: 'Date', sortable: true, render: (v) => new Date(v).toLocaleDateString('en-IN') },
    ...(role !== ROLES.HKS ? [{ key: 'station', label: 'Station', render: (_, r) => r.stations?.code ?? '—' }] : []),
    { key: 'item', label: 'Item', render: (_, r) => r.inventory_items?.name ?? '—' },
    { key: 'quantity', label: 'Qty', render: (v, r) => `${v} ${r.inventory_items?.unit ?? ''}` },
    { key: 'estimated_cost', label: 'Est. Cost', render: (v) => v ? `₹${Number(v).toFixed(2)}` : '—' },
    { key: 'priority', label: 'Priority', render: (v) => <PriorityBadge priority={v} /> },
    { key: 'status', label: 'Status', render: (v) => <RequestStatusBadge status={v} /> },
    { key: 'requested_by', label: 'Requested By', render: (_, r) => r.users_profile?.full_name ?? '—' },
  ];

  const STATUS_OPTIONS = ['All', 'pending', 'approved_sc', 'forwarded_als', 'approved_als', 'rejected', 'completed'];

  return (
    <Layout
      title="Consumable Requests"
      subtitle={role === ROLES.ALS ? 'All stations' : selectedStation?.name}
      actions={
        role === ROLES.HKS ? (
          <Button variant="accent" leftIcon={<Plus size={16} />} onClick={() => setShowForm(true)}>
            New Request
          </Button>
        ) : null
      }
    >
      <div className="filter-bar" style={{ marginBottom: 'var(--space-4)' }}>
        <select className="form-control" style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s === 'All' ? 'All Status' : s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader title="Request List" icon={<ClipboardList size={16} />} subtitle={`${filteredRequests.length} requests`} />
        <DataTable
          columns={columns}
          data={filteredRequests.map((r) => ({ ...r, id: r.id }))}
          isLoading={isLoading}
          emptyTitle="No requests found"
          emptyDesc={role === ROLES.HKS ? 'Create a new consumable request using the button above.' : 'No requests match the selected filter.'}
          emptyIcon={<ClipboardList size={28} />}
        />
      </Card>

      {/* New Request Modal (HKS only) */}
      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setError(''); }}
        title="New Consumable Request"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="primary" form="request-form" type="submit" isLoading={submitting}>
              Submit Request
            </Button>
          </>
        }
      >
        {error && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}
        <form id="request-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label form-label-required" htmlFor="req-item">Item</label>
            <select id="req-item" className="form-control" value={form.item_id}
              onChange={(e) => setForm((f) => ({ ...f, item_id: e.target.value }))} required>
              <option value="">— Select item —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
            </select>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="req-qty">Quantity</label>
              <input id="req-qty" type="number" min="0.001" step="any" className="form-control"
                value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="req-priority">Priority</label>
              <select id="req-priority" className="form-control" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                <option value="normal">Normal</option>
                <option value="urgent">🔴 Urgent</option>
              </select>
            </div>
          </div>

          {/* Cost preview */}
          {selectedItem && form.quantity && (
            <Alert variant={willForward ? 'warning' : 'success'} style={{ marginBottom: 'var(--space-4)' }}>
              <strong>Estimated Cost: ₹{estimatedCost.toFixed(2)}</strong>
              {' — '}
              {willForward
                ? `⚠️ Amount exceeds ₹${APPROVAL_THRESHOLD}. This request will be automatically forwarded to ALS.`
                : `✅ SC can approve this request.`}
            </Alert>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="req-reason">Reason / Justification</label>
            <textarea id="req-reason" className="form-control" rows={3}
              value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Explain why this item is needed…" />
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
