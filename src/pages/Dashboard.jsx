import React, { useEffect, useState } from 'react';
import { toDisplayValue, getDisplayUnit, toBillingQty } from '../utils/units';
import {
  Package, PackagePlus, TrendingDown, AlertTriangle,
  ClipboardList, Clock, Activity, Building2, ShoppingCart, Layers, CheckCircle2,
} from 'lucide-react';
import Layout from '../components/layout/Layout';
import { KpiCard } from '../components/ui/Card';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import { Badge, RequestStatusBadge } from '../components/ui/Badge';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { useInventory } from '../hooks/useInventory';
import { supabase, fetchAll } from '../lib/supabase';
import { ROLES, ALS_GROUPS, STATION_ORDER } from '../lib/constants';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import { getVerificationPeriodInfo, formatDate } from '../utils/dateHelpers';
import Alert from '../components/ui/Alert';

// ─── Station Dashboard (HKS / SC) ────────────────────────────────────────────
function StationDashboard({ station }) {
  const { inventory, fetchInventory, getLowStockItems, isLoading } = useInventory(station?.id);
  const [stats, setStats] = useState({ receivedCount: 0, consumedCount: 0, zeroStockCount: 0, todayIn: 0, todayOut: 0, pendingRequests: 0, recentTx: [] });
  const [loadingStats, setLoadingStats] = useState(true);
  const [isPeriodVerified, setIsPeriodVerified] = useState(false);

  useEffect(() => {
    if (!station?.id) return;
    fetchInventory(station.id);
    loadStats(station.id);
    checkVerificationStatus(station.id);
  }, [station?.id]); // eslint-disable-line

  const checkVerificationStatus = async (sid) => {
    const periodInfo = getVerificationPeriodInfo(new Date());
    if (!periodInfo.isVerificationDay) {
      setIsPeriodVerified(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('stock_verifications')
        .select('id')
        .eq('station_id', sid)
        .eq('verification_period', periodInfo.period)
        .limit(1);
      if (!error && data && data.length > 0) {
        setIsPeriodVerified(true);
      } else {
        setIsPeriodVerified(false);
      }
    } catch (err) {
      console.error('Verification check error:', err);
    }
  };

  const loadStats = async (sid) => {
    setLoadingStats(true);
    try {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      const [received, consumed, requests, recentStock, recentConsumption, zeroStock] = await Promise.all([
        supabase.from('stock_received').select('received_date', { count: 'exact' })
          .eq('station_id', sid).gte('received_date', monthStart)
          .or('supplier.neq.Opening Stock Initialization,supplier.is.null'),
        supabase.from('consumption_logs').select('consumption_date', { count: 'exact' })
          .eq('station_id', sid).gte('consumption_date', monthStart)
          .not('remarks', 'ilike', 'Inter-Station Transfer Out%')
          .not('remarks', 'ilike', 'Depot Transfer Out%'),
        supabase.from('consumable_requests').select('id', { count: 'exact' })
          .eq('station_id', sid).in('status', ['pending', 'forwarded_als']),
        supabase.from('stock_received').select('id, quantity, received_date, created_at, inventory_items(name,unit)')
          .eq('station_id', sid).order('received_date', { ascending: false }).order('created_at', { ascending: false }).limit(10)
          .or('supplier.neq.Opening Stock Initialization,supplier.is.null'),
        supabase.from('consumption_logs').select('id, quantity_used, consumption_date, created_at, inventory_items(name,unit)')
          .eq('station_id', sid).order('consumption_date', { ascending: false }).order('created_at', { ascending: false }).limit(10),
        supabase.from('station_inventory').select('id', { count: 'exact' })
          .eq('station_id', sid).lte('current_stock', 0),
      ]);

      // Merge and sort recent transactions by date then created_at
      const txs = [
        ...(recentStock.data ?? []).map((r) => {
          const dbUnit = r.inventory_items?.unit ?? 'Nos';
          const dispUnit = getDisplayUnit(dbUnit);
          const dispVal = toDisplayValue(r.quantity, dbUnit);
          const qty = dispUnit === 'Nos' ? Math.round(dispVal) : dispVal.toFixed(2);
          return {
            id: r.id, type: 'in', item: r.inventory_items?.name ?? '—',
            qty: `+${qty} ${dispUnit}`,
            date: r.received_date, time: r.created_at,
          };
        }),
        ...(recentConsumption.data ?? []).map((r) => {
          const dbUnit = r.inventory_items?.unit ?? 'Nos';
          const dispUnit = getDisplayUnit(dbUnit);
          const dispVal = toDisplayValue(r.quantity_used, dbUnit);
          const qty = dispUnit === 'Nos' ? Math.round(dispVal) : dispVal.toFixed(2);
          return {
            id: r.id, type: 'out', item: r.inventory_items?.name ?? '—',
            qty: `-${qty} ${dispUnit}`,
            date: r.consumption_date, time: r.created_at,
          };
        }),
      ].sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        return dateDiff !== 0 ? dateDiff : new Date(b.time) - new Date(a.time);
      }).slice(0, 10);

      const todayIn = txs.filter(t => t.type === 'in' && t.date === todayStr).length;
      const todayOut = txs.filter(t => t.type === 'out' && t.date === todayStr).length;

      setStats({
        receivedCount: received.count ?? 0,
        consumedCount: consumed.count ?? 0,
        zeroStockCount: zeroStock.count ?? 0,
        todayIn,
        todayOut,
        pendingRequests: requests.count ?? 0,
        recentTx: txs,
      });
    } catch (err) {
      console.error('Dashboard stats error:', err);
    } finally {
      setLoadingStats(false);
    }
  };

  const lowStock = getLowStockItems(inventory);
  const totalItems = inventory.length;

  const txColumns = [
    {
      key: 'type', label: 'Type', width: 80,
      render: (v) => (
        <Badge variant={v === 'in' ? 'success' : 'warning'}>
          {v === 'in' ? '▲ IN' : '▼ OUT'}
        </Badge>
      ),
    },
    { key: 'item', label: 'Item', sortable: true },
    { key: 'qty', label: 'Quantity' },
    { key: 'date', label: 'Date', render: (v) => formatDate(v) },
  ];

  const lowStockColumns = [
    { key: 'item', label: 'Item', sortable: true },
    { key: 'current', label: 'Current Stock' },
    { key: 'minimum', label: 'Min Level' },
  ];

  const lowStockData = lowStock.map((row) => {
    const dbUnit   = row.unit ?? 'Nos';
    const dispUnit = getDisplayUnit(dbUnit);
    const curDisp  = toDisplayValue(row.current_stock, dbUnit);
    const minDisp  = toDisplayValue(row.min_stock_level ?? 0, dbUnit);
    const fmt = (v) => dispUnit === 'Nos' ? `${Math.round(v)} Nos` : `${v.toFixed(2)} ${dispUnit}`;
    return {
      id: row.item_id,
      item: row.item_name ?? '—',
      current: fmt(curDisp),
      minimum: fmt(minDisp),
      _rowClass: 'low-stock-row',
    };
  });

  const { role, profile } = useAuthStore();
  const isSC = role === ROLES.SC;
  
  const periodInfo = getVerificationPeriodInfo(new Date());
  const showVerificationReminder = isSC && periodInfo.isVerificationDay && !isPeriodVerified;

  // Dynamic greeting
  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';
  const firstName = profile?.full_name?.split(' ')[0] || 'User';

  return (
    <>
      {showVerificationReminder && (
        <Alert variant="warning" className="animate-fade-in" style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>Action Required:</strong> Today is the scheduled day for Stock Verification. Please generate the checklist and verify physical stock.
            </div>
            <Button variant="primary" onClick={() => window.open('/stock-verification', '_blank')}>
              Start Verification
            </Button>
          </div>
        </Alert>
      )}

      {/* Welcome Banner */}
      {/* Welcome Banner */}
<div className="dashboard-welcome animate-fade-in" style={{ marginBottom: 'var(--space-5)' }}>
  <div style={{ flex: 1, minWidth: 0, zIndex: 2, position: 'relative' }}>
    <div className="dashboard-welcome-title">{greeting}, {firstName}! 👋</div>
    <div className="dashboard-welcome-sub">Here's your station overview for today</div>
    <div className="dashboard-welcome-station">
      <Building2 size={14} />
      {station.code} — {station.name}
    </div>
    {isSC && (
      <div style={{ marginTop: '0.75rem' }}>
        <Button
          variant="outline"
          onClick={() => window.open('/stock-verification', '_blank')}
          style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.3)' }}
        >
          <ClipboardList size={16} /> Digital Stock Verification
        </Button>
      </div>
    )}
  </div>
  {/* Hidden on mobile via CSS — takes up space and squeezes content on small screens */}
  <Activity size={48} className="dashboard-hero-icon" style={{ opacity: 0.2, zIndex: 1, position: 'relative', flexShrink: 0 }} />
