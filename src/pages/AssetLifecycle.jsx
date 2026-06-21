import React, { useEffect, useState } from 'react';
import { Boxes, Plus, ChevronRight, History, PackagePlus } from 'lucide-react';
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
import { ROLES, ASSET_STATUS, ASSET_STATUS_LABELS, ALS_GROUPS } from '../lib/constants';
import toast from 'react-hot-toast';

export default function AssetLifecycle() {
  const { role, profile } = useAuthStore();
  const { selectedStation, alsGroupFilter } = useStationStore();

  const [activeTab, setActiveTab] = useState('assets'); // 'assets' or 'history'
  const [assets, setAssets] = useState([]);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Status Update Modal
  const [selected, setSelected] = useState(null);
  const [newStatus, setNewStatus] = useState('');
  const [updateQty, setUpdateQty] = useState('');
  const [remarks, setRemarks] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [alsStation, setAlsStation] = useState('All');
  const [stations, setStations] = useState([]);

  const allowedStations = ALS_GROUPS[alsGroupFilter];

  const stageCounts = {
    in_use: assets.filter((a) => a.status === ASSET_STATUS.IN_USE && (role !== ROLES.ALS || !allowedStations || allowedStations.includes(a.stations?.code))).length,
    partially_damaged: assets.filter((a) => a.status === ASSET_STATUS.PARTIALLY_DAMAGED && (role !== ROLES.ALS || !allowedStations || allowedStations.includes(a.stations?.code))).length,
    disposed: assets.filter((a) => a.status === ASSET_STATUS.DISPOSED && (role !== ROLES.ALS || !allowedStations || allowedStations.includes(a.stations?.code))).length,
  };

  useEffect(() => { 
    if (activeTab === 'assets') loadData(); 
    else loadHistory();
  }, [selectedStation?.id, role, activeTab]); 

  const loadData = async () => {
    setIsLoading(true);
    try {
      let query = supabase.from('consumable_assets')
        .select(`
          *,
          inventory_items ( name, unit, category ),
          stations ( code, name ),
          users_profile!consumable_assets_updated_by_fkey ( full_name )
        `)
        .order('created_at', { ascending: false });

      if (role !== ROLES.ALS && selectedStation?.id) {
        query = query.eq('station_id', selectedStation.id);
      }

      const { data, error: err } = await query;
      if (err) throw err;
      setAssets(data ?? []);

      if (role === ROLES.ALS) {
        const { data: stationsData } = await supabase.from('stations').select('id,code,name').eq('is_active', true).order('code');
        setStations(stationsData ?? []);
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

      if (role !== ROLES.ALS && selectedStation?.id) {
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
    if (qty <= 0 || qty > selected.quantity) {
      setError('Invalid quantity. Must be between 0.1 and ' + selected.quantity);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const { error: err } = await supabase.rpc('fn_update_asset_status_split', {
        p_asset_id: selected.id,
        p_new_status: newStatus,
        p_quantity: qty,
        p_remarks: remarks || null,
        p_user_id: profile.id
      });
      if (err) throw err;
      
      toast.success('Asset status updated!');
      setSelected(null);
      loadData();
    } catch (err) {
      setError(err.message.includes('function fn_update_asset_status_split') 
        ? 'Database update required. Please run the SQL script provided.' 
        : err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const getNextStatuses = (currentStatus) => {
    if (currentStatus === ASSET_STATUS.IN_USE) return [ASSET_STATUS.PARTIALLY_DAMAGED, ASSET_STATUS.DISPOSED];
    if (currentStatus === ASSET_STATUS.PARTIALLY_DAMAGED) return [ASSET_STATUS.DISPOSED];
    return [];
  };

  const filteredAssets = assets
    .filter((a) => statusFilter === 'All' || a.status === statusFilter)
    .filter((a) => role !== ROLES.ALS || !allowedStations || allowedStations.includes(a.stations?.code))
    .filter((a) => role !== ROLES.ALS || alsStation === 'All' || a.stations?.code === alsStation);

  const filteredHistory = historyLogs
    .filter((a) => role !== ROLES.ALS || !allowedStations || allowedStations.includes(a.stations?.code))
    .filter((a) => role !== ROLES.ALS || alsStation === 'All' || a.stations?.code === alsStation);

  const assetColumns = [
    ...(role === ROLES.ALS ? [{ key: 'station', label: 'Station', render: (_, r) => r.stations?.code ?? '—' }] : []),
    { key: 'item', label: 'Item', render: (_, r) => r.inventory_items?.name ?? '—' },
    { key: 'category', label: 'Category', render: (_, r) => r.inventory_items?.category ?? '—' },
    { key: 'quantity', label: 'Quantity', render: (v, r) => `${v} ${r.inventory_items?.unit ?? ''}` },
    { key: 'issued_date', label: 'Issued Date', sortable: true, render: (v) => v ? new Date(v).toLocaleDateString('en-IN') : '—' },
    { key: 'status', label: 'Current Status', render: (v) => <AssetStatusBadge status={v} /> },
    { key: 'updated_by', label: 'Updated By', render: (_, r) => r.users_profile?.full_name ?? '—' },
    ...(role === ROLES.SC ? [{
      key: 'actions', label: 'Actions',
      render: (_, r) => {
        const nextStatuses = getNextStatuses(r.status);
        if (nextStatuses.length === 0) return <span style={{ color: 'var(--color-gray-400)', fontSize: 'var(--font-size-xs)' }}>Final Stage</span>;
        return (
          <Button variant="outline" size="sm" onClick={() => { 
            setSelected(r); 
            setNewStatus(''); 
            setUpdateQty(r.quantity.toString()); 
            setRemarks(''); 
            setError(''); 
          }}>
            Update Status
          </Button>
        );
      },
    }] : []),
  ];

  const historyColumns = [
    { key: 'created_at', label: 'Date', render: (v) => new Date(v).toLocaleDateString('en-IN') },
    ...(role === ROLES.ALS ? [{ key: 'station', label: 'Station', render: (_, r) => r.stations?.code ?? '—' }] : []),
    { key: 'item', label: 'Cleaning Material', render: (_, r) => r.inventory_items?.name ?? '—' },
    { key: 'quantity', label: 'Quantity', render: (v, r) => `${v} ${r.inventory_items?.unit ?? ''}` },
    { key: 'from_status', label: 'Initial Status', render: (v) => v === 'Stock' ? <span className="badge" style={{ background: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>Stock</span> : <AssetStatusBadge status={v} /> },
    { key: 'to_status', label: 'Current Status', render: (v) => <AssetStatusBadge status={v} /> },
    { key: 'remarks', label: 'Remarks', render: (v) => v || '—' },
    { key: 'logged_by', label: 'Logged By', render: (_, r) => r.users_profile?.full_name ?? '—' },
  ];

  return (
    <Layout
      title="Asset Lifecycle"
      subtitle={role === ROLES.ALS ? 'All stations' : selectedStation?.name}
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
          <Boxes size={16} /> Assets In Use
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
            {role === ROLES.ALS && (
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
            {role === ROLES.ALS && (
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
              <p><strong>Current Status:</strong> <AssetStatusBadge status={selected.status} /></p>
              <p><strong>Total Available in this Batch:</strong> {selected.quantity} {selected.inventory_items?.unit}</p>
            </div>
            
            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="asset-qty">Quantity to Transition</label>
              <input id="asset-qty" type="number" min="0.001" max={selected.quantity} step="any" className="form-control"
                value={updateQty} onChange={(e) => setUpdateQty(e.target.value)} required />
              <small style={{ color: 'var(--color-text-muted)' }}>You can split this batch by transitioning a partial quantity.</small>
            </div>

            <div className="form-group">
              <label className="form-label form-label-required" htmlFor="asset-new-status">New Status</label>
              <select id="asset-new-status" className="form-control" value={newStatus} onChange={(e) => setNewStatus(e.target.value)} required>
                <option value="">— Select new status —</option>
                {getNextStatuses(selected.status).map((s) => (
                  <option key={s} value={s}>{ASSET_STATUS_LABELS[s]}</option>
                ))}
              </select>
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
    </Layout>
  );
}
