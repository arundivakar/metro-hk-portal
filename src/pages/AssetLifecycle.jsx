import React, { useEffect, useState } from 'react';
import { Boxes, Plus, ChevronRight, History, PackagePlus, Pencil, Trash2 } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import { AssetStatusBadge } from '../components/ui/Badge';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { supabase } from '../lib/supabase';
import { ROLES, ASSET_STATUS, ASSET_STATUS_LABELS, ALS_GROUPS, STATION_ORDER } from '../lib/constants';
import toast from 'react-hot-toast';

export default function AssetLifecycle() {
  const { role, profile } = useAuthStore();
  const { selectedStation, alsGroupFilter } = useStationStore();

  const [activeTab, setActiveTab] = useState('assets'); // 'assets' or 'history'
  const [assets, setAssets] = useState([]);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Status Update Modal
  const [selected, setSelected] = useState(null);
  const [newStatus, setNewStatus] = useState('');
  const [updateQty, setUpdateQty] = useState('');
  const [remarks, setRemarks] = useState('');

  // Editing History state
  const [editingLog, setEditingLog] = useState(null);
  const [editLogForm, setEditLogForm] = useState({ quantity: '', remarks: '' });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [alsStation, setAlsStation] = useState('All');
  const [stations, setStations] = useState([]);

  const allowedStations = ALS_GROUPS[alsGroupFilter];

  const stageCounts = {
    in_use: assets.reduce((sum, a) => sum + ((role !== ROLES.ALS && role !== ROLES.HKTL) || !allowedStations || allowedStations.includes(a.stations?.code) ? Number(a.quantity_in_use || 0) : 0), 0),
    partially_damaged: assets.reduce((sum, a) => sum + ((role !== ROLES.ALS && role !== ROLES.HKTL) || !allowedStations || allowedStations.includes(a.stations?.code) ? Number(a.quantity_damaged || 0) : 0), 0),
    disposed: assets.reduce((sum, a) => sum + ((role !== ROLES.ALS && role !== ROLES.HKTL) || !allowedStations || allowedStations.includes(a.stations?.code) ? Number(a.quantity_disposed || 0) : 0), 0),
  };

  useEffect(() => { 
    if (activeTab === 'assets') loadData(); 
    else loadHistory();
  }, [selectedStation?.id, role, activeTab]); 

  const loadData = async () => {
    setIsLoading(true);
    try {
      let query = supabase.from('station_inventory')
        .select(`
          *,
          inventory_items!inner ( name, unit, category, rate_master(brand, tender_year) ),
          stations ( code, name )
        `)
        .eq('inventory_items.category', 'Consumable')
        .order('last_updated', { ascending: false });

      if ((role !== ROLES.ALS && role !== ROLES.HKTL) && selectedStation?.id) {
        query = query.eq('station_id', selectedStation.id);
      }

      const { data, error: err } = await query;
      if (err) throw err;
      setAssets(data ?? []);

      if ((role === ROLES.ALS || role === ROLES.HKTL)) {
        const { data: stationsData } = await supabase.from('stations').select('id,code,name').eq('is_active', true);
        const sortedStations = (stationsData ?? []).sort((a, b) => {
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

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      let query = supabase.from('asset_lifecycle_logs')
        .select(`
          *,
          inventory_items ( name, unit, category ),
          stations ( code, name ),
          users_profile ( full_name )
        `)
        .order('created_at', { ascending: false });

      if ((role !== ROLES.ALS && role !== ROLES.HKTL) && selectedStation?.id) {
        query = query.eq('station_id', selectedStation.id);
      }

      const { data, error: err } = await query;
      if (err) {
        if (err.code === '42P01') {
          // Table doesn't exist yet, ignore gracefully until SQL is run
          setHistoryLogs([]);
          return;
        }
        throw err;
      }
      setHistoryLogs(data ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusUpdate = async () => {
    if (!selected || !newStatus || !updateQty) return;
    const qty = parseFloat(updateQty);
    
    // Determine max available based on current status we are transitioning FROM
    // We are adding a 'fromStatus' state later, for now let's assume we derive it from selected 'newStatus'
    // To move to Damaged, it must come from Good. To move to Disposed, it can come from Good or Damaged.
    // Let's rely on the RPC function to validate it.

    if (qty <= 0) {
      setError('Invalid quantity.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const { error: err } = await supabase.rpc('fn_transition_asset_bucket', {
        p_station_id: selected.station_id,
        p_item_id: selected.item_id,
        p_from_status: selected.transitionFrom, // We will set this in the UI
        p_to_status: newStatus,
        p_quantity: qty,
        p_remarks: remarks || null,
        p_user_id: profile.id
      });
      if (err) throw err;
      
      toast.success('Asset status updated!');
      setSelected(null);
      loadData();
    } catch (err) {
      setError(err.message.includes('function fn_transition_asset_bucket') 
        ? 'Database update required. Please run the SQL script provided.' 
        : err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditLog = (log) => {
    setEditingLog(log);
    setEditLogForm({
      quantity: log.quantity,
      remarks: log.remarks || ''
    });
    setError('');
  };

  const handleSaveEditLog = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const { error: err } = await supabase.rpc('fn_edit_asset_log', {
        p_log_id: editingLog.id,
        p_new_quantity: parseFloat(editLogForm.quantity),
        p_remarks: editLogForm.remarks || null
      });
      if (err) throw err;
      toast.success('Transition log updated!');
      setEditingLog(null);
      loadHistory();
      loadData(); // Update the main buckets
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteLog = async (log) => {
    if (!window.confirm('Are you sure you want to delete this transition? Inventory buckets will be restored to their previous states.')) return;
    try {
      const { error: err } = await supabase.rpc('fn_delete_asset_log', { p_log_id: log.id });
      if (err) throw err;
      toast.success('Transition deleted successfully.');
      loadHistory();
      loadData();
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    }
  };

  const getAvailableFromStatuses = (row) => {
    const froms = [];
    if (row.quantity_in_use > 0) froms.push(ASSET_STATUS.IN_USE);
    if (row.quantity_damaged > 0) froms.push(ASSET_STATUS.PARTIALLY_DAMAGED);
    return froms;
  };

  const getNextStatuses = (fromStatus) => {
    if (fromStatus === ASSET_STATUS.IN_USE) return [ASSET_STATUS.PARTIALLY_DAMAGED, ASSET_STATUS.DISPOSED];
    if (fromStatus === ASSET_STATUS.PARTIALLY_DAMAGED) return [ASSET_STATUS.DISPOSED];
    return [];
  };

  const filteredAssets = assets
    // Since we now show rows containing all statuses, the filter just filters rows where AT LEAST ONE matches
    .filter((a) => statusFilter === 'All' || 
      (statusFilter === ASSET_STATUS.IN_USE && a.quantity_in_use > 0) ||
      (statusFilter === ASSET_STATUS.PARTIALLY_DAMAGED && a.quantity_damaged > 0) ||
      (statusFilter === ASSET_STATUS.DISPOSED && a.quantity_disposed > 0)
    )
    .filter((a) => (role !== ROLES.ALS && role !== ROLES.HKTL) || !allowedStations || allowedStations.includes(a.stations?.code))
    .filter((a) => (role !== ROLES.ALS && role !== ROLES.HKTL) || alsStation === 'All' || a.stations?.code === alsStation);

  const filteredHistory = historyLogs
    .filter((a) => (role !== ROLES.ALS && role !== ROLES.HKTL) || !allowedStations || allowedStations.includes(a.stations?.code))
    .filter((a) => (role !== ROLES.ALS && role !== ROLES.HKTL) || alsStation === 'All' || a.stations?.code === alsStation);

  const assetColumns = [
    { key: 'sl_no', label: 'Sl. No', render: (_, __, i) => <span style={{ color: 'var(--color-gray-500)' }}>{i + 1}</span> },
    ...((role === ROLES.ALS || role === ROLES.HKTL) ? [{ key: 'station', label: 'Station', render: (_, r) => r.stations?.code ?? '—' }] : []),
    { key: 'item', label: 'Consumable Material', render: (_, r) => <strong>{r.inventory_items?.name ?? '—'}</strong> },
    { key: 'brand', label: 'Brand', render: (_, r) => r.inventory_items?.rate_master?.brand || '—' },
    { key: 'supplier', label: 'Supplier', render: () => 'Tricuesta' },
    { key: 'tender_year', label: 'Tender Year', render: (_, r) => r.inventory_items?.rate_master?.tender_year || '—' },
    { key: 'in_good_condition', label: 'In Good Condition (In Use)', render: (_, r) => `${Number(r.quantity_in_use || 0)} ${r.inventory_items?.unit ?? ''}` },
    { key: 'partially_damaged', label: 'Partially Damaged (Usable)', render: (_, r) => `${Number(r.quantity_damaged || 0)} ${r.inventory_items?.unit ?? ''}` },
    { key: 'disposed', label: 'Disposed (Unusable)', render: (_, r) => `${Number(r.quantity_disposed || 0)} ${r.inventory_items?.unit ?? ''}` },
    ...(role === ROLES.SC ? [{
      key: 'actions', label: 'Actions',
      render: (_, r) => {
        const availableFroms = getAvailableFromStatuses(r);
        if (availableFroms.length === 0) return <span style={{ color: 'var(--color-gray-400)', fontSize: 'var(--font-size-xs)' }}>No stock</span>;
        return (
          <Button variant="outline" size="sm" onClick={() => { 
            setSelected({ ...r, transitionFrom: availableFroms[0] }); 
            setNewStatus(''); 
            setUpdateQty(''); 
            setRemarks(''); 
            setError(''); 
          }}>
            Transition
          </Button>
        );
      },
    }] : []),
  ];

  const historyColumns = [
    { key: 'created_at', label: 'Date', render: (v) => new Date(v).toLocaleDateString('en-IN') },
    ...((role === ROLES.ALS || role === ROLES.HKTL) ? [{ key: 'station', label: 'Station', render: (_, r) => r.stations?.code ?? '—' }] : []),
    { key: 'item', label: 'Cleaning Material', render: (_, r) => r.inventory_items?.name ?? '—' },
    { key: 'quantity', label: 'Quantity', render: (v, r) => `${v} ${r.inventory_items?.unit ?? ''}` },
    { key: 'from_status', label: 'Initial Status', render: (v) => v === 'Stock' ? <span className="badge" style={{ background: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>Stock</span> : <AssetStatusBadge status={v} /> },
    { key: 'to_status', label: 'Current Status', render: (v) => <AssetStatusBadge status={v} /> },
    { key: 'remarks', label: 'Remarks', render: (v) => v || '—' },
    { key: 'logged_by', label: 'Logged By', render: (_, r) => r.users_profile?.full_name ?? '—' },
    { 
      key: 'actions', 
      label: 'Actions', 
      render: (_, row) => {
        const canEdit = (role === ROLES.ALS || role === ROLES.HKTL) || (role === ROLES.SC && row.station_id === selectedStation?.id);
        if (!canEdit) return null;
        return (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-ghost" style={{ padding: '4px', color: 'var(--color-primary-600)' }} onClick={() => handleEditLog(row)} title="Edit">
              <Pencil size={16} />
            </button>
            <button className="btn btn-ghost" style={{ padding: '4px', color: 'var(--color-danger-600)' }} onClick={() => handleDeleteLog(row)} title="Delete">
              <Trash2 size={16} />
            </button>
          </div>
        );
      }
    }
  ];

  return (
    <Layout
      title="Asset Lifecycle"
      subtitle={(role === ROLES.ALS || role === ROLES.HKTL) ? 'All stations' : selectedStation?.name}
    >
      {/* Lifecycle Stage Summary */}
      <div className="lifecycle-stages animate-fade-in" style={{ marginBottom: 'var(--space-6)' }}>
        <div 
          className="lifecycle-stage stage-inuse" 
          onClick={() => { setActiveTab('assets'); setStatusFilter(ASSET_STATUS.IN_USE); }}
          style={{ cursor: 'pointer' }}
        >
          <div className="lifecycle-stage-num" style={{ background: 'var(--color-success-100)', color: 'var(--color-success-600)' }}>1</div>
          <div className="lifecycle-stage-label" style={{ color: 'var(--color-success-600)' }}>In Good Condition<br />(In Use)</div>
          <div className="lifecycle-stage-count" style={{ color: 'var(--color-success-600)', fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>{stageCounts.in_use}</div>
        </div>
        <div 
          className="lifecycle-stage stage-partial" 
          onClick={() => { setActiveTab('assets'); setStatusFilter(ASSET_STATUS.PARTIALLY_DAMAGED); }}
          style={{ cursor: 'pointer' }}
        >
          <div className="lifecycle-stage-num" style={{ background: 'var(--color-warning-100)', color: 'var(--color-warning-600)' }}>2</div>
          <div className="lifecycle-stage-label" style={{ color: 'var(--color-warning-600)' }}>Partially Damaged<br />(Usable)</div>
          <div className="lifecycle-stage-count" style={{ color: 'var(--color-warning-600)', fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>{stageCounts.partially_damaged}</div>
        </div>
        <div 
          className="lifecycle-stage stage-disposed" 
          onClick={() => { setActiveTab('assets'); setStatusFilter(ASSET_STATUS.DISPOSED); }}
          style={{ cursor: 'pointer' }}
        >
          <div className="lifecycle-stage-num" style={{ background: 'var(--color-danger-100)', color: 'var(--color-danger-600)' }}>3</div>
          <div className="lifecycle-stage-label" style={{ color: 'var(--color-danger-600)' }}>Disposed<br />(Unusable)</div>
          <div className="lifecycle-stage-count" style={{ color: 'var(--color-danger-600)', fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>{stageCounts.disposed}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
        <button 
          className={`btn ${activeTab === 'assets' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('assets')}
          style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: activeTab === 'assets' ? 'none' : '' }}
        >
          <Boxes size={16} /> Asset Details (View)
        </button>
        <button 
          className={`btn ${activeTab === 'history' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('history')}
          style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: activeTab === 'history' ? 'none' : '' }}
        >
          <History size={16} /> Transition History Log
        </button>
      </div>

      {activeTab === 'assets' && (
        <>
          <div className="filter-bar" style={{ marginBottom: 'var(--space-4)' }}>
            <select className="form-control" style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Stages</option>
              {Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {(role === ROLES.ALS || role === ROLES.HKTL) && (
              <select className="form-control" style={{ width: 'auto' }} value={alsStation} onChange={(e) => setAlsStation(e.target.value)}>
                <option value="All">All Stations</option>
                {stations.filter(s => !allowedStations || allowedStations.includes(s.code)).map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
            )}
          </div>

          <Card>
            <CardHeader title="Assets in Use" icon={<Boxes size={16} />} subtitle={`${filteredAssets.length} assets`} />
            <DataTable
              columns={assetColumns}
              data={filteredAssets.map((a) => ({ ...a, id: a.id }))}
              isLoading={isLoading}
              emptyTitle="No assets tracked"
              emptyDesc="Issue consumables from inventory to track them here."
              emptyIcon={<Boxes size={28} />}
            />
          </Card>
        </>
      )}

      {activeTab === 'history' && (
        <Card>
          <div className="filter-bar" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4) var(--space-4) 0' }}>
            {(role === ROLES.ALS || role === ROLES.HKTL) && (
              <select className="form-control" style={{ width: 'auto' }} value={alsStation} onChange={(e) => setAlsStation(e.target.value)}>
                <option value="All">All Stations</option>
                {stations.filter(s => !allowedStations || allowedStations.includes(s.code)).map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
            )}
          </div>
          <CardHeader title="Transition History Log" icon={<History size={16} />} subtitle={`${filteredHistory.length} transitions`} />
          <DataTable
            columns={historyColumns}
            data={filteredHistory.map((a) => ({ ...a, id: a.id }))}
            isLoading={isLoading}
            emptyTitle="No history yet"
            emptyDesc="Asset status changes will appear here matching your Excel sheet."
            emptyIcon={<History size={28} />}
          />
        </Card>
      )}

      {/* Update Status Modal */}
      <Modal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title="Update Asset Status (Split Quantity)"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button variant="warning" isLoading={submitting} onClick={handleStatusUpdate} disabled={!newStatus || !updateQty}>
              Update Status
            </Button>
          </>
        }
      >
        {selected && (
          <>
            {error && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}
            <div style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>
              <p><strong>Item:</strong> {selected.inventory_items?.name}</p>
              <p>Good (In Use): {selected.quantity_in_use || 0} | Damaged: {selected.quantity_damaged || 0} | Disposed: {selected.quantity_disposed || 0}</p>
            </div>
            
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="asset-from-status">Source Status (Moving From)</label>
              <select id="asset-from-status" className="form-control" value={selected.transitionFrom} onChange={(e) => {
                setSelected({...selected, transitionFrom: e.target.value});
                setNewStatus('');
              }} required>
                {getAvailableFromStatuses(selected).map((s) => (
                  <option key={s} value={s}>{ASSET_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="asset-new-status">Target Status (Moving To)</label>
              <select id="asset-new-status" className="form-control" value={newStatus} onChange={(e) => setNewStatus(e.target.value)} required disabled={!selected.transitionFrom}>
                <option value="">— Select Target Status —</option>
                {getNextStatuses(selected.transitionFrom).map((s) => (
                  <option key={s} value={s}>{ASSET_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="asset-qty">Quantity to Transition</label>
              <input id="asset-qty" type="number" min="0.001" step="any" className="form-control"
                value={updateQty} onChange={(e) => setUpdateQty(e.target.value)} required />
              <small style={{ color: 'var(--color-text-muted)' }}>Amount of items moving to {newStatus ? ASSET_STATUS_LABELS[newStatus] : 'the new state'}.</small>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="asset-remarks">Remarks</label>
              <textarea id="asset-remarks" className="form-control" rows={3}
                value={remarks} onChange={(e) => setRemarks(e.target.value)}
                placeholder="Describe the damage or reason for disposal…" />
            </div>
          </>
        )}
      </Modal>

      {/* Edit Log Modal */}
      <Modal
        isOpen={!!editingLog}
        onClose={() => setEditingLog(null)}
        title="Edit Transition Log"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditingLog(null)}>Cancel</Button>
            <Button variant="warning" form="edit-log-form" type="submit" isLoading={submitting}>
              Save Changes
            </Button>
          </>
        }
      >
        {editingLog && (
          <form id="edit-log-form" onSubmit={handleSaveEditLog}>
            {error && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}
            <div style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>
              <p><strong>Item:</strong> {editingLog.inventory_items?.name}</p>
              <p><strong>Transition:</strong> <AssetStatusBadge status={editingLog.from_status} /> &rarr; <AssetStatusBadge status={editingLog.to_status} /></p>
              <p><strong>Original Quantity:</strong> {editingLog.quantity}</p>
            </div>
            
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="el-qty">New Quantity</label>
              <input id="el-qty" type="number" min="0.001" step="any" className="form-control"
                value={editLogForm.quantity} onChange={(e) => setEditLogForm(f => ({ ...f, quantity: e.target.value }))} required />
              <small style={{ color: 'var(--color-text-muted)' }}>Changing this will automatically adjust the stock buckets.</small>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="el-remarks">Remarks</label>
              <textarea id="el-remarks" className="form-control" rows={2}
                value={editLogForm.remarks} onChange={(e) => setEditLogForm(f => ({ ...f, remarks: e.target.value }))} />
            </div>
          </form>
        )}
      </Modal>
    </Layout>
  );
}