</div>


      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          label="Receipts This Month"
          value={loadingStats ? '…' : stats.receivedCount}
          icon={<PackagePlus size={20} />}
          colorClass="kpi-icon-success"
          change="Stock received entries this month"
        />
        <KpiCard
          label="Consumption Entries"
          value={loadingStats ? '…' : stats.consumedCount}
          icon={<ShoppingCart size={20} />}
          colorClass="kpi-icon-warning"
          change="Consumption logs this month"
        />
        <KpiCard
          label="Zero Stock Items"
          value={loadingStats ? '…' : stats.zeroStockCount}
          icon={<Layers size={20} />}
          colorClass={stats.zeroStockCount > 0 ? 'kpi-icon-danger' : 'kpi-icon-success'}
          change={stats.zeroStockCount > 0 ? 'Items with no stock remaining' : 'All items have stock'}
        />
        <KpiCard
          label="Low Stock Alerts"
          value={isLoading ? '…' : lowStock.length}
          icon={<AlertTriangle size={20} />}
          colorClass={lowStock.length > 0 ? 'kpi-icon-danger' : 'kpi-icon-success'}
          change={lowStock.length > 0 ? 'Items below minimum level' : 'All items well-stocked'}
        />
        <KpiCard
          label="Pending Requests"
          value={loadingStats ? '…' : stats.pendingRequests}
          icon={<ClipboardList size={20} />}
          colorClass="kpi-icon-info"
          change="Awaiting approval"
        />
      </div>

      {/* Today's quick summary bar */}
      {!loadingStats && (stats.todayIn > 0 || stats.todayOut > 0) && (
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
          {stats.todayIn > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-success-50)', border: '1px solid var(--color-success-200)', borderRadius: '8px', padding: '6px 14px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-success-700)' }}>
              <CheckCircle2 size={14} /> {stats.todayIn} stock receipt{stats.todayIn > 1 ? 's' : ''} today
            </div>
          )}
          {stats.todayOut > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--color-warning-50)', border: '1px solid var(--color-warning-200)', borderRadius: '8px', padding: '6px 14px', fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-warning-700)' }}>
              <TrendingDown size={14} /> {stats.todayOut} consumption{stats.todayOut > 1 ? 's' : ''} today
            </div>
          )}
        </div>
      )}

      {/* Two-column content */}
      <div className="two-col-grid">
        {/* Recent Transactions */}
        <Card>
          <CardHeader title="Recent Transactions" icon={<Clock size={16} />} subtitle={`Latest ${stats.recentTx.length} entries`} />
          <CardBody style={{ padding: 0 }}>
            <DataTable
              columns={txColumns}
              data={stats.recentTx}
              isLoading={loadingStats}
              emptyTitle="No transactions yet"
              emptyDesc="Stock received and consumption logs will appear here."
            />
          </CardBody>
        </Card>

        {/* Low Stock Alerts */}
        <Card>
          <CardHeader
            title="Low Stock Alerts"
            icon={<AlertTriangle size={16} style={{ color: 'var(--color-warning-500)' }} />}
          />
          <CardBody style={{ padding: 0 }}>
            <DataTable
              columns={lowStockColumns}
              data={lowStockData}
              isLoading={isLoading}
              emptyTitle="No low stock alerts"
              emptyDesc="All items are above minimum stock levels."
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

