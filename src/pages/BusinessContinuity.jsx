import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck, Download, Database, Clock, FileSpreadsheet,
  Archive, CheckCircle2, AlertTriangle, Loader2, Info,
  ChevronDown, ChevronUp, Server, FileText, RefreshCw,
} from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { KpiCard } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { supabase } from '../lib/supabase';
import { ROLES, ALS_GROUPS, STATION_ORDER } from '../lib/constants';
import toast from 'react-hot-toast';
import {
  getMonthDateRange,
  getFYDateRange,
  fetchStationList,
  fetchOpeningStockData,
  fetchStockReceivedData,
  fetchConsumptionData,
  fetchTransfersData,
  fetchCurrentStockData,
  fetchMonthlyBillData,
  fetchRequestsData,
  fetchApprovalsData,
  fetchVerificationsData,
  generateAndDownloadXlsx,
  generateAndDownloadMigrationZip,
  logExport,
} from '../lib/businessContinuityExporter';
import { formatDate } from '../utils/dateHelpers';

// ─── Portal version from package.json meta ────────────────────────────────────
const PORTAL_VERSION = '1.0.0';

// ─── Sheet configuration ──────────────────────────────────────────────────────
const SHEET_OPTIONS = [
  { key: 'opening_stock',  label: 'Opening Stock',  icon: '📦' },
  { key: 'stock_received', label: 'Stock Received',  icon: '📥' },
  { key: 'consumption',    label: 'Consumption',     icon: '📤' },
  { key: 'transfers',      label: 'Transfers',       icon: '🔄' },
  { key: 'current_stock',  label: 'Current Stock',   icon: '📊' },
  { key: 'monthly_bill',   label: 'Monthly Bill',    icon: '🧾' },
  { key: 'requests',       label: 'Requests',        icon: '📋' },
  { key: 'approvals',      label: 'Approvals',       icon: '✅' },
  { key: 'verification',   label: 'Verification',    icon: '🔍' },
];

const BACKUP_TABLES_INFO = [
  { folder: '01_master_data',   tables: ['stations', 'rate_master', 'inventory_items'] },
  { folder: '02_user_access',   tables: ['users_profile', 'user_stations'] },
  { folder: '03_transactions',  tables: ['stock_received', 'consumption_logs', 'consumable_requests', 'request_approvals'] },
  { folder: '04_audit',         tables: ['stock_verifications', 'consumable_assets', 'asset_lifecycle_logs'] },
  { folder: '05_snapshots',     tables: ['station_inventory'] },
];

