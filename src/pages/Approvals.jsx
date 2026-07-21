import React, { useEffect, useState } from 'react';
import { CheckSquare, Check, X, ArrowRight, CheckCircle2 } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import { RequestStatusBadge, PriorityBadge } from '../components/ui/Badge';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { supabase, fetchAll } from '../lib/supabase';
import { ROLES, REQUEST_STATUS, APPROVAL_THRESHOLD, ALS_GROUPS } from '../lib/constants';
import { toDisplayValue, toBillingQty } from '../utils/units';
import { formatDate } from '../utils/dateHelpers';
import toast from 'react-hot-toast';

export default function Approvals() {
  const { role, profile } = useAuthStore();
  const { selectedStation, alsGroupFilter } = useStationStore();

  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState(null); // selected request for action modal
  const [action, setAction] = useState(''); // 'approved' | 'rejected' | 'completed'
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [scVerified, setScVerified] = useState(false);
  const [expenditure, setExpenditure] = useState({ approved: 0, pipeline: 0 });

  useEffect(() => { 
    loadRequests(); 
    if (role === ROLES.SC || role === ROLES.ALS) {
      loadExpenditure();
    }
  }, [selectedStation?.id, role, alsGroupFilter]); // eslint-disable-line

  const loadExpenditure = async () => {
    try {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      let query = supabase.from('consumable_requests')
        .select(`quantity, unit_rate, status, stations (code), inventory_items (unit, rate_master (nos_per_kg))`)
        .gte('created_at', monthStart)
        .neq('status', 'rejected');

      let consumptionQuery = supabase.from('consumption_logs')
        .select(`quantity_used, remarks, stations (code), inventory_items (unit, rate_master (unit_rate, nos_per_kg, tender_year))`)
        .gte('consumption_date', monthStart);

      if (role === ROLES.SC) {
        query = query.eq('station_id', selectedStation?.id);
      }

      const [reqRes, consRes] = await Promise.all([fetchAll(query), fetchAll(consumptionQuery)]);
      
      if (reqRes.error) throw reqRes.error;
      if (consRes.error) throw consRes.error;

      let approved = 0;
      let stationApproved = 0;
      let pipeline = 0;
      
      let validData = reqRes.data || [];
      let validConsData = consRes.data || [];

      if (role === ROLES.ALS) {
        const allowedStations = ALS_GROUPS[alsGroupFilter];
        if (allowedStations) {
           validData = validData.filter(r => r.stations && allowedStations.includes(r.stations.code));
           validConsData = validConsData.filter(r => r.stations && allowedStations.includes(r.stations.code));
        }
      }

      validData.forEach(r => {
        const nosPerKg = r.inventory_items?.rate_master?.nos_per_kg || null;
        const cost = toBillingQty(r.quantity, r.inventory_items?.unit, nosPerKg) * (r.unit_rate || 0);
        if (['pending', 'forwarded_sc', 'forwarded_als'].includes(r.status)) {
          pipeline += cost;
        }
      });
      
      validConsData.forEach(r => {
        if (r.remarks?.startsWith('Inter-Station Transfer Out') || r.remarks?.startsWith('Depot Transfer Out')) {
          return;
        }
        
        const tYearStr = r.inventory_items?.rate_master?.tender_year || '';
        if (tYearStr.toLowerCase().includes('before 2024')) return;
        const startYear = parseInt(tYearStr.split('-')[0]) || 0;
        if (startYear > 0 && startYear < 2024) return;
        
        const rate = r.inventory_items?.rate_master?.unit_rate || 0;
        const nosPerKg = r.inventory_items?.rate_master?.nos_per_kg || null;
        const cost = toBillingQty(r.quantity_used, r.inventory_items?.unit, nosPerKg) * rate;
        approved += cost;
        if (selectedStation && r.stations?.code === selectedStation.code) {
          stationApproved += cost;
        }
      });

      setExpenditure({ approved, stationApproved, pipeline });
    } catch (err) {
      console.error('Error loading expenditure:', err);
    }
  };

  const loadRequests = async () => {
    setIsLoading(true);
    try {
      let query = supabase.from('consumable_requests')
        .select(`
          *,
          inventory_items ( name, unit ),
          stations ( code, name ),
          users_profile!consumable_requests_requested_by_fkey ( full_name, employee_id )
        `)
        .order('created_at', { ascending: false });

      if (role === ROLES.SC) {
        // SC sees forwarded_sc requests for their station only
        query = query
          .eq('station_id', selectedStation?.id)
          .in('status', [REQUEST_STATUS.FORWARDED_SC]);
      } else if (role === ROLES.HKTL) {
        // HKTL sees pending requests globally
        query = query.in('status', [REQUEST_STATUS.PENDING]);
      } else if (role === ROLES.ALS) {
        // ALS sees forwarded_als requests (documentation/approval only — no stock deduction)
        query = query.in('status', [REQUEST_STATUS.FORWARDED_ALS]);
        
        // Apply ALS Group Filter
        const allowedStations = ALS_GROUPS[alsGroupFilter];
        if (allowedStations) {
          // We need to filter by station IDs matching the allowed codes
          // Since we join on stations, we can filter on the joined table in Supabase
          // or fetch stations first. Let's do client-side filtering for simplicity since
          // the list of requests isn't huge, or fetch station IDs.
          // Since `stations (code, name)` is joined, we can just filter `data` after fetch.
        }
      }

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

  const openAction = (req, act) => {
    setSelected(req);
    setAction(act);
    setComments('');
    setScVerified(false);
    setError('');
  };

  const handleAction = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError('');
    try {
      let newStatus = '';
      if (action === 'approved') {
        if (role === ROLES.HKTL) newStatus = REQUEST_STATUS.FORWARDED_SC;
        else if (role === ROLES.SC) newStatus = REQUEST_STATUS.APPROVED_SC;
        else newStatus = REQUEST_STATUS.APPROVED_ALS;
      } else if (action === 'rejected') {
        newStatus = REQUEST_STATUS.REJECTED;
      } else if (action === 'forwarded') {
        newStatus = REQUEST_STATUS.FORWARDED_ALS;
      } else if (action === 'completed') {
        newStatus = REQUEST_STATUS.COMPLETED;
      }

      // Update request status
      const { error: updateErr } = await supabase
        .from('consumable_requests')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', selected.id);
      if (updateErr) throw updateErr;

      // Insert approval record
      const { error: approvalErr } = await supabase.from('request_approvals').insert({
        request_id: selected.id,
        acted_by: profile.id,
        action,
        comments: comments || null,
      });
      if (approvalErr) throw approvalErr;

      toast.success(`Request ${action} successfully`);
      setSelected(null);
      loadRequests();
      if (role === ROLES.SC || role === ROLES.ALS) loadExpenditure();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    { key: 'created_at', label: 'Date', sortable: true, render: (v) => formatDate(v) },
    { key: 'station', label: 'Station', render: (_, r) => r.stations?.code ?? '—' },
    { key: 'requested_by', label: 'Requested By', render: (_, r) => r.users_profile?.full_name ?? r.users_profile?.employee_id ?? '—' },
    { key: 'item', label: 'Item', render: (_, r) => r.inventory_items?.name ?? '—' },
    { key: 'quantity', label: 'Qty', render: (v, r) => `${v} ${r.inventory_items?.unit ?? ''}` },
    {
      key: 'estimated_cost', label: 'Est. Cost',
      render: (v) => v ? (
        <span style={{ fontWeight: 600, color: Number(v) > APPROVAL_THRESHOLD ? 'var(--color-danger-600)' : 'var(--color-success-600)' }}>
          ₹{Number(v).toFixed(2)}
        </span>
      ) : '—',
    },
    { key: 'priority', label: 'Priority', render: (v) => <PriorityBadge priority={v} /> },
    { key: 'status', label: 'Status', render: (v) => <RequestStatusBadge status={v} /> },
    {
      key: 'actions', label: 'Actions',
      render: (_, r) => (
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          {/* HKTL actions */}
          {role === ROLES.HKTL && r.status === REQUEST_STATUS.PENDING && (
            <>
              <Button variant="success" size="sm" leftIcon={<Check size={12} />} onClick={() => openAction(r, 'approved')}>
                Approve (to SC)
              </Button>
              <Button variant="danger" size="sm" leftIcon={<X size={12} />} onClick={() => openAction(r, 'rejected')}>
                Reject
              </Button>
            </>
          )}
          {/* SC actions */}
          {role === ROLES.SC && r.status === REQUEST_STATUS.FORWARDED_SC && (
            <>
              {Number(r.estimated_cost) <= APPROVAL_THRESHOLD ? (
                <Button variant="success" size="sm" leftIcon={<Check size={12} />} onClick={() => openAction(r, 'approved')}>
                  Approve
                </Button>
              ) : (
                <Button variant="outline" size="sm" leftIcon={<ArrowRight size={12} />} onClick={() => openAction(r, 'forwarded')}>
                  Forward to ALS
                </Button>
              )}
              <Button variant="danger" size="sm" leftIcon={<X size={12} />} onClick={() => openAction(r, 'rejected')}>
                Reject
              </Button>
            </>
          )}
          {/* ALS actions */}
          {role === ROLES.ALS && r.status === REQUEST_STATUS.FORWARDED_ALS && (
            <>
              <Button variant="success" size="sm" leftIcon={<Check size={12} />} onClick={() => openAction(r, 'approved')}>
                Approve
              </Button>
              <Button variant="danger" size="sm" leftIcon={<X size={12} />} onClick={() => openAction(r, 'rejected')}>
                Reject
              </Button>
            </>
          )}
          {/* Mark completed */}
          {(r.status === REQUEST_STATUS.APPROVED_SC || r.status === REQUEST_STATUS.APPROVED_ALS) && (
            <Button variant="accent" size="sm" leftIcon={<CheckCircle2 size={12} />} onClick={() => openAction(r, 'completed')}>
              Complete
            </Button>
          )}
        </div>
      ),
    },
  ];

  let pageTitle = 'Approvals';
  if (role === ROLES.SC) pageTitle = 'Pending SC Approvals';
  if (role === ROLES.HKTL) pageTitle = 'Pending HKTL Approvals';
  if (role === ROLES.ALS) pageTitle = 'Forwarded Requests';

  const actionLabels = {
    approved: { label: role === ROLES.HKTL ? 'Approve & Forward' : 'Approve', variant: 'success' },
    rejected: { label: 'Reject', variant: 'danger' },
    forwarded: { label: 'Forward to ALS', variant: 'warning' },
    completed: { label: 'Mark as Completed', variant: 'accent' },
  };

  const pageSubtitle = `${requests.length} request${requests.length !== 1 ? 's' : ''} pending your action`;

  return (
    <Layout
      title={pageTitle}
      subtitle={pageSubtitle}
    >
      {(role === ROLES.SC || role === ROLES.ALS) && (
        <Card style={{ marginBottom: 'var(--space-5)' }}>
          <CardBody style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', alignItems: 'center', padding: 'var(--space-4) var(--space-5)' }}>
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-gray-500)', fontWeight: 600 }}>This Month's Spend (All Stations)</div>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800, color: 'var(--color-primary-700)', marginTop: 2 }}>
                ₹{expenditure.approved.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            {selectedStation && selectedStation.code !== 'ALL' && (
              <>
                <div style={{ width: 1, height: 36, background: 'var(--color-gray-200)' }} className="hide-on-mobile"></div>
                <div>
                  <div style={{ fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-gray-500)', fontWeight: 600 }}>{selectedStation.code} Spend</div>
                  <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 800, color: 'var(--color-primary-700)', marginTop: 2 }}>
                    ₹{(expenditure.stationApproved || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </>
            )}
            <div style={{ width: 1, height: 36, background: 'var(--color-gray-200)' }} className="hide-on-mobile"></div>
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-gray-500)', fontWeight: 600 }}>Awaiting Approval (Pipeline)</div>
              <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, color: 'var(--color-warning-600)', marginTop: 2 }}>
                ₹{expenditure.pipeline.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={`Requests (${requests.length})`} icon={<CheckSquare size={16} />} />
        <DataTable
          columns={columns}
          data={requests.map((r) => ({ ...r, id: r.id }))}
          isLoading={isLoading}
          emptyTitle="No pending items"
          emptyDesc="All caught up! There are no requests awaiting your action."
          emptyIcon={<CheckSquare size={28} />}
        />
      </Card>

      {/* Action Confirmation Modal */}
      <Modal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={`${actionLabels[action]?.label ?? 'Action'} Request`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button
              variant={actionLabels[action]?.variant ?? 'primary'}
              isLoading={submitting}
              onClick={handleAction}
              disabled={role === ROLES.SC && (action === 'approved' || action === 'forwarded') && !scVerified}
            >
              {actionLabels[action]?.label ?? 'Confirm'}
            </Button>
          </>
        }
      >
        {selected && (
          <>
            {error && <Alert variant="danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</Alert>}
            <div style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)' }}>
              <p><strong>Item:</strong> {selected.inventory_items?.name}</p>
              <p><strong>Quantity:</strong> {selected.quantity} {selected.inventory_items?.unit}</p>
              <p><strong>Estimated Cost:</strong> ₹{Number(selected.estimated_cost ?? 0).toFixed(2)}</p>
              <p><strong>Station:</strong> {selected.stations?.code}</p>
              {selected.reason && <p><strong>Reason:</strong> {selected.reason}</p>}
            </div>

            {/* SC Physical Verification Checklist */}
            {role === ROLES.SC && (action === 'approved' || action === 'forwarded') && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3)', background: 'var(--color-primary-50)', border: '1px solid var(--color-primary-200)', borderRadius: 'var(--radius-md)', cursor: 'pointer', marginBottom: 'var(--space-4)' }}>
                <input type="checkbox" checked={scVerified} onChange={(e) => setScVerified(e.target.checked)} disabled={submitting} />
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--color-primary-900)' }}>
                  Verified the current condition of the consumable, found actual requirement is needed.
                </span>
              </label>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="approval-comments">Comments (optional)</label>
              <textarea
                id="approval-comments"
                className="form-control"
                rows={3}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Add a comment or reason…"
              />
            </div>
          </>
        )}
      </Modal>
    </Layout>
  );
}
