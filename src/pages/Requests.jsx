import React, { useEffect, useState, useRef } from 'react';
import { ClipboardList, Plus, Camera } from 'lucide-react';
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
  const { inventory, fetchInventory, fetchInventoryItems } = useInventory(selectedStation?.id);

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
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => { loadData(); }, [selectedStation?.id, role]); // eslint-disable-line

  const loadData = async () => {
    setIsLoading(true);
    try {
      const itemsData = await fetchInventoryItems();
      setItems(itemsData);
      
      if (selectedStation?.id) {
        await fetchInventory();
      }

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
      if ((role === ROLES.ALS || role === ROLES.HKTL)) {
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

  const selectedItemStock = inventory.find(i => i.item_id === form.item_id)?.current_stock || 0;
  const isOutOfStock = form.item_id && selectedItemStock <= 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isOutOfStock) return;
    setError('');
    if (!form.item_id || !form.quantity) {
      setError('Item and quantity are required.');
      return;
    }
    setSubmitting(true);
    
    let imageUrl = null;
    try {
      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        const apiKey = import.meta.env.VITE_IMGBB_API_KEY;
        if (!apiKey) throw new Error('ImgBB API key is missing from environment configuration.');

        const res = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
          method: 'POST',
          body: formData,
        });
        const imgData = await res.json();
        if (imgData.success) {
          imageUrl = imgData.data.url;
        } else {
          throw new Error('Image upload failed: ' + imgData.error?.message);
        }
      }

      const { error: err } = await supabase.from('consumable_requests').insert({
        station_id: selectedStation.id,
        item_id: form.item_id,
        requested_by: profile.id,
        quantity: parseFloat(form.quantity),
        unit_rate: unitRate,
        priority: form.priority,
        reason: form.reason || null,
        image_url: imageUrl,
      });
      if (err) throw err;
      toast.success(
        'Request created and sent to HKTL for review!'
      );
      setShowForm(false);
      setForm({ item_id: '', quantity: '', priority: PRIORITY.NORMAL, reason: '' });
      setImageFile(null);
      setImagePreview(null);
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
    { key: 'photo', label: 'Photo', render: (_, r) => r.image_url ? (
      <a href={r.image_url} target="_blank" rel="noreferrer" title="View Full Image">
        <img src={r.image_url} alt="Condition" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }} />
      </a>
    ) : <span style={{ color: 'var(--text-muted)' }}>—</span> },
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
      subtitle={(role === ROLES.ALS || role === ROLES.HKTL) ? 'All stations' : selectedStation?.name}
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
        onClose={() => { 
          setShowForm(false); 
          setError(''); 
          setImageFile(null);
          setImagePreview(null);
        }}
        title="New Consumable Request"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="primary" form="request-form" type="submit" isLoading={submitting} disabled={isOutOfStock}>
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
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit}){i.rate_master?.tender_year ? ` [${i.rate_master.tender_year}]` : ''}
                </option>
              ))}
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
          {selectedItem && form.quantity && !isOutOfStock && (
            <Alert variant="info" style={{ marginBottom: 'var(--space-4)' }}>
              <strong>Estimated Cost: ₹{estimatedCost.toFixed(2)}</strong>
              {' — '}
              {willForward
                ? `Will be routed to HKTL ➔ SC ➔ ALS (Amount > ₹${APPROVAL_THRESHOLD})`
                : `Will be routed to HKTL ➔ SC`}
            </Alert>
          )}

          {isOutOfStock && (
            <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>
              <strong>Out of Stock!</strong> This item is currently unavailable in the station's inventory. You cannot place a request until the Station Controller replenishes the stock.
            </Alert>
          )}

          <div className="form-group">
            <label className="form-label">Condition Photo (Optional)</label>
            <div 
              style={{
                border: '2px dashed var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-4)',
                textAlign: 'center',
                cursor: 'pointer',
                backgroundColor: 'var(--bg-subtle)'
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              {imagePreview ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={imagePreview} alt="Preview" style={{ maxHeight: 150, borderRadius: 'var(--radius-sm)' }} />
                  <Button 
                    variant="danger" 
                    size="sm" 
                    style={{ position: 'absolute', top: 5, right: 5, padding: '2px 6px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setImageFile(null);
                      setImagePreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >✕</Button>
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)' }}>
                  <Camera size={32} style={{ margin: '0 auto var(--space-2)', display: 'block' }} />
                  Click to upload or take a photo
                </div>
              )}
              <input 
                ref={fileInputRef}
                type="file" 
                accept="image/*" 
                capture="environment" 
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) {
                    setImageFile(file);
                    setImagePreview(URL.createObjectURL(file));
                  }
                }}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
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