// ─── ALS Dashboard ────────────────────────────────────────────────────────────
function ALSDashboard() {
  const { role } = useAuthStore();
  const { alsGroupFilter } = useStationStore();
  const [stations, setStations] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  
  const [verificationsMonth, setVerificationsMonth] = useState(new Date().toISOString().substring(0, 7)); // YYYY-MM
  const [verifications, setVerifications] = useState([]);
  const [loadingVerifications, setLoadingVerifications] = useState(true);

  useEffect(() => {
    loadALSData();
  }, [alsGroupFilter]);

  useEffect(() => {
    loadVerifications();
  }, [verificationsMonth, alsGroupFilter]);

  const loadVerifications = async () => {
    setLoadingVerifications(true);
    try {
      const allowedStations = ALS_GROUPS[alsGroupFilter];
      const { data, error } = await supabase
        .from('stock_verifications')
        .select('*, stations(code)')
        .eq('verification_month', verificationsMonth)
        .order('completed_at', { ascending: false });

      if (!error && data) {
        let finalData = data;
        if (allowedStations) {
          finalData = finalData.filter(v => allowedStations.includes(v.stations?.code));
        }
        
        setVerifications(finalData.map(v => ({
          id: v.id,
          station: v.stations?.code || '-',
          verifier: v.verifier_name,
          empId: v.emp_id,
          period: v.verification_period.split('-').pop(),
          date: formatDate(v.completed_at),
          time: new Date(v.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        })));
      }
    } catch (err) {
      console.error('Verifications fetch error:', err);
    } finally {
      setLoadingVerifications(false);
    }
  };

  const loadALSData = async () => {
    setIsLoading(true);
    try {
      const allowedStations = ALS_GROUPS[alsGroupFilter];

      // 1. Fetch all stations and filter
      const { data: stationsData, error: stErr } = await supabase
        .from('stations')
        .select('id, code, name')
        .eq('is_active', true)
        .order('code');

      if (stErr) throw stErr;

      // Fetch global consumption for the current month to show spend on station cards
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      
      const allLogsQuery = supabase
        .from('consumption_logs')
        .select('station_id, quantity_used, inventory_items(unit, rate_master(unit_rate, nos_per_kg, tender_year))')
        .gte('consumption_date', monthStart)
        .not('remarks', 'ilike', 'Inter-Station Transfer Out%')
        .not('remarks', 'ilike', 'Depot Transfer Out%');
        
      const { data: allLogs } = await fetchAll(allLogsQuery);

      const spendByStation = {};
      if (allLogs) {
        allLogs.forEach(r => {
           // Apply tender_year filter to match Approvals logic
           const tYearStr = r.inventory_items?.rate_master?.tender_year || '';
           if (tYearStr.toLowerCase().includes('before 2024')) return;
           const startYear = parseInt(tYearStr.split('-')[0]) || 0;
           if (startYear > 0 && startYear < 2024) return;
           
           const rate = r.inventory_items?.rate_master?.unit_rate || 0;
           const nosPerKg = r.inventory_items?.rate_master?.nos_per_kg || null;
           const cost = toBillingQty(r.quantity_used, r.inventory_items?.unit, nosPerKg) * rate;
           
           spendByStation[r.station_id] = (spendByStation[r.station_id] || 0) + cost;
        });
      }

      const filteredStations = stationsData
        .filter((s) => !allowedStations || allowedStations.includes(s.code))
        .map(s => ({ ...s, monthlySpend: spendByStation[s.id] || 0 }))
        .sort((a, b) => {
          const indexA = STATION_ORDER.indexOf(a.code);
          const indexB = STATION_ORDER.indexOf(b.code);
          return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
        });

      const stationIds = filteredStations.map((s) => s.id);

      // 2. Fetch pending approvals for those stations
      let query = supabase.from('consumable_requests')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'forwarded_als']);

      if (allowedStations && stationIds.length > 0) {
        query = query.in('station_id', stationIds);
      } else if (allowedStations && stationIds.length === 0) {
        // If filter is applied but no stations found, force 0 results
        query = query.eq('id', '00000000-0000-0000-0000-000000000000'); 
      }
      
      const pendingRes = await query;

      setStations(filteredStations);
      setPendingApprovals(pendingRes.count ?? 0);
    } catch (err) {
      console.error('ALS dashboard error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Station Detail Modal State
  const [selectedStationDetail, setSelectedStationDetail] = useState(null);
  const [modalTab, setModalTab] = useState('stock'); // 'stock' or 'consumption'
  const [modalMonth, setModalMonth] = useState(new Date().toISOString().substring(0, 7)); // YYYY-MM
  const [stationStock, setStationStock] = useState([]);
  const [stationConsumption, setStationConsumption] = useState([]);
  const [isModalLoading, setIsModalLoading] = useState(false);

  useEffect(() => {
    if (selectedStationDetail) {
      loadStationDetails();
    }
  }, [selectedStationDetail, modalMonth, modalTab]); // eslint-disable-line

  const loadStationDetails = async () => {
    if (!selectedStationDetail) return;
    setIsModalLoading(true);
    try {
      const [yearStr, monthStr] = modalMonth.split('-');
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const startDate = `${yearStr}-${monthStr}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`; // Last day of month

      if (modalTab === 'stock') {
        const { data } = await supabase
          .from('v_station_inventory_summary')
          .select('*')
          .eq('station_id', selectedStationDetail.id);
        setStationStock(data ?? []);
      } else {
        const { data } = await supabase
          .from('consumption_logs')
          .select('*, inventory_items(name, unit, rate_master(unit_rate, nos_per_kg))')
          .eq('station_id', selectedStationDetail.id)
          .gte('consumption_date', startDate)
          .lte('consumption_date', endDate);
        setStationConsumption(data ?? []);
      }
    } catch (err) {
      console.error('Modal fetch error:', err);
    } finally {
      setIsModalLoading(false);
    }
  };

  return (
    <>
      <div className="station-hero-banner animate-fade-in" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="station-hero-blobs"></div>
        <div style={{ zIndex: 2, position: 'relative' }}>
          <div className="station-hero-title">{role === ROLES.ALS ? 'ALS Dashboard' : 'HKTL Dashboard'} 📊</div>
          <div className="station-hero-sub">Complete system overview — all 25 stations</div>
        </div>
        <Activity size={48} style={{ opacity: 0.2, zIndex: 1, position: 'relative' }} />
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="Total Stations"
          value={isLoading ? '…' : stations.length}
          icon={<Building2 size={20} />}
          colorClass="kpi-icon-primary"
          change="Active metro stations"
        />
        <KpiCard
          label="Pending Approvals"
          value={isLoading ? '…' : pendingApprovals}
          icon={<ClipboardList size={20} />}
          colorClass={pendingApprovals > 0 ? 'kpi-icon-danger' : 'kpi-icon-success'}
          change="Requests awaiting your action"
        />
      </div>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Card>
          <CardHeader title="All Stations Overview" icon={<Building2 size={16} />} />
          <CardBody style={{ padding: 'var(--space-5)' }}>
            {isLoading ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>Loading…</div>
            ) : (
              <div className="als-stations-grid">
                {stations.map((s) => (
                  <div 
                    key={s.id} 
                    className="als-station-chip" 
                    style={{ cursor: 'pointer', transition: 'transform 0.1s' }}
                    onClick={() => setSelectedStationDetail(s)}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    <div className="als-station-info">
                      <div className="als-station-code">{s.code}</div>
                      <div className="als-station-name">{s.name}</div>
                      <div className="als-station-stats" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-primary-700)' }}>
                          ₹{s.monthlySpend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <Badge variant="primary">View Details</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <Card>
          <CardHeader title="Digital Stock Verifications Report" icon={<ClipboardList size={16} />} />
          <CardBody style={{ padding: 'var(--space-5)' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
              <input
                type="month"
                className="form-control"
                style={{ width: 'auto' }}
                value={verificationsMonth}
                onChange={(e) => setVerificationsMonth(e.target.value)}
              />
            </div>
            <DataTable
              columns={[
                { key: 'station', label: 'Station' },
                { key: 'period', label: 'Period' },
                { key: 'verifier', label: 'Completed By' },
                { key: 'empId', label: 'Emp ID' },
                { key: 'date', label: 'Date' },
                { key: 'time', label: 'Time' }
              ]}
              data={verifications}
              isLoading={loadingVerifications}
              emptyTitle="No verifications found"
              emptyDesc={`No digital stock verifications recorded for ${verificationsMonth}.`}
            />
          </CardBody>
        </Card>
      </div>


      <Modal
        isOpen={!!selectedStationDetail}
        onClose={() => { setSelectedStationDetail(null); setModalTab('stock'); }}
        title={`${selectedStationDetail?.code} — ${selectedStationDetail?.name} Overview`}
        size="lg"
        footer={<Button variant="outline" onClick={() => setSelectedStationDetail(null)}>Close</Button>}
      >
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
          <button 
            className={`btn ${modalTab === 'stock' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setModalTab('stock')}
            style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: modalTab === 'stock' ? 'none' : '' }}
          >
            <Package size={16} /> Current Stock
          </button>
          <button 
            className={`btn ${modalTab === 'consumption' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setModalTab('consumption')}
            style={{ borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: modalTab === 'consumption' ? 'none' : '' }}
          >
            <TrendingDown size={16} /> Monthly Consumption
          </button>
        </div>

        {modalTab === 'stock' && (
          <DataTable
            columns={[
              { key: 'item_name', label: 'Item Name', sortable: true },
              { key: 'category', label: 'Category' },
              { key: 'current_stock', label: 'Quantity on Hand', render: (v, r) => {
                const dbUnit   = r.unit ?? 'Nos';
                const dispUnit = getDisplayUnit(dbUnit);
                const dispVal  = toDisplayValue(v, dbUnit);
                return dispUnit === 'Nos' ? `${Math.round(dispVal)} Nos` : `${dispVal.toFixed(2)} ${dispUnit}`;
              }},
            ]}
            data={stationStock.map(r => ({ ...r, id: r.item_id }))}
            isLoading={isModalLoading}
            emptyTitle="No stock data"
            emptyDesc="This station currently has no inventory records."
          />
        )}

        {modalTab === 'consumption' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'var(--space-4)' }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-600)', marginBottom: 'var(--space-1)' }}>Total Estimated Cost</div>
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, color: 'var(--color-danger-600)' }}>
                  ₹{stationConsumption.reduce((sum, r) => sum + (toBillingQty(r.quantity_used, r.inventory_items?.unit, r.inventory_items?.rate_master?.nos_per_kg) * Number(r.inventory_items?.rate_master?.unit_rate || 0)), 0).toFixed(2)}
                </div>
              </div>
              <input 
                type="month" 
                className="form-control" 
                style={{ width: 'auto' }}
                value={modalMonth}
                onChange={(e) => setModalMonth(e.target.value)}
              />
            </div>
            <DataTable
              columns={[
                { key: 'consumption_date', label: 'Date', sortable: true, render: (v) => formatDate(v) },
                { key: 'item_name', label: 'Item', render: (_, r) => r.inventory_items?.name ?? '—' },
                { key: 'quantity_used', label: 'Quantity Used', render: (v, r) => {
                  const dbUnit   = r.inventory_items?.unit ?? 'Nos';
                  const dispUnit = getDisplayUnit(dbUnit);
                  const dispVal  = toDisplayValue(v, dbUnit);
                  return dispUnit === 'Nos' ? `${Math.round(dispVal)} Nos` : `${dispVal.toFixed(2)} ${dispUnit}`;
                }},
                { key: 'cost', label: 'Estimated Cost', render: (_, r) => {
                  const rate = r.inventory_items?.rate_master?.unit_rate || 0;
                  return rate > 0 ? `₹${(toBillingQty(r.quantity_used, r.inventory_items?.unit, r.inventory_items?.rate_master?.nos_per_kg) * rate).toFixed(2)}` : '—';
                }},
              ]}
              data={stationConsumption.map(r => ({ ...r, id: r.id }))}
              isLoading={isModalLoading}
              emptyTitle="No consumption"
              emptyDesc={`No items were consumed in ${modalMonth}.`}
            />
          </>
        )}
      </Modal>
    </>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const { role } = useAuthStore();
  const { selectedStation } = useStationStore();
  const isGlobal = role === ROLES.ALS || role === ROLES.HKTL;

  return (
    <Layout
      title={isGlobal ? (role === ROLES.ALS ? 'ALS Dashboard' : 'HKTL Dashboard') : 'Station Dashboard'}
      subtitle={isGlobal ? (useStationStore().alsGroupFilter === 'ALL STATIONS' ? 'All stations overview' : `${useStationStore().alsGroupFilter} overview`) : selectedStation?.name}
    >
      {isGlobal ? <ALSDashboard /> : <StationDashboard station={selectedStation} />}
    </Layout>
  );
}
