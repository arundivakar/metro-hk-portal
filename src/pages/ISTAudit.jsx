import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, Info, Eye, Wrench, Clock, ChevronDown, ChevronUp
} from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { ROLES } from '../lib/constants';
import { formatDate } from '../utils/dateHelpers';
import toast from 'react-hot-toast';

// ─── Status badge config ────────────────────────────────────────────────────

const STATUS_CONFIG = {
  'Healthy': { color: 'var(--color-success-600)', bg: 'var(--color-success-50)', icon: CheckCircle2 },
  'Legacy':  { color: 'var(--color-info-600)',    bg: 'var(--color-info-50)',    icon: Info },
  'Orphan Destination':
    { color: 'var(--color-danger-600)',  bg: 'var(--color-danger-50)',  icon: XCircle },
  'Orphan Destination — Consumed Stock / Manual Review Required':
    { color: 'var(--color-danger-700)', bg: 'var(--color-danger-50)', icon: ShieldAlert },
  'Orphan Source':
    { color: 'var(--color-danger-600)',  bg: 'var(--color-danger-50)',  icon: XCircle },
  'Ambiguous / Manual Review':
    { color: 'var(--color-warning-700)', bg: 'var(--color-warning-50)', icon: AlertTriangle },
  'Potentially Repaired':
    { color: 'var(--color-warning-600)', bg: 'var(--color-warning-50)', icon: AlertTriangle },
  'Cannot Determine':
    { color: 'var(--color-gray-600)',    bg: 'var(--color-gray-100)',   icon: Info },
  // Unlinked: source_station_id IS NULL, supplier IS NULL, invoice IS NULL
  // Surfaced for admin review only — never auto-repaired
  'Unlinked Destination Receipt — Manual Review':
    { color: 'var(--color-warning-700)', bg: 'var(--color-warning-50)', icon: ShieldAlert },
  'Unlinked Destination Receipt — Consumed Stock / Manual Review Required':
    { color: 'var(--color-danger-700)',  bg: 'var(--color-danger-50)',  icon: ShieldAlert },
};

const ACTION_LABELS = {
  remove_orphan_dest:   'Remove Orphan Receipt',
  remove_orphan_source: 'Remove Orphan Transfer Out',
  redate_transfer:      'Re-date Transfer',
};

// ─── Status Badge Component ─────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['Cannot Determine'];
  const IconComp = cfg.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: cfg.bg, color: cfg.color,
      borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 600,
      whiteSpace: 'nowrap',
    }}>
      <IconComp size={12} />
      {status}
    </span>
  );
}

// ─── Summary Counts Card ────────────────────────────────────────────────────