// ─── Status Dashboard section ─────────────────────────────────────────────────
function StatusDashboard({ onRefresh }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lastExportRes, lastBackupRes, countRes] = await Promise.all([
        supabase
          .from('export_logs')
          .select('created_at, station_scope, month_scope, file_size_kb, record_count')
          .eq('export_type', 'sheets_recovery')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('export_logs')
          .select('created_at, file_size_kb, record_count')
          .eq('export_type', 'full_backup')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase.from('station_inventory').select('id', { count: 'exact', head: true }),
      ]);

      setStats({
        lastExport: lastExportRes.data?.[0] || null,
        lastBackup: lastBackupRes.data?.[0] || null,
        totalRecords: countRes.count || 0,
      });
    } catch (err) {
      console.error('Stats load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, onRefresh]);

  const fmt = (isoStr) => isoStr ? `${formatDate(isoStr)} ${new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Never';

  return (
    <div className="kpi-grid" style={{ marginBottom: 'var(--space-6)' }}>
      <KpiCard
        label="Last Sheets Export"
        value={loading ? '…' : (stats?.lastExport ? formatDate(stats.lastExport.created_at) : 'Never')}
        icon={<FileSpreadsheet size={20} />}
        colorClass="kpi-icon-primary"
        change={stats?.lastExport ? `Scope: ${stats.lastExport.station_scope || 'ALL'}` : 'No export yet'}
      />
      <KpiCard
        label="Last Migration Backup"
        value={loading ? '…' : (stats?.lastBackup ? formatDate(stats.lastBackup.created_at) : 'Never')}
        icon={<Archive size={20} />}
        colorClass={stats?.lastBackup ? 'kpi-icon-success' : 'kpi-icon-danger'}
        change={stats?.lastBackup ? `${stats.lastBackup.file_size_kb || 0} KB` : 'No backup yet'}
      />
      <KpiCard
        label="Portal Version"
        value={PORTAL_VERSION}
        icon={<Server size={20} />}
        colorClass="kpi-icon-neutral"
        change="Metro HK Portal"
      />
      <KpiCard
        label="DB Records (Inventory)"
        value={loading ? '…' : stats?.totalRecords?.toLocaleString()}
        icon={<Database size={20} />}
        colorClass="kpi-icon-primary"
        change="station_inventory rows"
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BusinessContinuity() {
  const { role, profile } = useAuthStore();
  const { alsGroupFilter } = useStationStore();

  // Guard: ALS only
  if (role !== ROLES.ALS) {
    return (
      <Layout title="Business Continuity" subtitle="Emergency Recovery Module">
        <Alert variant="danger">This page is restricted to ALS users only.</Alert>
      </Layout>
    );
  }

  return <BusinessContinuityContent profile={profile} alsGroupFilter={alsGroupFilter} />;
}

function BusinessContinuityContent({ profile, alsGroupFilter }) {
  const [refreshTick, setRefreshTick] = useState(0);
  const [allStations, setAllStations] = useState([]);

  // ── Section A: Sheets Export state ──
  const today = new Date();
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const currentFY = today.getMonth() >= 3
    ? `${today.getFullYear()}-${String(today.getFullYear() + 1).slice(-2)}`
    : `${today.getFullYear() - 1}-${String(today.getFullYear()).slice(-2)}`;

  const [stationScope, setStationScope]   = useState('ALL');   // 'ALL' or station code
  const [timeMode, setTimeMode]           = useState('month'); // 'month' | 'fy'
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr);
  const [selectedFY, setSelectedFY]       = useState(currentFY);
  const [selectedSheets, setSelectedSheets] = useState(
    SHEET_OPTIONS.reduce((acc, s) => ({ ...acc, [s.key]: true }), {})
  );
  const [exportingSheets, setExportingSheets] = useState(false);
  const [exportProgress, setExportProgress]   = useState('');

  // ── Section B: ZIP Backup state ──
  const [backingUp, setBackingUp]         = useState(false);
  const [backupProgress, setBackupProgress] = useState('');
  const [backupDetails, setBackupDetails] = useState(false);

  // Load stations once
  useEffect(() => {
    fetchStationList(supabase).then(setAllStations).catch(console.error);
  }, []);

  // Derive target station IDs based on scope + ALS group filter
  const getTargetStationIds = useCallback(() => {
    let filtered = allStations;
    const groupCodes = ALS_GROUPS[alsGroupFilter];
    if (groupCodes) filtered = filtered.filter(s => groupCodes.includes(s.code));
    if (stationScope !== 'ALL') filtered = filtered.filter(s => s.code === stationScope);
    return filtered.length > 0 ? filtered.map(s => s.id) : null;
  }, [allStations, alsGroupFilter, stationScope]);

  // Toggle a single sheet checkbox
  const toggleSheet = (key) => setSelectedSheets(prev => ({ ...prev, [key]: !prev[key] }));
  const selectAll   = () => setSelectedSheets(SHEET_OPTIONS.reduce((a, s) => ({ ...a, [s.key]: true }), {}));
  const clearAll    = () => setSelectedSheets(SHEET_OPTIONS.reduce((a, s) => ({ ...a, [s.key]: false }), {}));

  // ── Generate Sheets Export ────────────────────────────────────────────────
  const handleSheetsExport = async () => {
    const enabledSheets = SHEET_OPTIONS.filter(s => selectedSheets[s.key]);
    if (enabledSheets.length === 0) {
      toast.error('Please select at least one sheet to export.');
      return;
    }

    setExportingSheets(true);
    setExportProgress('Preparing data…');

    try {
      const stationIds = getTargetStationIds();
      const { from, to } = timeMode === 'month'
        ? getMonthDateRange(selectedMonth)
        : getFYDateRange(selectedFY);

      const scopeLabel = stationScope === 'ALL' ? 'All Stations' : stationScope;
      const timeLabel  = timeMode === 'month' ? selectedMonth.replace('-', '_') : `FY${selectedFY}`;
      const fileName   = `Metro_HK_Recovery_${scopeLabel}_${timeLabel}.xlsx`;

      const sheetData = {};
      let totalRows = 0;

      for (const sheet of enabledSheets) {
        setExportProgress(`Fetching: ${sheet.label}…`);
        let rows = [];
        try {
          if (sheet.key === 'opening_stock')  rows = await fetchOpeningStockData(supabase, stationIds, from, to);
          if (sheet.key === 'stock_received') rows = await fetchStockReceivedData(supabase, stationIds, from, to);
          if (sheet.key === 'consumption')    rows = await fetchConsumptionData(supabase, stationIds, from, to);
          if (sheet.key === 'transfers')      rows = await fetchTransfersData(supabase, stationIds, from, to);
          if (sheet.key === 'current_stock')  rows = await fetchCurrentStockData(supabase, stationIds);
          if (sheet.key === 'monthly_bill')   rows = await fetchMonthlyBillData(supabase, stationIds, from, to);
          if (sheet.key === 'requests')       rows = await fetchRequestsData(supabase, stationIds, from, to);
          if (sheet.key === 'approvals')      rows = await fetchApprovalsData(supabase, stationIds, from, to);
          if (sheet.key === 'verification')   rows = await fetchVerificationsData(supabase, stationIds, from, to);
        } catch (err) {
          console.warn(`Sheet "${sheet.label}" failed:`, err);
          rows = [];
        }
        sheetData[`${sheet.icon} ${sheet.label}`] = rows;
        totalRows += rows.length;
      }

      setExportProgress('Generating Excel file…');
      generateAndDownloadXlsx(sheetData, fileName);

      // Log the export
      await logExport(supabase, {
        exportType:   'sheets_recovery',
        stationScope: stationScope,
        monthScope:   timeMode === 'month' ? selectedMonth : `FY:${selectedFY}`,
        recordCount:  totalRows,
        fileSizeKb:   0,
        userId:       profile?.id,
      });

      setRefreshTick(t => t + 1);
      toast.success(`Excel exported successfully! ${totalRows.toLocaleString()} rows across ${enabledSheets.length} sheets.`);
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Export failed: ' + err.message);
    } finally {
      setExportingSheets(false);
      setExportProgress('');
    }
  };

  // ── Generate Migration ZIP ────────────────────────────────────────────────
  const handleMigrationBackup = async () => {
    if (!window.confirm(
      'This will download a complete database snapshot (~all tables) as a ZIP file.\n\n' +
      'This may take 1–2 minutes depending on data volume.\n\nContinue?'
    )) return;

    setBackingUp(true);
    setBackupProgress('Starting backup…');

    try {
      const { fileSizeKb, totalRecords } = await generateAndDownloadMigrationZip(
        supabase,
        (tableName, current, total) => {
          setBackupProgress(`Exporting table ${current}/${total}: ${tableName}`);
        }
      );

      await logExport(supabase, {
        exportType:  'full_backup',
        stationScope:'ALL',
        monthScope:  null,
        recordCount: totalRecords,
        fileSizeKb:  fileSizeKb,
        userId:      profile?.id,
      });

      setRefreshTick(t => t + 1);
      toast.success(`Migration backup downloaded! ${totalRecords.toLocaleString()} records — ${fileSizeKb} KB`);
    } catch (err) {
      console.error('Backup error:', err);
      toast.error('Backup failed: ' + err.message);
    } finally {
      setBackingUp(false);
      setBackupProgress('');
    }
  };

  // Build FY options (current and previous 2)
  const fyOptions = [];
  const baseYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  for (let i = 0; i <= 2; i++) {
    const y = baseYear - i;
    fyOptions.push(`${y}-${String(y + 1).slice(-2)}`);
  }

  return (
    <Layout
      title="Business Continuity"
      subtitle="Emergency Recovery & Migration Backup Module"
    >
      {/* ── Status Dashboard ─────────────────────────────────────────────── */}
      <StatusDashboard onRefresh={refreshTick} />

      {/* ── Important Notice ─────────────────────────────────────────────── */}
      <Alert variant="info" style={{ marginBottom: 'var(--space-6)' }}>
        <strong>Emergency Use:</strong> Use <em>Google Sheets Recovery Export</em> if the portal
        becomes unavailable and operations must immediately resume on the legacy Google Sheets workflow.
        Use <em>Portal Migration Backup</em> only for developer handover or system migration.
        All exports are <strong>read-only</strong> and do not modify any production data.
      </Alert>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION A — Google Sheets Recovery Export
      ══════════════════════════════════════════════════════════════════════ */}
      <Card style={{ marginBottom: 'var(--space-6)', borderTop: '4px solid var(--color-primary-500)' }}>
        <CardHeader
          title="Section A — Google Sheets Recovery Export"
          icon={<FileSpreadsheet size={18} color="var(--color-primary-600)" />}
          subtitle="Export operational data to Excel matching the Google Sheets workflow format"
        />
        <CardBody style={{ padding: 'var(--space-5)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>

            {/* Station Scope */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Station Scope</label>
              <select
                className="form-control"
                value={stationScope}
                onChange={e => setStationScope(e.target.value)}
              >
                <option value="ALL">All Stations</option>
                {STATION_ORDER.map(code => {
                  const st = allStations.find(s => s.code === code);
                  return st ? (
                    <option key={code} value={code}>{code} — {st.name}</option>
                  ) : null;
                })}
              </select>
            </div>

            {/* Time Mode */}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Time Period</label>
              <select
                className="form-control"
                value={timeMode}
                onChange={e => setTimeMode(e.target.value)}
              >
                <option value="month">Selected Month</option>
                <option value="fy">Complete Financial Year</option>
              </select>
            </div>

            {/* Month / FY picker */}
            {timeMode === 'month' ? (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Month</label>
                <input
                  type="month"
                  className="form-control"
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                />
              </div>
            ) : (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Financial Year</label>
                <select
                  className="form-control"
                  value={selectedFY}
                  onChange={e => setSelectedFY(e.target.value)}
                >
                  {fyOptions.map(fy => (
                    <option key={fy} value={fy}>FY {fy}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Sheet Selection */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
              <label className="form-label" style={{ margin: 0 }}>Select Sheets to Export</label>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px' }}
                  onClick={selectAll}
                >Select All</button>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px' }}
                  onClick={clearAll}
                >Clear All</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {SHEET_OPTIONS.map(sheet => (
                <label
                  key={sheet.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                    padding: '6px 12px', borderRadius: 'var(--radius-md)',
                    border: selectedSheets[sheet.key]
                      ? '1.5px solid var(--color-primary-400)'
                      : '1.5px solid var(--color-border)',
                    background: selectedSheets[sheet.key]
                      ? 'var(--color-primary-50)'
                      : 'var(--color-surface)',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: selectedSheets[sheet.key] ? 600 : 400,
                    color: selectedSheets[sheet.key] ? 'var(--color-primary-700)' : 'var(--color-gray-700)',
                    transition: 'all 0.15s',
                    userSelect: 'none',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ margin: 0 }}
                    checked={!!selectedSheets[sheet.key]}
                    onChange={() => toggleSheet(sheet.key)}
                  />
                  {sheet.icon} {sheet.label}
                </label>
              ))}
            </div>
          </div>

          {/* Progress */}
          {exportProgress && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-3)',
              padding: '10px 14px', background: 'var(--color-primary-50)',
              borderRadius: 'var(--radius-md)', color: 'var(--color-primary-700)',
              fontSize: 'var(--font-size-sm)',
            }}>
              <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
              {exportProgress}
            </div>
          )}

          <Button
            variant="primary"
            onClick={handleSheetsExport}
            disabled={exportingSheets}
            isLoading={exportingSheets}
            style={{ width: '100%', padding: 'var(--space-3)', fontSize: 'var(--font-size-base)' }}
          >
            <Download size={18} />
            {exportingSheets ? 'Exporting…' : 'Export to Excel (.xlsx)'}
          </Button>
        </CardBody>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION B — Portal Migration Backup
      ══════════════════════════════════════════════════════════════════════ */}
      <Card style={{ borderTop: '4px solid var(--color-warning-500)' }}>
        <CardHeader
          title="Section B — Portal Migration Backup (Developer)"
          icon={<Archive size={18} color="var(--color-warning-600)" />}
          subtitle="Complete database snapshot as ZIP — for future portal migration or system rebuild"
        />
        <CardBody style={{ padding: 'var(--space-5)' }}>
          <Alert variant="warning" style={{ marginBottom: 'var(--space-4)' }}>
            <strong>Developer Tool.</strong> This generates a complete database snapshot.
            Passwords and authentication credentials are <strong>NOT included</strong>.
            Users would need to reset passwords in a new system.
          </Alert>

          {/* What's included */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <button
              className="btn btn-ghost"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', padding: 0, marginBottom: 'var(--space-2)' }}
              onClick={() => setBackupDetails(v => !v)}
            >
              {backupDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {backupDetails ? 'Hide' : 'Show'} what's included in the ZIP
            </button>

            {backupDetails && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
                {BACKUP_TABLES_INFO.map(section => (
                  <div key={section.folder} style={{
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)', background: 'var(--color-surface)',
                  }}>
                    <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-gray-500)', marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      📁 {section.folder}/
                    </div>
                    {section.tables.map(t => (
                      <div key={t} style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-700)', padding: '2px 0' }}>
                        📄 {t}.json + .csv
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)', background: 'var(--color-surface)',
                }}>
                  <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: 'var(--color-gray-500)', marginBottom: 'var(--space-1)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    📄 Root/
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-700)', padding: '2px 0' }}>
                    📋 manifest.json (version, timestamps, row counts)
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Progress */}
          {backupProgress && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-3)',
              padding: '10px 14px', background: 'var(--color-warning-50)',
              borderRadius: 'var(--radius-md)', color: 'var(--color-warning-700)',
              fontSize: 'var(--font-size-sm)',
            }}>
              <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
              {backupProgress}
            </div>
          )}

          <Button
            variant="outline"
            onClick={handleMigrationBackup}
            disabled={backingUp}
            isLoading={backingUp}
            style={{
              width: '100%', padding: 'var(--space-3)', fontSize: 'var(--font-size-base)',
              borderColor: 'var(--color-warning-400)', color: 'var(--color-warning-700)',
            }}
          >
            <Archive size={18} />
            {backingUp ? 'Generating Backup…' : 'Generate Migration Backup (.zip)'}
          </Button>
        </CardBody>
      </Card>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </Layout>
  );
}
