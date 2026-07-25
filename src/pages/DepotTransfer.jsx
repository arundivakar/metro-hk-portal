import React, { useEffect, useState, useCallback } from 'react';
import { Warehouse, Plus, ArrowUpFromLine, ArrowDownToLine, Pencil, Trash2 } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader } from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import SearchableSelect from '../components/ui/SearchableSelect';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { supabase } from '../lib/supabase';
import { ROLES } from '../lib/constants';
import { toDisplayValue, getDisplayUnit, toBaseValue } from '../utils/units';
import { formatDate } from '../utils/dateHelpers';
import toast from 'react-hot-toast';

const today = new Date().toISOString().split('T')[0];

export default function DepotTransfer() {
  const { role, profile } = useAuthStore();
  const { selectedStation } = useStationStore();

  const todayDate = new Date();
  const currentMonthStr = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr);

  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [stations, setStations] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // 'send' = station → Depot  |  'receive' = Depot → station
  const [transferType, setTransferType] = useState('send');

  // ── Send to Depot form state ──────────────────────────────────────────────
  const [sendForm, setSendForm] = useState({
    source_station_id: '',
    item_id: '',
    quantity: '',
    transfer_date: today,
    remarks: '',
  });
  const [sourceItems, setSourceItems] = useState([]);
  const [sourceStockMap, setSourceStockMap] = useState({});

  // ── Receive from Depot form state ─────────────────────────────────────────
  const [receiveForm, setReceiveForm] = useState({
    item_id: '',
    quantity: '',
    received_date: today,
    invoice_number: '',
    unit_rate: '',
    remarks: '',
  });

  // ── Edit state ────────────────────────────────────────────────────────────
  const [editingLog, setEditingLog] = useState(null);
  const [editForm, setEditForm] = useState({
    quantity: '',
    date: today,
    remarks: '',
  });

  // ── Data Loading ──────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!selectedStation?.id) return;
    setIsLoading(true);
    try {
      const [year, month] = selectedMonth.split('-');
      const startDate = `${year}-${month}-01`;
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

      const [sentRes, receivedRes, itemsRes, stationsRes] = await Promise.all([
        // Sent to Depot: consumption_logs across all stations with Depot Transfer Out remarks
        supabase.from('consumption_logs')
          .select('*, inventory_items(name, unit), stations(code, name), users_profile(full_name)')
          .like('remarks', 'Depot Transfer Out%')
          .gte('consumption_date', startDate)
          .lte('consumption_date', endDate)
          .order('consumption_date', { ascending: false }),

        // Received from Depot: stock_received across all stations where supplier='DEPOT'
        supabase.from('stock_received')
          .select('*, inventory_items(name, unit, rate_master(nos_per_kg)), stations!station_id(code, name), users_profile(full_name)')
          .eq('supplier', 'DEPOT')
          .gte('received_date', startDate)
          .lte('received_date', endDate)
          .order('received_date', { ascending: false }),

        // Catalogue for form dropdowns
        supabase.from('inventory_items')
          .select('id, name, unit, rate_master(unit_rate)')
          .order('name'),

        // All active stations for the source-station picker
        supabase.from('stations')
          .select('id, code, name')
          .eq('is_active', true)
          .order('code'),
      ]);

      const sent = (sentRes.data ?? []).map(r => ({ ...r, _type: 'send', _date: r.consumption_date }));
      const received = (receivedRes.data ?? []).map(r => ({ ...r, _type: 'receive', _date: r.received_date }));
      const combined = [...sent, ...received].sort((a, b) => new Date(b._date) - new Date(a._date));

      setLogs(combined);
      setItems(itemsRes.data ?? []);
      setStations(stationsRes.data ?? []);
    } catch (err) {
      console.error('DepotTransfer loadData error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedStation?.id, selectedMonth]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Source station selection (Send form) ──────────────────────────────────
  const handleSourceStationChange = async (stationId) => {
    setSendForm(f => ({ ...f, source_station_id: stationId, item_id: '', quantity: '' }));
    setSourceItems([]);
    setSourceStockMap({});
    if (!stationId) return;
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
    setSourceStockMap(map);
    setSourceItems(itemList);
  };

  // ── Submit: Send to Depot ─────────────────────────────────────────────────
  const handleSendSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const { source_station_id, item_id, quantity, transfer_date } = sendForm;
    if (!source_station_id || !item_id || !quantity || !transfer_date) {
      setError('All fields are required.');
      return;
    }
    const sourceItem = sourceItems.find(i => i.id === item_id);
    const baseQty = toBaseValue(parseFloat(quantity), sourceItem?.unit || 'Nos');
    const srcAvail = sourceStockMap[item_id] || 0;
    if (baseQty > srcAvail) {
      const du = getDisplayUnit(sourceItem?.unit || 'Nos');
      const ad = toDisplayValue(srcAvail, sourceItem?.unit || 'Nos');
      setError(`Insufficient stock. Available: ${du === 'Nos' ? `${Math.round(ad)} Nos` : `${ad.toFixed(2)} ${du}`}`);
      return;
    }
    const srcStation = stations.find(s => s.id === source_station_id);
    setSubmitting(true);
    try {
      const { error: rpcErr } = await supabase.rpc('fn_transfer_to_depot', {
        p_source_station_id:   source_station_id,
        p_item_id:             item_id,
        p_quantity:            baseQty,
        p_transfer_date:       transfer_date,
        p_source_station_code: srcStation?.code || '',
        p_logged_by:           profile.id,
        p_remarks:             `to Depot${sendForm.remarks ? ' - ' + sendForm.remarks : ''}`,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      toast.success(`Stock from ${srcStation?.code} sent to Depot!`);
      closeModal();
      loadData();
    } catch (err) {
      setError(err.message.includes('Insufficient') ? err.message : 'Transfer failed: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Submit: Receive from Depot ────────────────────────────────────────────
  const handleReceiveSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const { item_id, quantity, received_date } = receiveForm;
    if (!item_id || !quantity || !received_date) {
      setError('Item, quantity and date are required.');
      return;
    }
    const item = items.find(i => i.id === item_id);
    const baseQty = toBaseValue(parseFloat(quantity), item?.unit || 'Nos');
    setSubmitting(true);
    try {
      const { error: dbErr } = await supabase.from('stock_received').insert({
        station_id:     selectedStation.id,
        item_id,
        quantity:       baseQty,
        received_date:  receiveForm.received_date,
        invoice_number: receiveForm.invoice_number || null,
        supplier:       'DEPOT',
        unit_rate:      receiveForm.unit_rate ? parseFloat(receiveForm.unit_rate) : null,
        remarks:        receiveForm.remarks || null,
        received_by:    profile.id,
      });
      if (dbErr) throw dbErr;
      toast.success('Depot receipt recorded successfully!');
      closeModal();
      loadData();
    } catch (err) {
      setError('Failed to save: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Edit & Delete Actions ─────────────────────────────────────────────────
  const openEditModal = (log) => {
    const isSend = log._type === 'send';
    const unit = log.inventory_items?.unit || 'Nos';
    const rawQty = isSend ? log.quantity_used : log.quantity;
    setEditingLog(log);
    setEditForm({
      quantity: toDisplayValue(rawQty, unit),
      date: isSend ? log.consumption_date : log.received_date,
      remarks: log.remarks || '',
    });
    setError('');
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingLog) return;
    setError('');
    setSubmitting(true);
    try {
      const isSend = editingLog._type === 'send';
      const unit = editingLog.inventory_items?.unit || 'Nos';
      const baseQty = toBaseValue(parseFloat(editForm.quantity), unit);
      
      let errorResult;
      if (isSend) {
        const { error: rpcErr } = await supabase.rpc('fn_edit_consumption', {
          p_log_id: editingLog.id,
          p_new_quantity: baseQty,
          p_new_date: editForm.date,
          p_remarks: editForm.remarks,
        });
        errorResult = rpcErr;
      } else {
        const { error: rpcErr } = await supabase.rpc('fn_edit_stock_received', {
          p_log_id: editingLog.id,
          p_new_quantity: baseQty,
          p_new_date: editForm.date,
          p_remarks: editForm.remarks,
        });
        errorResult = rpcErr;
      }

      if (errorResult) throw new Error(errorResult.message);
      toast.success('Record updated successfully!');
      setEditingLog(null);
      loadData();
    } catch (err) {
      setError(err.message || 'Failed to update record');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (log) => {
    if (!window.confirm('Are you sure you want to delete this record? This will revert the inventory balance.')) return;
    const isSend = log._type === 'send';
    try {
      let errorResult;
      if (isSend) {
        const { error } = await supabase.rpc('fn_delete_consumption', { p_log_id: log.id });
        errorResult = error;
      } else {
        const { error } = await supabase.rpc('fn_delete_stock_received', { p_log_id: log.id });
        errorResult = error;
      }
      if (errorResult) throw errorResult;
      toast.success('Record deleted successfully!');
      loadData();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setError('');
    setSendForm({ source_station_id: '', item_id: '', quantity: '', transfer_date: today, remarks: '' });
    setReceiveForm({ item_id: '', quantity: '', received_date: today, invoice_number: '', unit_rate: '', remarks: '' });
    setSourceItems([]);
    setSourceStockMap({});
  };

  // ── Guard: only MUTT SC ───────────────────────────────────────────────────
  if (role !== ROLES.SC || selectedStation?.code !== 'MUTT') {
    return (
      <Layout title="Depot Transfer" subtitle="MUTT Station">
        <Alert variant="danger">This page is only accessible to MUTT Station Controllers.</Alert>
      </Layout>
    );
  }

  // ── Summary counters ──────────────────────────────────────────────────────
  const sentCount     = logs.filter(l => l._type === 'send').length;
  const receivedCount = logs.filter(l => l._type === 'receive').length;

  const selectedSendItem = sourceItems.find(i => i.id === sendForm.item_id);
  const selectedReceiveItem = items.find(i => i.id === receiveForm.item_id);

  return (
    <Layout
      title="Depot Transfer"
      subtitle={`${selectedStation?.code} — ${selectedStation?.name}`}
      actions={
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label style={{ fontSize: '13px', fontWeight: 600 }}>Month:</label>
          <input
            type="month"
            className="form-control"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            style={{ width: 'auto' }}
          />
          <Button
            variant="accent"
            leftIcon={<Plus size={16} />}
            onClick={() => { setShowModal(true); setTransferType('send'); setError(''); }}
          >
            New Depot Transfer
          </Button>
        </div>
      }
    >
      {/* ── Summary Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <div style={summaryCardStyle('#fff7ed', '#c2410c')}>
          <ArrowUpFromLine size={20} color="#c2410c" />
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#c2410c' }}>{sentCount}</div>
            <div style={{ fontSize: '12px', color: '#92400e', fontWeight: 600 }}>Sent to Depot</div>
          </div>
        </div>
        <div style={summaryCardStyle('#f0fdf4', '#15803d')}>
          <ArrowDownToLine size={20} color="#15803d" />
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#15803d' }}>{receivedCount}</div>
            <div style={{ fontSize: '12px', color: '#166534', fontWeight: 600 }}>Received from Depot</div>
          </div>
        </div>
        <div style={summaryCardStyle('#eff6ff', '#1d4ed8')}>
          <Warehouse size={20} color="#1d4ed8" />
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#1d4ed8' }}>{logs.length}</div>
            <div style={{ fontSize: '12px', color: '#1e40af', fontWeight: 600 }}>Total Transactions</div>
          </div>
        </div>
      </div>

      {/* ── Transfer Log Table ── */}
      <Card>
        <CardHeader
          title="Depot Transfer Log"
          icon={<Warehouse size={16} />}
          subtitle={`${logs.length} records for ${selectedMonth}`}
        />
        <div style={{ overflowX: 'auto' }}>
          {isLoading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-gray-400)' }}>Loading…</div>
          ) : logs.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-gray-400)' }}>
              <Warehouse size={32} style={{ marginBottom: '8px', opacity: 0.3 }} />
              <div style={{ fontWeight: 600 }}>No depot transfers this month</div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>Use "New Depot Transfer" to add one.</div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--color-gray-50)', borderBottom: '2px solid var(--color-border)' }}>
                  {['Date', 'Type', 'Station', 'Item', 'Sent to Depot', 'Received from Depot', 'Invoice #', 'By', 'Remarks', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: (h === 'Sent to Depot' || h === 'Received from Depot' || h === 'Actions') ? 'right' : 'left', fontWeight: 700, color: 'var(--color-gray-600)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log, idx) => {
                  const isSend = log._type === 'send';
                  const unit = log.inventory_items?.unit || 'Nos';
                  const dispUnit = getDisplayUnit(unit);
                  const rawQty = isSend ? log.quantity_used : log.quantity;
                  const dispQty = toDisplayValue(rawQty, unit);
                  const fmtQty = dispUnit === 'Nos' ? `${Math.round(dispQty)} Nos` : `${dispQty.toFixed(2)} ${dispUnit}`;
                  const byName = log.users_profile?.full_name ?? '—';
                  const extraRemark = isSend
                    ? (log.remarks || '').replace(/^Depot Transfer Out\s*-?\s*to Depot\s*-?\s*/, '').trim()
                    : (log.remarks || '');
                  const stationCode = log.stations?.code ?? log.stations?.code ?? '—';

                  return (
                    <tr
                      key={log.id}
                      style={{ borderBottom: '1px solid var(--color-gray-100)', background: idx % 2 === 0 ? 'transparent' : 'var(--color-gray-50)' }}
                    >
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{formatDate(log._date)}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 700,
                          background: isSend ? '#fff7ed' : '#f0fdf4',
                          color: isSend ? '#c2410c' : '#15803d',
                        }}>
                          {isSend ? <ArrowUpFromLine size={10} /> : <ArrowDownToLine size={10} />}
                          {isSend ? 'Sent' : 'Received'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--color-primary-700)' }}>{stationCode}</td>
                      <td style={{ padding: '8px 12px' }}>{log.inventory_items?.name ?? '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: isSend ? 600 : 400, color: isSend ? '#c2410c' : 'var(--color-gray-300)' }}>
                        {isSend ? fmtQty : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: !isSend ? 600 : 400, color: !isSend ? '#15803d' : 'var(--color-gray-300)' }}>
                        {!isSend ? fmtQty : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--color-gray-500)' }}>{!isSend ? (log.invoice_number || '—') : '—'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--color-gray-600)', whiteSpace: 'nowrap' }}>{byName}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--color-gray-500)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{extraRemark || '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => openEditModal(log)}
                          title="Edit"
                          style={{ background: 'none', border: 'none', color: 'var(--color-primary-600)', cursor: 'pointer', padding: '4px', marginRight: '4px' }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(log)}
                          title="Delete"
                          style={{ background: 'none', border: 'none', color: 'var(--color-danger-600)', cursor: 'pointer', padding: '4px' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* ── Add Transfer Modal ── */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title="New Depot Transfer"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button
              variant={transferType === 'send' ? 'warning' : 'accent'}
              form="depot-transfer-form"
              type="submit"
              isLoading={submitting}
            >
              {transferType === 'send' ? 'Confirm — Send to Depot' : 'Confirm — Receive from Depot'}
            </Button>
          </>
        }
      >
        {/* Direction Toggle */}
        <div style={{ display: 'flex', gap: '0', marginBottom: '20px', border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
          {[
            { value: 'send', label: '🏭 Send to Depot', icon: <ArrowUpFromLine size={14} /> },
            { value: 'receive', label: '📦 Receive from Depot', icon: <ArrowDownToLine size={14} /> },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { setTransferType(opt.value); setError(''); }}
              style={{
                flex: 1,
                padding: '10px 16px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: transferType === opt.value ? 700 : 500,
                fontSize: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                background: transferType === opt.value
                  ? (opt.value === 'send' ? '#fff7ed' : '#f0fdf4')
                  : 'var(--color-gray-50)',
                color: transferType === opt.value
                  ? (opt.value === 'send' ? '#c2410c' : '#15803d')
                  : 'var(--color-gray-500)',
                borderBottom: transferType === opt.value
                  ? `2px solid ${opt.value === 'send' ? '#c2410c' : '#15803d'}`
                  : '2px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>

        {error && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}

        {/* ── Send to Depot Form ── */}
        {transferType === 'send' && (
          <form id="depot-transfer-form" onSubmit={handleSendSubmit}>
            <Alert variant="warning" style={{ marginBottom: 'var(--space-3)' }}>
              Stock will be <strong>deducted</strong> from the selected station. This does <strong>not affect billing</strong>.
            </Alert>
            <div className="form-group">
              <label className="form-label form-label-required">Source Station</label>
              <select className="form-control" value={sendForm.source_station_id}
                onChange={e => handleSourceStationChange(e.target.value)} required>
                <option value="">— Select Station —</option>
                {stations.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            {sendForm.source_station_id && (
              <div className="form-group">
                <label className="form-label form-label-required">Item</label>
                <select className="form-control" value={sendForm.item_id}
                  onChange={e => setSendForm(f => ({ ...f, item_id: e.target.value, quantity: '' }))} required>
                  <option value="">— Select Item —</option>
                  {sourceItems.map(i => {
                    const du = getDisplayUnit(i.unit);
                    const raw = sourceStockMap[i.id] || 0;
                    const dv = toDisplayValue(raw, i.unit);
                    const fmt = du === 'Nos' ? `${Math.round(dv)} Nos` : `${dv.toFixed(2)} ${du}`;
                    return <option key={i.id} value={i.id}>{i.name} (Stock: {fmt})</option>;
                  })}
                </select>
                {sourceItems.length === 0 && <small style={{ color: 'var(--color-warning-600)' }}>No stock available at this station.</small>}
              </div>
            )}
            {sendForm.item_id && selectedSendItem && (() => {
              const du = getDisplayUnit(selectedSendItem.unit);
              const raw = sourceStockMap[sendForm.item_id] || 0;
              const dv = toDisplayValue(raw, selectedSendItem.unit);
              const fmt = du === 'Nos' ? `${Math.round(dv)} Nos` : `${dv.toFixed(2)} ${du}`;
              return (
                <>
                  <Alert variant="info" style={{ marginBottom: 'var(--space-3)' }}>Available: <strong>{fmt}</strong></Alert>
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label form-label-required">Quantity ({du})</label>
                      <input type="number" min="0.001" step="any" className="form-control"
                        value={sendForm.quantity} onChange={e => setSendForm(f => ({ ...f, quantity: e.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label form-label-required">Transfer Date</label>
                      <input type="date" className="form-control"
                        value={sendForm.transfer_date} onChange={e => setSendForm(f => ({ ...f, transfer_date: e.target.value }))} required />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Remarks (Optional)</label>
                    <textarea className="form-control" rows={2}
                      value={sendForm.remarks} onChange={e => setSendForm(f => ({ ...f, remarks: e.target.value }))} />
                  </div>
                </>
              );
            })()}
          </form>
        )}

        {/* ── Receive from Depot Form ── */}
        {transferType === 'receive' && (
          <form id="depot-transfer-form" onSubmit={handleReceiveSubmit}>
            <Alert variant="info" style={{ marginBottom: 'var(--space-3)' }}>
              Stock will be <strong>added</strong> to <strong>{selectedStation?.code}</strong>'s inventory from Depot.
            </Alert>
            <div className="form-group">
              <label className="form-label form-label-required">Item</label>
              <SearchableSelect
                options={items.map(i => ({ value: i.id, label: i.name }))}
                value={receiveForm.item_id}
                onChange={val => setReceiveForm(f => ({
                  ...f,
                  item_id: val,
                  unit_rate: items.find(i => i.id === val)?.rate_master?.unit_rate ?? '',
                }))}
                placeholder="Search items…"
                required
              />
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label form-label-required">
                  Quantity ({selectedReceiveItem ? getDisplayUnit(selectedReceiveItem.unit) : 'Units'})
                </label>
                <input type="number" min="0.001" step="any" className="form-control"
                  value={receiveForm.quantity} onChange={e => setReceiveForm(f => ({ ...f, quantity: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label form-label-required">Received Date</label>
                <input type="date" className="form-control"
                  value={receiveForm.received_date} onChange={e => setReceiveForm(f => ({ ...f, received_date: e.target.value }))} required />
              </div>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Invoice Number</label>
                <input type="text" className="form-control"
                  value={receiveForm.invoice_number} onChange={e => setReceiveForm(f => ({ ...f, invoice_number: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Unit Rate (₹)</label>
                <input type="number" min="0" step="0.01" className="form-control"
                  value={receiveForm.unit_rate} onChange={e => setReceiveForm(f => ({ ...f, unit_rate: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Remarks (Optional)</label>
              <textarea className="form-control" rows={2}
                value={receiveForm.remarks} onChange={e => setReceiveForm(f => ({ ...f, remarks: e.target.value }))} />
            </div>
          </form>
        )}
      </Modal>

      {/* ── Edit Log Modal ── */}
      <Modal
        isOpen={!!editingLog}
        onClose={() => setEditingLog(null)}
        title={`Edit ${editingLog?._type === 'send' ? 'Sent to Depot' : 'Received from Depot'}`}
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
              <p><strong>Station:</strong> {editingLog.stations?.code}</p>
            </div>
            <div className="form-group">
              <label className="form-label form-label-required">New Quantity ({getDisplayUnit(editingLog.inventory_items?.unit || 'Nos')})</label>
              <input type="number" min="0.001" step="any" className="form-control"
                value={editForm.quantity} onChange={(e) => setEditForm(f => ({ ...f, quantity: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label form-label-required">Date</label>
              <input type="date" className="form-control"
                value={editForm.date} onChange={(e) => setEditForm(f => ({ ...f, date: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label className="form-label">Remarks</label>
              <textarea className="form-control" rows={2}
                value={editForm.remarks} onChange={(e) => setEditForm(f => ({ ...f, remarks: e.target.value }))} />
            </div>
          </form>
        )}
      </Modal>
    </Layout>
  );
}

// ── Helper ──────────────────────────────────────────────────────────────────
function summaryCardStyle(bg, accent) {
  return {
    background: bg,
    border: `1px solid ${accent}22`,
    borderRadius: '12px',
    padding: '16px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  };
}