function SummaryCards({ rows, onFilterChange, activeFilter }) {
  const counts = {
    'Healthy': 0,
    'Orphan Destination': 0,
    'Orphan Destination — Consumed Stock / Manual Review Required': 0,
    'Orphan Source': 0,
    'Ambiguous / Manual Review': 0,
    'Potentially Repaired': 0,
    'Legacy': 0,
    'Cannot Determine': 0,
    'Unlinked Destination Receipt — Manual Review': 0,
    'Unlinked Destination Receipt — Consumed Stock / Manual Review Required': 0,
  };
  rows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

  const cards = [
    { label: 'Healthy',           key: 'Healthy',                     variant: 'success' },
    { label: 'Orphan Dest',       key: 'Orphan Destination',          variant: 'danger'  },
    { label: 'Consumed / Manual', key: 'Orphan Destination — Consumed Stock / Manual Review Required', variant: 'danger' },
    { label: 'Orphan Source',     key: 'Orphan Source',               variant: 'danger'  },
    { label: 'Ambiguous',         key: 'Ambiguous / Manual Review',   variant: 'warning' },
    { label: 'Poss. Repaired',    key: 'Potentially Repaired',        variant: 'warning' },
    { label: 'Legacy',            key: 'Legacy',                      variant: 'info'    },
    { label: 'Undetermined',      key: 'Cannot Determine',            variant: 'neutral' },
    { label: 'Unlinked',          key: 'Unlinked Destination Receipt — Manual Review',           variant: 'warning' },
    { label: 'Unlinked+Consumed', key: 'Unlinked Destination Receipt — Consumed Stock / Manual Review Required', variant: 'danger' },
  ];

  const colorMap = {
    success: { bg: 'var(--color-success-50)', border: 'var(--color-success-200)', text: 'var(--color-success-700)' },
    danger:  { bg: 'var(--color-danger-50)',  border: 'var(--color-danger-200)',  text: 'var(--color-danger-700)'  },
    warning: { bg: 'var(--color-warning-50)', border: 'var(--color-warning-200)', text: 'var(--color-warning-700)'},
    info:    { bg: 'var(--color-info-50)',    border: 'var(--color-info-200)',    text: 'var(--color-info-700)'    },
    neutral: { bg: 'var(--color-gray-100)',   border: 'var(--color-gray-300)',    text: 'var(--color-gray-600)'    },
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
      <button
        onClick={() => onFilterChange(null)}
        style={{
          border: `2px solid ${activeFilter === null ? 'var(--color-primary-600)' : 'var(--color-gray-200)'}`,
          borderRadius: 8, padding: '8px 16px', background: activeFilter === null ? 'var(--color-primary-50)' : 'white',
          cursor: 'pointer', fontWeight: 600, fontSize: 13,
        }}
      >
        All ({rows.length})
      </button>
      {cards.map(c => {
        const col = colorMap[c.variant];
        const isActive = activeFilter === c.key;
        return (
          <button
            key={c.key}
            onClick={() => onFilterChange(c.key)}
            style={{
              border: `2px solid ${isActive ? col.text : col.border}`,
              borderRadius: 8, padding: '8px 16px',
              background: isActive ? col.border : col.bg,
              cursor: 'pointer', fontSize: 13, fontWeight: 600, color: col.text,
            }}
          >
            {c.label} ({counts[c.key]})
          </button>
        );
      })}
    </div>
  );
}

// ─── Detail Panel ───────────────────────────────────────────────────────────

