import React, { useEffect, useState } from 'react';
import {
  Package, PackagePlus, TrendingDown, AlertTriangle,
  ClipboardList, Clock, Activity, Building2,
} from 'lucide-react';
import Layout from '../components/layout/Layout';
import { KpiCard } from '../components/ui/Card';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import { Badge, RequestStatusBadge } from '../components/ui/Badge';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { useInventory } from '../hooks/useInventory';
import { supabase } from '../lib/supabase';
import { ROLES, ALS_GROUPS } from '../lib/constants';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import { isVerificationDay } from '../utils/dateHelpers';
import Alert from '../components/ui/Alert';

// ─── Station Dashboard (HKS / SC) ────────────────────────────────────────────
function StationDashboard({ station }) {
  const { inventory, fetchInventory, getLowStockItems, isLoading } = useInventory(station?.id);
  const [stats, setStats] = useState({ received: 0, consumed: 0, pendingRequests: 0, recentTx: [] });
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    if (!station?.id) return;
    fetchInventory(station.id);
    loadStats(station.id);
  }, [station?.id]); // eslint-disable-line

  const loadStats = async (sid) => {
    setLoadingStats(true);
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

      const [received, consumed, requests, recentStock, recentConsumption] = await Promise.all([
        supabase.from('stock_received').select('quantity', { count: 'exact', head: false })
          .eq('station_id', sid).gte('received_date', monthStart)
          .neq('supplier', 'Opening Stock Initialization'),
        supabase.from('consumption_logs').select('quantity_used', { count: 'exact', head: false })
          .eq('station_id', sid).gte('consumption_date', monthStart),
        supabase.from('consumable_requests').select('id', { count: 'exact', head: false })
          .eq('station_id', sid).in('status', ['pending', 'forwarded_als']),
        supabase.from('stock_received').select('*, inventory_items(name,unit)')
          .eq('station_id', sid).order('created_at', { ascending: false }).limit(5)
          .neq('supplier', 'Opening Stock Initialization'),
        supabase.from('consumption_logs').select('*, inventory_items(name,unit)')
          .eq('station_id', sid).order('created_at', { ascending: false }).limit(5),
      ]);

      const receivedTotal = (received.data ?? []).reduce((s, r) => s + Number(r.quantity), 0);
      const consumedTotal = (consumed.data ?? []).reduce((s, r) => s + Number(r.quantity_used), 0);

      // Merge and sort recent transactions
      const txs = [
        ...(recentStock.data ?? []).map((r) => ({
          id: r.id, type: 'in', item: r.inventory_items?.name ?? '—',
          qty: `+${r.quantity} ${r.inventory_items?.unit ?? ''}`,
          date: r.received_date, time: r.created_at,
        })),
        ...(recentConsumption.data ?? []).map((r) => ({
          id: r.id, type: 'out', item: r.inventory_items?.name ?? '—',
          qty: `-${r.quantity_used} ${r.inventory_items?.unit ?? ''}`,
          date: r.consumption_date, time: r.created_at,
        })),
      ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 8);

      setStats({
        received: receivedTotal.toFixed(2),
        consumed: consumedTotal.toFixed(2),
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
    { key: 'date', label: 'Date' },
  ];

  const lowStockColumns = [
    { key: 'item', label: 'Item', sortable: true },
    { key: 'current', label: 'Current Stock' },
    { key: 'minimum', label: 'Min Level' },
  ];

  const lowStockData = lowStock.map((row) => ({
    id: row.id,
    item: row.inventory_items?.name ?? '—',
    current: `${row.current_stock} ${row.inventory_items?.unit ?? ''}`,
    minimum: `${row.inventory_items?.min_stock_level} ${row.inventory_items?.unit ?? ''}`,
    _rowClass: 'low-stock-row',
  }));

  const { role } = useAuthStore();
  const isSC = role === ROLES.SC;
  const showVerificationReminder = isSC && isVerificationDay();

  return (
    <>
      {showVerificationReminder && (
        <Alert variant="warning" className="animate-fade-in" style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>Action Required:</strong> Today is the scheduled day for Stock Verification. Please generate the checklist and verify physical stock.
            </div>
            <Button variant="primary" onClick={() => window.open('/print-checklist', '_blank')}>
              Generate Checklist
            </Button>
          </div>
        </Alert>
      )}

      {/* Welcome Banner */}
      <div className="dashboard-welcome animate-fade-in">
        <div>
          <div className="dashboard-welcome-title">Good day! 👋</div>
          <div className="dashboard-welcome-sub">Here's your station overview for today</div>
          <div className="dashboard-welcome-station">
            <Building2 size={14} />
            {station.code} — {station.name}
          </div>
          {isSC && (
            <div style={{ marginTop: '1rem' }}>
              <Button variant="outline" onClick={() => window.open('/print-checklist', '_blank')} style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.3)' }}>
                <ClipboardList size={16} /> Print Verification Checklist
              </Button>
            </div>
          )}
        </div>
        <Activity size={48} style={{ opacity: 0.2 }} />
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KpiCard
          label="Items in Stock"
          value={isLoading ? '…' : totalItems}
          icon={<Package size={20} />}
          colorClass="kpi-icon-primary"
          change="Active inventory items"
        />
        <KpiCard
          label="Stock Received (Month)"
          value={loadingStats ? '…' : stats.received}
          icon={<PackagePlus size={20} />}
          colorClass="kpi-icon-success"
          change="Total units received this month"
        />
        <KpiCard
          label="Consumed (Month)"
          value={loadingStats ? '…' : stats.consumed}
          icon={<TrendingDown size={20} />}
          colorClass="kpi-icon-warning"
          change="Total units consumed this month"
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

      {/* Two-column content */}
      <div className="two-col-grid">
        {/* Recent Transactions */}
        <Card>
          <CardHeader title="Recent Transactions" icon={<Clock size={16} />} />
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
  const { alsGroupFilter } = useStationStore();
  const [stations, setStations] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [damagedItems, setDamagedItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadALSData();
  }, [alsGroupFilter]);

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

      const stationOrder = ['ALVA','PNCU','CPPY','AATK','MUTT','KLMT','CCUV','PDPM','EDAP','CGPP','PARV','JLSD','KALR','TNHL','MGRD','MACE','ERSH','KVTR','EMKM','VYTA','TKDM','PETT','VAKK','SNJN','TPHT'];

      const filteredStations = stationsData
        .filter((s) => !allowedStations || allowedStations.includes(s.code))
        .sort((a, b) => {
          const indexA = stationOrder.indexOf(a.code);
          const indexB = stationOrder.indexOf(b.code);
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

      // 3. Fetch Damaged/Disposed items for analytics
      let damageQuery = supabase.from('consumable_assets')
        .select('item_id, quantity, inventory_items(name, unit)')
        .eq('status', 'disposed');
        
      if (allowedStations && stationIds.length > 0) {
        damageQuery = damageQuery.in('station_id', stationIds);
      }
      const { data: damageData } = await damageQuery;

      const damageMap = {};
      (damageData || []).forEach(d => {
        if (!damageMap[d.item_id]) {
          damageMap[d.item_id] = { name: d.inventory_items?.name, unit: d.inventory_items?.unit, total: 0 };
        }
        damageMap[d.item_id].total += Number(d.quantity);
      });
      const topDamaged = Object.values(damageMap).sort((a, b) => b.total - a.total).slice(0, 5);

      setStations(filteredStations);
      setPendingApprovals(pendingRes.count ?? 0);
      setDamagedItems(topDamaged);
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
  }, [selectedStationDetail, modalMonth]); // eslint-disable-line

  const loadStationDetails = async () => {
    if (!selectedStationDetail) return;
    setIsModalLoading(true);
    try {
      const [year, month] = modalMonth.split('-');
      const startDate = `${year}-${month}-01`;
      const endDate = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of month

      if (modalTab === 'stock') {
        const { data } = await supabase
          .from('v_station_inventory_summary')
          .select('*')
          .eq('station_id', selectedStationDetail.id);
        setStationStock(data ?? []);
      } else {
        const { data } = await supabase
          .from('consumption_logs')
          .select('*, inventory_items(name, unit, rate_master(unit_rate))')
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
      <div className="dashboard-welcome animate-fade-in">
        <div>
          <div className="dashboard-welcome-title">ALS Dashboard 📊</div>
          <div className="dashboard-welcome-sub">Complete system overview — all 25 stations</div>
        </div>
        <Activity size={48} style={{ opacity: 0.2 }} />
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

      <div className="two-col-grid" style={{ marginBottom: 'var(--space-6)' }}>
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
                    <div className="als-station-code">{s.code}</div>
                    <div className="als-station-name">{s.name}</div>
                    <div className="als-station-stats">
                      <Badge variant="primary">View Details</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader 
            title="High Replacement Risk (Frequently Damaged)" 
            icon={<AlertTriangle size={16} style={{ color: 'var(--color-danger-500)' }} />} 
          />
          <CardBody style={{ padding: 0 }}>
            <DataTable
              columns={[
                { key: 'name', label: 'Item Name' },
                { key: 'total', label: 'Total Units Damaged/Disposed', render: (v, r) => <span style={{ color: 'var(--color-danger-600)', fontWeight: 600 }}>{v} {r.unit}</span> },
              ]}
              data={damagedItems.map((d, i) => ({ ...d, id: i }))}
              isLoading={isLoading}
              emptyTitle="No damaged items recorded"
              emptyDesc="No items have been marked as disposed/damaged in this group."
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
              { key: 'current_stock', label: 'Quantity on Hand', render: (v, r) => `${v} ${r.unit}` },
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
                  ₹{stationConsumption.reduce((sum, r) => sum + (Number(r.quantity_used) * Number(r.inventory_items?.rate_master?.unit_rate || 0)), 0).toFixed(2)}
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
                { key: 'consumption_date', label: 'Date', sortable: true },
                { key: 'item_name', label: 'Item', render: (_, r) => r.inventory_items?.name ?? '—' },
                { key: 'quantity_used', label: 'Quantity Used', render: (v, r) => `${v} ${r.inventory_items?.unit ?? ''}` },
                { key: 'cost', label: 'Estimated Cost', render: (_, r) => {
                  const rate = r.inventory_items?.rate_master?.unit_rate || 0;
                  return rate > 0 ? `₹${(Number(r.quantity_used) * rate).toFixed(2)}` : '—';
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
