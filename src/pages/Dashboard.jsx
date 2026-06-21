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
import { ROLES } from '../lib/constants';

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
          .eq('station_id', sid).gte('received_date', monthStart),
        supabase.from('consumption_logs').select('quantity_used', { count: 'exact', head: false })
          .eq('station_id', sid).gte('consumption_date', monthStart),
        supabase.from('consumable_requests').select('id', { count: 'exact', head: false })
          .eq('station_id', sid).in('status', ['pending', 'forwarded_als']),
        supabase.from('stock_received').select('*, inventory_items(name,unit)')
          .eq('station_id', sid).order('created_at', { ascending: false }).limit(5),
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

  return (
    <>
      {/* Welcome Banner */}
      <div className="dashboard-welcome animate-fade-in">
        <div>
          <div className="dashboard-welcome-title">Good day! 👋</div>
          <div className="dashboard-welcome-sub">Here's your station overview for today</div>
          <div className="dashboard-welcome-station">
            <Building2 size={14} />
            {station.code} — {station.name}
          </div>
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
  const [stations, setStations] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadALSData();
  }, []);

  const loadALSData = async () => {
    setIsLoading(true);
    try {
      const [stationsRes, pendingRes] = await Promise.all([
        supabase.from('stations').select('id, code, name').eq('is_active', true).order('code'),
        supabase.from('consumable_requests')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'forwarded_als']),
      ]);

      setStations(stationsRes.data ?? []);
      setPendingApprovals(pendingRes.count ?? 0);
    } catch (err) {
      console.error('ALS dashboard error:', err);
    } finally {
      setIsLoading(false);
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

      <Card>
        <CardHeader title="All Stations Overview" icon={<Building2 size={16} />} />
        <CardBody style={{ padding: 'var(--space-5)' }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>Loading…</div>
          ) : (
            <div className="als-stations-grid">
              {stations.map((s) => (
                <div key={s.id} className="als-station-chip">
                  <div className="als-station-code">{s.code}</div>
                  <div className="als-station-name">{s.name}</div>
                  <div className="als-station-stats">
                    <Badge variant="primary">Active</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const { role } = useAuthStore();
  const { selectedStation } = useStationStore();

  const isALS = role === ROLES.ALS;

  return (
    <Layout
      title={isALS ? 'ALS Dashboard' : 'Station Dashboard'}
      subtitle={isALS ? 'All stations overview' : selectedStation?.name}
    >
      {isALS ? <ALSDashboard /> : <StationDashboard station={selectedStation} />}
    </Layout>
  );
}
