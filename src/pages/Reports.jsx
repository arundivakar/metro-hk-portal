import React, { useEffect, useState, useMemo, useRef } from 'react';
import { BarChart2, AlertTriangle, TrendingDown, IndianRupee } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { ROLES, ALS_GROUPS, STATION_ORDER } from '../lib/constants';
import { supabase, fetchAll } from '../lib/supabase';
import { toDisplayValue, getDisplayUnit, toBillingQty } from '../utils/units';

// ─── ALS group colour map ──────────────────────────────────────────────────────
const GROUP_COLORS = {
  'ALVA-KLMT': { bar: '#14b8a6', bg: 'rgba(20,184,166,0.12)', label: '#0d9488' },
  'CCUV-JLSD': { bar: '#6366f1', bg: 'rgba(99,102,241,0.12)', label: '#4f46e5' },
  'KALR-KVTR': { bar: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: '#d97706' },
  'EMKM-TPHT': { bar: '#ec4899', bg: 'rgba(236,72,153,0.12)', label: '#db2777' },
};
const DEFAULT_COLOR = { bar: '#64748b', bg: 'rgba(100,116,139,0.12)', label: '#475569' };

function getGroupForStation(code) {
  for (const [group, codes] of Object.entries(ALS_GROUPS)) {
    if (codes && codes.includes(code)) return group;
  }
  return null;
}