function DetailPanel({ row, onClose, onRepair }) {
  const [redateValue, setRedateValue] = useState('');
  const [action, setAction] = useState('');

  const isBlockedOrphanDest =
    row.status === 'Orphan Destination — Consumed Stock / Manual Review Required';
  const isUnlinked =
    row.status === 'Unlinked Destination Receipt — Manual Review' ||
    row.status === 'Unlinked Destination Receipt — Consumed Stock / Manual Review Required';
  // Only clean Orphan Destination (linked, no subsequent consumption) is auto-repairable
  const canRemoveOrphanDest   = row.status === 'Orphan Destination' && row.dest_log_id;
  const canRemoveOrphanSource = row.status === 'Orphan Source'      && row.source_log_id;
  const canRedate = (row.status === 'Healthy' || row.status === 'Legacy' || row.status === 'Potentially Repaired')
                    && row.source_log_id && row.dest_log_id;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
      background: 'white', boxShadow: '-4px 0 20px rgba(0,0,0,0.12)',
      zIndex: 1000, display: 'flex', flexDirection: 'column', overflowY: 'auto',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 15 }}>Transfer Detail</strong>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--color-gray-500)' }}>×</button>
      </div>

      <div style={{ padding: 20, flex: 1, fontSize: 13 }}>
        <div style={{ marginBottom: 16 }}>
          <StatusBadge status={row.status} />
        </div>

        {/* Core fields */}
        {[
          ['Date',        formatDate(row.transfer_date)],
          ['Source',      row.source_station || '—'],
          ['Destination', row.dest_station   || '—'],
          ['Item',        row.item_name],
          ['Category',    row.item_category],
          ['Quantity',    `${row.quantity} ${row.item_unit}`],
          ['Link Method', row.link_method],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 120, color: 'var(--color-gray-500)', flexShrink: 0 }}>{label}</span>
            <span style={{ fontWeight: 600 }}>{val}</span>
          </div>
        ))}

        <div style={{ borderTop: '1px solid var(--color-gray-100)', margin: '12px 0' }} />

        {/* Record IDs */}
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: 'var(--color-gray-500)' }}>Source Log ID</span>
          <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: row.source_log_id ? 'var(--color-gray-800)' : 'var(--color-gray-400)' }}>
            {row.source_log_id || 'Missing'}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <span style={{ color: 'var(--color-gray-500)' }}>Destination Log ID</span>
          <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: row.dest_log_id ? 'var(--color-gray-800)' : 'var(--color-gray-400)' }}>
            {row.dest_log_id || 'Missing'}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--color-gray-100)', margin: '12px 0' }} />

        {/* Live stock */}
        {[
          ['Source Stock', row.source_current_stock != null ? `${row.source_current_stock} ${row.item_unit}` : '—'],
          ['Dest Stock',   row.dest_current_stock   != null ? `${row.dest_current_stock} ${row.item_unit}`   : '—'],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 120, color: 'var(--color-gray-500)', flexShrink: 0 }}>{label}</span>
            <span style={{ fontWeight: 600 }}>{val}</span>
          </div>
        ))}

        {/* Subsequent consumption warning */}
        {row.subsequent_consumption_at_dest > 0 && (
          <div style={{
            background: 'var(--color-danger-50)', border: '1px solid var(--color-danger-200)',
            borderRadius: 8, padding: 12, marginTop: 12,
          }}>
            <strong style={{ color: 'var(--color-danger-700)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldAlert size={14} /> Subsequent Consumption Detected
            </strong>
            <p style={{ margin: '6px 0 0', color: 'var(--color-danger-700)', fontSize: 12 }}>
              {row.subsequent_consumption_at_dest} {row.item_unit} consumed at {row.dest_station} after this receipt date.
              Automatic repair is blocked. Manual review required.
            </p>
          </div>
        )}

        {/* Replacement transfer */}
        {row.replacement_transfer_exists && (
          <div style={{
            background: 'var(--color-warning-50)', border: '1px solid var(--color-warning-200)',
            borderRadius: 8, padding: 12, marginTop: 12,
          }}>
            <strong style={{ color: 'var(--color-warning-700)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} /> Possible Replacement Transfer Detected
            </strong>
            <p style={{ margin: '6px 0 0', color: 'var(--color-warning-700)', fontSize: 12 }}>
              A transfer between the same source and destination exists within ±7 days. Verify before any repair.
            </p>
            {row.replacement_source_log_id && (
              <div style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 4, wordBreak: 'break-all' }}>
                Replacement source: {row.replacement_source_log_id}
              </div>
            )}
          </div>
        )}

        {/* Corroborating transfer evidence — shown only for unlinked records */}
        {isUnlinked && (
          <div style={{
            background: row.corroborating_transfer_exists ? 'var(--color-info-50)' : 'var(--color-gray-50)',
            border: `1px solid ${row.corroborating_transfer_exists ? 'var(--color-info-200)' : 'var(--color-gray-200)'}`,
            borderRadius: 8, padding: 12, marginTop: 12,
          }}>
            <strong style={{ color: row.corroborating_transfer_exists ? 'var(--color-info-700)' : 'var(--color-gray-600)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Info size={14} />
              {row.corroborating_transfer_exists
                ? 'Corroborating Transfer Out Found (Informational)'
                : 'No Corroborating Transfer Out Found'}
            </strong>
            {row.corroborating_transfer_exists ? (
              <>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-info-700)' }}>
                  A Transfer Out from <strong>{row.corroborating_source_station}</strong> for the same item and quantity exists within ±14 days.
                  This is for your information only — the system has NOT automatically paired these records.
                </p>
                {row.corroborating_source_log_id && (
                  <div style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 6, wordBreak: 'break-all', color: 'var(--color-gray-700)' }}>
                    Source log ID: {row.corroborating_source_log_id}
                  </div>
                )}
                <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-info-700)' }}>
                  If you have confirmed this is the matching source, use the targeted SQL approach with exact IDs after manual verification.
                </p>
              </>
            ) : (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-gray-500)' }}>
                No Transfer Out to this destination for same item/quantity was found within ±14 days. This receipt cannot be traced to any known IST source.
              </p>
            )}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--color-gray-100)', margin: '16px 0' }} />

        {/* Diagnosis */}
        <div>
          <span style={{ fontWeight: 600, color: 'var(--color-gray-700)' }}>Diagnosis</span>
          <p style={{ marginTop: 6, color: 'var(--color-gray-600)', lineHeight: 1.5 }}>{row.diagnosis}</p>
        </div>
        <div style={{ marginTop: 8 }}>
          <span style={{ fontWeight: 600, color: 'var(--color-gray-700)' }}>Recommended Action</span>
          <p style={{ marginTop: 6, color: 'var(--color-gray-600)', lineHeight: 1.5 }}>{row.recommended_action}</p>
        </div>

        {/* Repair actions */}
        {(canRemoveOrphanDest || canRemoveOrphanSource || canRedate) && !isBlockedOrphanDest && (
          <>
            <div style={{ borderTop: '1px solid var(--color-gray-100)', margin: '16px 0' }} />
            <div style={{ fontWeight: 600, color: 'var(--color-gray-700)', marginBottom: 10 }}>Repair Actions</div>

            {canRemoveOrphanDest && (
              <Button
                variant="danger"
                size="sm"
                style={{ width: '100%', marginBottom: 8 }}
                onClick={() => onRepair('remove_orphan_dest', row.dest_log_id, null)}
              >
                Remove Orphan Destination Receipt
              </Button>
            )}
            {canRemoveOrphanSource && (
              <Button
                variant="danger"
                size="sm"
                style={{ width: '100%', marginBottom: 8 }}
                onClick={() => onRepair('remove_orphan_source', row.source_log_id, null)}
              >
                Remove Orphan Source Transfer Out
              </Button>
            )}
            {canRedate && (
              <div style={{ marginTop: 8 }}>
                <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4 }}>
                  Re-date Transfer (new date for both sides)
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="date"
                    value={redateValue}
                    onChange={e => setRedateValue(e.target.value)}
                    style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--color-gray-300)', borderRadius: 6, fontSize: 13 }}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!redateValue}
                    onClick={() => onRepair('redate_transfer', row.source_log_id || row.dest_log_id, redateValue)}
                  >
                    Re-date
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {isBlockedOrphanDest && (
          <div style={{ marginTop: 16 }}>
            <Alert type="danger">
              Automatic repair is blocked for this record. {row.subsequent_consumption_at_dest} {row.item_unit} have been consumed at the destination. Manual admin intervention is required.
            </Alert>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Repair Preview Modal ───────────────────────────────────────────────────

function RepairPreviewModal({ preview, action, onApprove, onCancel, approving }) {
  if (!preview) return null;

  const canProceed = preview.safe_to_proceed;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'white', borderRadius: 12, padding: 28, maxWidth: 520, width: '90%',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>
          🔍 IST Repair Preview — {ACTION_LABELS[action] || action}
        </h3>

        {!canProceed ? (
          <Alert type="danger">
            <strong>Cannot proceed:</strong> {preview.failure_reason}
          </Alert>
        ) : (
          <>
            <Alert type="warning">
              Review carefully. This action cannot be undone automatically. An audit log will be created.
            </Alert>

            <div style={{ fontSize: 13, marginTop: 16 }}>
              {[
                ['Item',        preview.item_name + (preview.item_unit ? ' (' + preview.item_unit + ')' : '')],
                ['Source',      preview.source_station || '—'],
                ['Destination', preview.dest_station   || '—'],
                ['Quantity',    preview.quantity],
                ['Date',        preview.transfer_date  ? formatDate(preview.transfer_date) : '—'],
                preview.new_date ? ['New Date', formatDate(preview.new_date)] : null,
              ].filter(Boolean).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
                  <span style={{ width: 120, color: 'var(--color-gray-500)', flexShrink: 0 }}>{k}</span>
                  <span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--color-gray-100)', margin: '14px 0' }} />

            <div style={{ fontSize: 13 }}>
              <strong style={{ display: 'block', marginBottom: 8 }}>Stock Impact</strong>
              {preview.source_stock_before != null && (
                <div style={{ marginBottom: 4 }}>
                  Source: {preview.source_stock_before} → {preview.source_stock_after}
                  {preview.source_stock_after < preview.source_stock_before ? ' ✅' : ' ✅'}
                </div>
              )}
              {preview.dest_stock_before != null && (
                <div style={{ marginBottom: 4 }}>
                  Destination: {preview.dest_stock_before} → {preview.dest_stock_after}
                  {preview.dest_stock_after >= 0 ? ' ✅' : ' ❌ Would go negative!'}
                </div>
              )}
              {preview.source_stock_before == null && preview.dest_stock_before == null && (
                <span style={{ color: 'var(--color-gray-500)' }}>No stock values changed (re-date only)</span>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--color-gray-100)', margin: '14px 0' }} />

            <div style={{ fontSize: 12, color: 'var(--color-gray-600)' }}>
              <div>✅ Consumption records changed: {preview.consumption_records_changed ?? 0}</div>
              <div>✅ QIU changed: {preview.qiu_changed ?? 0}</div>
              <div>✅ Billing changed: {preview.billing_changed ?? 0}</div>
              <div>✅ Asset Lifecycle changed: {preview.asset_lifecycle_changed ?? 0}</div>
            </div>

            {preview.notes && (
              <div style={{ marginTop: 12, padding: 10, background: 'var(--color-gray-50)', borderRadius: 6, fontSize: 12, color: 'var(--color-gray-600)' }}>
                {preview.notes}
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onCancel} disabled={approving}>Cancel</Button>
          {canProceed && (
            <Button
              variant="danger"
              onClick={onApprove}
              disabled={approving}
            >
              {approving ? 'Executing…' : '✓ Approve Repair'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Repair History ─────────────────────────────────────────────────────────

function RepairHistory({ logs }) {
  if (!logs.length) return (
    <p style={{ color: 'var(--color-gray-500)', textAlign: 'center', padding: 32 }}>
      No repair actions have been executed yet.
    </p>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--color-gray-50)', borderBottom: '2px solid var(--color-gray-200)' }}>
            {['Date', 'Action', 'Source', 'Dest', 'Item', 'Qty', 'Stock Before→After', 'Notes'].map(h => (
              <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {logs.map(l => (
            <tr key={l.id} style={{ borderBottom: '1px solid var(--color-gray-100)' }}>
              <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{formatDate(l.repaired_at?.split('T')[0])}</td>
              <td style={{ padding: '10px 12px' }}>{l.repair_type}</td>
              <td style={{ padding: '10px 12px' }}>{l.source_station_id}</td>
              <td style={{ padding: '10px 12px' }}>{l.dest_station_id}</td>
              <td style={{ padding: '10px 12px' }}>{l.item_id}</td>
              <td style={{ padding: '10px 12px' }}>{l.quantity}</td>
              <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                {l.dest_stock_before != null ? `Dest: ${l.dest_stock_before} → ${l.dest_stock_after}` : ''}
                {l.source_stock_before != null ? `Src: ${l.source_stock_before} → ${l.source_stock_after}` : ''}
              </td>
              <td style={{ padding: '10px 12px', color: 'var(--color-gray-500)' }}>{l.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function ISTAudit() {
  const { role, profile } = useAuthStore();

  const [activeTab, setActiveTab]           = useState('audit');
  const [rows, setRows]                     = useState([]);
  const [historyLogs, setHistoryLogs]       = useState([]);
  const [loading, setLoading]               = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError]                   = useState('');
  const [activeFilter, setActiveFilter]     = useState(null);
  const [selectedRow, setSelectedRow]       = useState(null);
  const [preview, setPreview]               = useState(null);
  const [previewAction, setPreviewAction]   = useState('');
  const [previewTargetId, setPreviewTargetId] = useState(null);
  const [previewDate, setPreviewDate]       = useState(null);
  const [previewing, setPreviewing]         = useState(false);
  const [approving, setApproving]           = useState(false);

  // ── ALS Frontend Guard ────────────────────────────────────────────────────
  if (role !== ROLES.ALS) {
    return (
      <Layout>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <ShieldAlert size={48} color="var(--color-danger-600)" style={{ marginBottom: 16 }} />
          <h2>Access Denied</h2>
          <p style={{ color: 'var(--color-gray-600)' }}>
            This page is restricted to ALS role only.
          </p>
        </div>
      </Layout>
    );
  }

  // ── Load audit rows ───────────────────────────────────────────────────────
  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: err } = await supabase
        .from('v_ist_audit')
        .select('*')
        .order('transfer_date', { ascending: false });
      if (err) throw err;
      setRows(data || []);
    } catch (e) {
      setError(e.message || 'Failed to load audit data.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('ist_repair_log')
        .select('*')
        .order('repaired_at', { ascending: false });
      if (err) throw err;
      setHistoryLogs(data || []);
    } catch (e) {
      toast.error('Failed to load repair history.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  useEffect(() => {
    if (activeTab === 'history') loadHistory();
  }, [activeTab, loadHistory]);

  // ── Repair flow ───────────────────────────────────────────────────────────
  const handleRepair = async (action, targetLogId, newDate) => {
    setPreviewing(true);
    setError('');
    try {
      const { data, error: err } = await supabase.rpc('fn_ist_repair_preview', {
        p_action:        action,
        p_target_log_id: targetLogId,
        p_new_date:      newDate || null,
      });
      if (err) throw err;
      setPreview(data);
      setPreviewAction(action);
      setPreviewTargetId(targetLogId);
      setPreviewDate(newDate || null);
    } catch (e) {
      toast.error('Preview failed: ' + e.message);
    } finally {
      setPreviewing(false);
    }
  };

  const handleApproveRepair = async () => {
    setApproving(true);
    try {
      const { data, error: err } = await supabase.rpc('fn_ist_repair_execute', {
        p_action:        previewAction,
        p_target_log_id: previewTargetId,
        p_new_date:      previewDate || null,
        p_repaired_by:   profile?.id || null,
        p_notes:         null,
      });
      if (err) throw err;

      if (data?.success) {
        toast.success('Repair executed successfully. Audit log created.');
        setPreview(null);
        setSelectedRow(null);
        loadAudit();
      } else {
        toast.error('Repair failed: ' + (data?.failure_reason || 'Unknown error'));
      }
    } catch (e) {
      toast.error('Repair failed: ' + e.message);
    } finally {
      setApproving(false);
    }
  };

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const filteredRows = activeFilter
    ? rows.filter(r => r.status === activeFilter)
    : rows;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div style={{ padding: '24px 28px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>IST Audit & Repair</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--color-gray-500)', fontSize: 13 }}>
              ALS-only. Review and repair historical Inter-Station Transfer data problems.
            </p>
          </div>
          <Button
            variant="secondary"
            leftIcon={<RefreshCw size={15} />}
            onClick={loadAudit}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--color-gray-200)', marginBottom: 20 }}>
          {[
            { key: 'audit',   label: 'Transfer Audit' },
            { key: 'history', label: 'Repair History' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '10px 20px', border: 'none', background: 'none',
                cursor: 'pointer', fontWeight: 600, fontSize: 14,
                borderBottom: activeTab === tab.key
                  ? '2px solid var(--color-primary-600)'
                  : '2px solid transparent',
                color: activeTab === tab.key
                  ? 'var(--color-primary-700)'
                  : 'var(--color-gray-500)',
                marginBottom: -2,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && <Alert type="danger" style={{ marginBottom: 16 }}>{error}</Alert>}

        {/* Audit Tab */}
        {activeTab === 'audit' && (
          <>
            {loading ? (
              <p style={{ textAlign: 'center', color: 'var(--color-gray-500)', padding: 40 }}>Loading audit data…</p>
            ) : (
              <>
                <SummaryCards
                  rows={rows}
                  onFilterChange={setActiveFilter}
                  activeFilter={activeFilter}
                />

                {filteredRows.length === 0 ? (
                  <p style={{ textAlign: 'center', color: 'var(--color-gray-500)', padding: 40 }}>
                    No records found for this filter.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: 'var(--color-gray-50)', borderBottom: '2px solid var(--color-gray-200)' }}>
                          {['Date', 'Source', 'Dest', 'Item', 'Qty', 'Src Stock', 'Dest Stock', 'Consumed After', 'Status', ''].map(h => (
                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.map((row, idx) => (
                          <tr
                            key={idx}
                            style={{
                              borderBottom: '1px solid var(--color-gray-100)',
                              background: selectedRow === row ? 'var(--color-primary-50)' : 'transparent',
                              cursor: 'pointer',
                            }}
                            onClick={() => setSelectedRow(row === selectedRow ? null : row)}
                          >
                            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{formatDate(row.transfer_date)}</td>
                            <td style={{ padding: '10px 12px', fontWeight: 600 }}>{row.source_station || <span style={{ color: 'var(--color-gray-400)' }}>—</span>}</td>
                            <td style={{ padding: '10px 12px', fontWeight: 600 }}>{row.dest_station || <span style={{ color: 'var(--color-gray-400)' }}>—</span>}</td>
                            <td style={{ padding: '10px 12px' }}>{row.item_name}</td>
                            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{row.quantity} {row.item_unit}</td>
                            <td style={{ padding: '10px 12px' }}>{row.source_current_stock ?? '—'}</td>
                            <td style={{ padding: '10px 12px' }}>{row.dest_current_stock ?? '—'}</td>
                            <td style={{ padding: '10px 12px', color: row.subsequent_consumption_at_dest > 0 ? 'var(--color-danger-700)' : 'var(--color-gray-400)' }}>
                              {row.subsequent_consumption_at_dest > 0 ? row.subsequent_consumption_at_dest + ' ' + row.item_unit : '—'}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <StatusBadge status={row.status} />
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <button
                                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-primary-600)' }}
                                onClick={e => { e.stopPropagation(); setSelectedRow(row === selectedRow ? null : row); }}
                                title="View details"
                              >
                                <Eye size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          historyLoading
            ? <p style={{ textAlign: 'center', color: 'var(--color-gray-500)', padding: 40 }}>Loading…</p>
            : <RepairHistory logs={historyLogs} />
        )}
      </div>

      {/* Detail Side Panel */}
      {selectedRow && (
        <DetailPanel
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
          onRepair={handleRepair}
        />
      )}

      {/* Preview overlay backdrop when detail panel is open */}
      {selectedRow && !preview && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 999 }}
          onClick={() => setSelectedRow(null)}
        />
      )}

      {/* Repair Preview Modal */}
      {preview && (
        <RepairPreviewModal
          preview={preview}
          action={previewAction}
          onApprove={handleApproveRepair}
          onCancel={() => setPreview(null)}
          approving={approving}
        />
      )}
    </Layout>
  );
}