// ─── Horizontal SVG Bar Chart ─────────────────────────────────────────────────
function StationSpendChart({ stationData, isLoading }) {
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);

  const ROW_H = 36;
  const LABEL_W = 60;
  const PADDING = { top: 16, right: 80, bottom: 32, left: LABEL_W };
  const chartW = 700;
  const chartH = stationData.length * ROW_H + PADDING.top + PADDING.bottom;
  const innerW = chartW - PADDING.left - PADDING.right;

  const maxSpend = useMemo(() => Math.max(...stationData.map(s => s.spend), 1), [stationData]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--color-gray-400)', gap: 8 }}>
        <div className="spinner" style={{ width: 20, height: 20, border: '2px solid var(--color-gray-200)', borderTopColor: 'var(--color-primary-500)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        Loading chart data…
      </div>
    );
  }

  if (!stationData.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 160, color: 'var(--color-gray-400)', gap: 8 }}>
        <BarChart2 size={36} />
        <p style={{ margin: 0 }}>No consumption data for this period</p>
      </div>
    );
  }

  // Tick marks
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => Math.round((maxSpend / tickCount) * i));

  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${chartW} ${chartH}`}
        style={{ width: '100%', maxWidth: chartW, display: 'block', fontFamily: 'var(--font-family-base)' }}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Grid lines */}
        {ticks.map((tick) => {
          const x = PADDING.left + (tick / maxSpend) * innerW;
          return (
            <g key={tick}>
              <line x1={x} y1={PADDING.top} x2={x} y2={chartH - PADDING.bottom} stroke="var(--color-gray-200)" strokeWidth={1} strokeDasharray={tick === 0 ? '0' : '3,3'} />
              <text x={x} y={chartH - PADDING.bottom + 14} textAnchor="middle" fontSize={10} fill="var(--color-gray-400)">
                {tick >= 1000 ? `₹${(tick / 1000).toFixed(1)}k` : `₹${tick}`}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {stationData.map((s, i) => {
          const group = getGroupForStation(s.code);
          const colors = group ? GROUP_COLORS[group] : DEFAULT_COLOR;
          const barW = Math.max((s.spend / maxSpend) * innerW, s.spend > 0 ? 2 : 0);
          const y = PADDING.top + i * ROW_H;
          const barY = y + ROW_H * 0.2;
          const barH = ROW_H * 0.6;

          return (
            <g key={s.code}
              onMouseEnter={(e) => setTooltip({ code: s.code, spend: s.spend, group, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setTooltip(t => ({ ...t, x: e.clientX, y: e.clientY }))}
              style={{ cursor: 'pointer' }}
            >
              {/* Row background on hover handled via opacity */}
              <rect x={0} y={y} width={chartW} height={ROW_H} fill="transparent" />

              {/* Station label */}
              <text x={PADDING.left - 8} y={barY + barH / 2 + 4} textAnchor="end" fontSize={11} fontWeight={600} fill={colors.label}>
                {s.code}
              </text>

              {/* Bar background track */}
              <rect x={PADDING.left} y={barY} width={innerW} height={barH} rx={4} fill={colors.bg} />

              {/* Value bar */}
              <rect x={PADDING.left} y={barY} width={barW} height={barH} rx={4} fill={colors.bar} style={{ transition: 'width 0.4s ease' }} />

              {/* Amount label at end of bar */}
              {s.spend > 0 && (
                <text
                  x={PADDING.left + barW + 6}
                  y={barY + barH / 2 + 4}
                  fontSize={10}
                  fontWeight={700}
                  fill={colors.label}
                >
                  ₹{s.spend.toFixed(0)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed',
          left: tooltip.x + 14,
          top: tooltip.y - 40,
          background: 'var(--color-gray-900)',
          color: '#fff',
          borderRadius: 8,
          padding: '6px 12px',
          fontSize: 12,
          pointerEvents: 'none',
          zIndex: 9999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          whiteSpace: 'nowrap',
        }}>
          <strong>{tooltip.code}</strong>
          {tooltip.group && <span style={{ color: '#94a3b8', marginLeft: 6 }}>({tooltip.group})</span>}
          <br />
          ₹{tooltip.spend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      )}
    </div>
  );
}

// ─── Group legend ─────────────────────────────────────────────────────────────
function GroupLegend() {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '8px 0 4px' }}>
      {Object.entries(GROUP_COLORS).map(([group, c]) => (
        <div key={group} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: c.bar }} />
          <span style={{ color: 'var(--color-gray-600)', fontWeight: 500 }}>{group}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Reports() {
  const { role } = useAuthStore();
  const { selectedStation, alsGroupFilter } = useStationStore();

  const [damagedItems, setDamagedItems] = useState([]);
  const [isLoadingDamage, setIsLoadingDamage] = useState(true);

  const [stationSpend, setStationSpend] = useState([]);
  const [isLoadingChart, setIsLoadingChart] = useState(true);
  const [totalSpend, setTotalSpend] = useState(0);

  // Month selector (defaults to current month)
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  useEffect(() => {
    loadDamageData();
  }, [alsGroupFilter, selectedStation?.id, role]); // eslint-disable-line

  useEffect(() => {
    loadSpendData();
  }, [alsGroupFilter, selectedStation?.id, role, selectedMonth]); // eslint-disable-line

  // ── Damage report ──────────────────────────────────────────────────────────
  const loadDamageData = async () => {
    setIsLoadingDamage(true);
    try {
      let damageQuery = supabase.from('consumable_assets')
        .select('item_id, quantity, inventory_items(name, unit)')
        .eq('status', 'disposed');

      if (role === ROLES.ALS || role === ROLES.HKTL) {
        const allowedStations = ALS_GROUPS[alsGroupFilter];
        if (allowedStations) {
          const { data: stationsData } = await supabase
            .from('stations')
            .select('id, code')
            .in('code', allowedStations)
            .eq('is_active', true);
          const stationIds = (stationsData || []).map(s => s.id);
          if (stationIds.length > 0) {
            damageQuery = damageQuery.in('station_id', stationIds);
          } else {
            damageQuery = damageQuery.eq('id', '00000000-0000-0000-0000-000000000000');
          }
        }
      } else if (selectedStation?.id) {
        damageQuery = damageQuery.eq('station_id', selectedStation.id);
      } else {
        setIsLoadingDamage(false);
        return;
      }

      const { data: damageData, error } = await damageQuery;
      if (error) throw error;

      const damageMap = {};
      (damageData || []).forEach(d => {
        if (!damageMap[d.item_id]) {
          damageMap[d.item_id] = { name: d.inventory_items?.name, unit: getDisplayUnit(d.inventory_items?.unit), total: 0 };
        }
        damageMap[d.item_id].total += toDisplayValue(d.quantity, d.inventory_items?.unit);
      });

      const topDamaged = Object.values(damageMap).sort((a, b) => b.total - a.total).slice(0, 10);
      setDamagedItems(topDamaged);
    } catch (err) {
      console.error('Error loading damage report:', err);
    } finally {
      setIsLoadingDamage(false);
    }
  };

  // ── Station spend chart data ───────────────────────────────────────────────
  const loadSpendData = async () => {
    setIsLoadingChart(true);
    try {
      const [year, month] = selectedMonth.split('-');
      const startDate = `${year}-${month}-01`;
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

      const logsQuery = supabase
        .from('consumption_logs')
        .select('quantity_used, remarks, stations(code), inventory_items(unit, rate_master(unit_rate, nos_per_kg, tender_year))')
        .gte('consumption_date', startDate)
        .lte('consumption_date', endDate);

      const { data: logs } = await fetchAll(logsQuery);

      // Compute spend per station
      const spendMap = {};
      (logs || []).forEach(log => {
        // Skip transfer-outs
        if (log.remarks?.startsWith('Inter-Station Transfer Out') || log.remarks?.startsWith('Depot Transfer Out')) return;

        const code = log.stations?.code;
        if (!code) return;

        // Skip pre-2024 tender items
        const tYear = log.inventory_items?.rate_master?.tender_year || '';
        if (tYear.toLowerCase().includes('before 2024')) return;
        const startYear = parseInt(tYear.split('-')[0]) || 0;
        if (startYear > 0 && startYear < 2024) return;

        const rate = log.inventory_items?.rate_master?.unit_rate || 0;
        const nosPerKg = log.inventory_items?.rate_master?.nos_per_kg || null;
        const cost = toBillingQty(log.quantity_used, log.inventory_items?.unit, nosPerKg) * rate;

        spendMap[code] = (spendMap[code] || 0) + cost;
      });

      // Filter by ALS group or station
      let allowedCodes = null;
      if (role === ROLES.ALS || role === ROLES.HKTL) {
        const allowedStations = ALS_GROUPS[alsGroupFilter];
        if (allowedStations) allowedCodes = allowedStations;
      } else if (role === ROLES.SC && selectedStation?.code) {
        allowedCodes = [selectedStation.code];
      }

      // Build sorted array
      const ordered = STATION_ORDER
        .filter(code => !allowedCodes || allowedCodes.includes(code))
        .map(code => ({ code, spend: spendMap[code] || 0 }))
        .filter(s => s.spend > 0 || allowedCodes?.includes(s.code));

      const total = ordered.reduce((sum, s) => sum + s.spend, 0);
      setStationSpend(ordered);
      setTotalSpend(total);
    } catch (err) {
      console.error('Error loading spend data:', err);
    } finally {
      setIsLoadingChart(false);
    }
  };

  const isALSorHKTL = role === ROLES.ALS || role === ROLES.HKTL;

  return (
    <Layout
      title="Reports"
      subtitle={isALSorHKTL ? 'System-wide analytics' : selectedStation?.name}
    >
      {/* ── Station Spend Chart ───────────────────────────────────────────── */}
      <Card style={{ marginBottom: 'var(--space-6)' }}>
        <CardHeader
          title="Station-wise Monthly Spend"
          icon={<IndianRupee size={16} style={{ color: 'var(--color-success-500)' }} />}
          subtitle={`Total: ₹${totalSpend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-gray-600)' }}>Month:</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                style={{
                  border: '1px solid var(--color-gray-300)',
                  borderRadius: 6,
                  padding: '4px 8px',
                  fontSize: 13,
                  background: 'var(--color-bg-primary)',
                  color: 'var(--color-gray-800)',
                  cursor: 'pointer',
                }}
              />
            </div>
          }
        />
        <CardBody>
          {isALSorHKTL && <GroupLegend />}
          <div style={{ marginTop: 8 }}>
            <StationSpendChart stationData={stationSpend} isLoading={isLoadingChart} />
          </div>

          {/* Summary table below chart */}
          {stationSpend.length > 0 && !isLoadingChart && (
            <div style={{ marginTop: 16, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--color-gray-50)' }}>
                    <th style={{ padding: '6px 12px', textAlign: 'left', color: 'var(--color-gray-500)', fontWeight: 600, borderBottom: '1px solid var(--color-gray-200)' }}>Station</th>
                    {isALSorHKTL && <th style={{ padding: '6px 12px', textAlign: 'left', color: 'var(--color-gray-500)', fontWeight: 600, borderBottom: '1px solid var(--color-gray-200)' }}>Group</th>}
                    <th style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--color-gray-500)', fontWeight: 600, borderBottom: '1px solid var(--color-gray-200)' }}>Spend (₹)</th>
                    <th style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--color-gray-500)', fontWeight: 600, borderBottom: '1px solid var(--color-gray-200)' }}>% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {stationSpend.map((s, i) => {
                    const group = getGroupForStation(s.code);
                    const colors = group ? GROUP_COLORS[group] : DEFAULT_COLOR;
                    const pct = totalSpend > 0 ? ((s.spend / totalSpend) * 100).toFixed(1) : '0.0';
                    return (
                      <tr key={s.code} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--color-gray-50)' }}>
                        <td style={{ padding: '6px 12px', fontWeight: 700, color: colors.label }}>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: colors.bar, marginRight: 6 }} />
                          {s.code}
                        </td>
                        {isALSorHKTL && (
                          <td style={{ padding: '6px 12px', color: 'var(--color-gray-500)', fontSize: 11 }}>{group || '—'}</td>
                        )}
                        <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--color-gray-800)' }}>
                          ₹{s.spend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '6px 12px', textAlign: 'right', color: 'var(--color-gray-500)' }}>{pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--color-gray-300)' }}>
                    <td colSpan={isALSorHKTL ? 2 : 1} style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--color-gray-800)' }}>TOTAL</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--color-success-700)' }}>
                      ₹{totalSpend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--color-gray-400)' }}>100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Damaged Items ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="High Replacement Risk (Frequently Damaged)"
          icon={<AlertTriangle size={16} style={{ color: 'var(--color-danger-500)' }} />}
        />
        <CardBody style={{ padding: 0 }}>
          <DataTable
            columns={[
              { key: 'name', label: 'Item Name' },
              {
                key: 'total', label: 'Total Units Damaged / Disposed',
                render: (v, r) => (
                  <span style={{ color: 'var(--color-danger-600)', fontWeight: 600 }}>{v} {r.unit}</span>
                ),
              },
            ]}
            data={damagedItems.map((d, i) => ({ ...d, id: i }))}
            isLoading={isLoadingDamage}
            emptyTitle="No damaged items recorded"
            emptyDesc="No items have been marked as disposed / damaged."
          />
        </CardBody>
      </Card>
    </Layout>
  );
}
