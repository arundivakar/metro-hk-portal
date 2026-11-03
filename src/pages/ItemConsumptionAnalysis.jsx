import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Package,
  Calendar,
  BarChart2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Minus,
  Info,
  ChevronUp,
  ChevronDown,
  Building2,
} from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import Alert from '../components/ui/Alert';
import Spinner from '../components/ui/Spinner';
import { supabase, fetchAll } from '../lib/supabase';
import { STATION_ORDER } from '../lib/constants';
import { toDisplayValue, getDisplayUnit } from '../utils/units';
import './ItemConsumptionAnalysis.css';

// Distinct palette for multi-station line chart
const PALETTE = [
  '#0d9488', '#6366f1', '#f59e0b', '#ec4899', '#3b82f6',
  '#10b981', '#8b5cf6', '#f97316', '#14b8a6', '#06b6d4',
  '#84cc16', '#e11d48', '#d97706', '#4f46e5', '#059669',
];

// Formatting helper that preserves legitimate fractional source values without distortion
function formatQty(val, unit) {
  if (val === null || val === undefined) return '—';
  if (unit === 'Nos') {
    return Number.isInteger(val) ? val.toString() : Number(val).toFixed(2);
  }
  return Number(val).toFixed(2);
}

export default function ItemConsumptionAnalysis() {
  const { itemId } = useParams();

  // State
  const [item, setItem] = useState(null);
  const [stations, setStations] = useState([]);
  const [availableFYs, setAvailableFYs] = useState(['2026-27', '2025-26', '2024-25']);
  const [financialYear, setFinancialYear] = useState('2026-27');
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Sorting for main table: 'station_asc' | 'station_desc' | 'geographic' | 'total_desc' | 'total_asc'
  const [tableSort, setTableSort] = useState('geographic');

  // Heatmap toggle for monthly consumption table
  const [showHeatmap, setShowHeatmap] = useState(false);

  // MoM selected comparison month key (e.g. '2026-10')
  const [momMonthKey, setMomMonthKey] = useState('');

  // MoM sorting: 'diff_desc' (default) | 'diff_asc' | 'pct_desc' | 'pct_asc' | 'station_asc' | 'station_desc'
  const [momSort, setMomSort] = useState('diff_desc');

  // Selected stations for Chart B (station comparison)
  const [selectedStationCodes, setSelectedStationCodes] = useState([]);

  // Chart B network average toggle
  const [showNetworkAverage, setShowNetworkAverage] = useState(true);

  // Chart A view toggle: monthly vs cumulative
  const [isCumulative, setIsCumulative] = useState(false);

  // Chart C ranking limit: 'all' (default) | 'top5'
  const [rankingLimit, setRankingLimit] = useState('all');

  // Tooltip state for SVG charts
  const [svgTooltip, setSvgTooltip] = useState(null);

  // Determine current system date in Indian Standard Time (Asia/Kolkata)
  const { currentYear, currentMonth, currentYM } = useMemo(() => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'numeric',
      }).formatToParts(new Date());
      const y = parseInt(parts.find((p) => p.type === 'year')?.value, 10);
      const m = parseInt(parts.find((p) => p.type === 'month')?.value, 10);
      return {
        currentYear: y,
        currentMonth: m,
        currentYM: `${y}-${String(m).padStart(2, '0')}`,
      };
    } catch {
      const d = new Date();
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      return {
        currentYear: y,
        currentMonth: m,
        currentYM: `${y}-${String(m).padStart(2, '0')}`,
      };
    }
  }, []);

  // Default FY calculation
  const defaultCurrentFY = useMemo(() => {
    return currentMonth >= 4
      ? `${currentYear}-${String(currentYear + 1).slice(-2)}`
      : `${currentYear - 1}-${String(currentYear).slice(-2)}`;
  }, [currentYear, currentMonth]);

  // Set default FY once on mount
  useEffect(() => {
    if (defaultCurrentFY) {
      setFinancialYear(defaultCurrentFY);
    }
  }, [defaultCurrentFY]);

  // Load item metadata and active stations
  useEffect(() => {
    let isMounted = true;

    async function loadMetadata() {
      setIsLoading(true);
      setError(null);
      try {
        // 1. Fetch Item Details
        const { data: itemData, error: itemErr } = await supabase
          .from('inventory_items')
          .select(`
            id, name, category, unit, min_stock_level, is_active,
            rate_master:rate_master_id (
              brand, tender_year, unit_rate, nos_per_kg, supplier
            )
          `)
          .eq('id', itemId)
          .single();

        if (itemErr) throw new Error(itemErr.message || 'Item not found');
        if (!isMounted) return;
        setItem(itemData);

        // 2. Fetch Active Stations
        const { data: stationsData, error: stationsErr } = await supabase
          .from('stations')
          .select('id, name, code, is_active')
          .eq('is_active', true);

        if (stationsErr) throw new Error(stationsErr.message || 'Failed to load stations');
        if (!isMounted) return;

        // Sort by canonical geographical North-to-South order
        const ordered = (stationsData || [])
          .filter((s) => STATION_ORDER.includes(s.code))
          .sort((a, b) => STATION_ORDER.indexOf(a.code) - STATION_ORDER.indexOf(b.code));

        setStations(ordered);

        // 3. Discover available FYs from consumption_logs for this item
        const { data: dateData } = await supabase
          .from('consumption_logs')
          .select('consumption_date')
          .eq('item_id', itemId);

        const discoveredFYs = new Set(['2026-27', '2025-26', '2024-25']);
        if (defaultCurrentFY) discoveredFYs.add(defaultCurrentFY);

        (dateData || []).forEach((r) => {
          if (r.consumption_date) {
            const [y, m] = r.consumption_date.split('-').map(Number);
            const sy = m >= 4 ? y : y - 1;
            discoveredFYs.add(`${sy}-${String(sy + 1).slice(-2)}`);
          }
        });

        const sortedFYs = Array.from(discoveredFYs).sort().reverse();
        setAvailableFYs(sortedFYs);
      } catch (err) {
        if (isMounted) setError(err.message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    if (itemId) {
      loadMetadata();
    }

    return () => {
      isMounted = false;
    };
  }, [itemId, defaultCurrentFY]);

  // Compute 12 financial-year months for the chosen financial year
  const { startYear, endYear, fyMonths, precedingMarch } = useMemo(() => {
    const parts = financialYear.split('-');
    const sy = parseInt(parts[0], 10) || currentYear;
    const ey = sy + 1;

    const months = [
      { key: `${sy}-04`, label: 'Apr', monthNum: 4, year: sy },
      { key: `${sy}-05`, label: 'May', monthNum: 5, year: sy },
      { key: `${sy}-06`, label: 'Jun', monthNum: 6, year: sy },
      { key: `${sy}-07`, label: 'Jul', monthNum: 7, year: sy },
      { key: `${sy}-08`, label: 'Aug', monthNum: 8, year: sy },
      { key: `${sy}-09`, label: 'Sep', monthNum: 9, year: sy },
      { key: `${sy}-10`, label: 'Oct', monthNum: 10, year: sy },
      { key: `${sy}-11`, label: 'Nov', monthNum: 11, year: sy },
      { key: `${sy}-12`, label: 'Dec', monthNum: 12, year: sy },
      { key: `${ey}-01`, label: 'Jan', monthNum: 1, year: ey },
      { key: `${ey}-02`, label: 'Feb', monthNum: 2, year: ey },
      { key: `${ey}-03`, label: 'Mar', monthNum: 3, year: ey },
    ];

    const marchOfPrev = { key: `${sy}-03`, label: 'Mar (Prev FY)', monthNum: 3, year: sy };

    return { startYear: sy, endYear: ey, fyMonths: months, precedingMarch: marchOfPrev };
  }, [financialYear, currentYear]);

  // Fetch consumption logs for this item for the selected FY (plus preceding March)
  useEffect(() => {
    let isMounted = true;

    async function loadLogs() {
      if (!itemId || !startYear) return;
      setIsLoading(true);
      setError(null);

      try {
        // Query window: startYear-03-01 to endYear-03-31
        const startDate = `${startYear}-03-01`;
        const endDate = `${endYear}-03-31`;

        const logsQuery = supabase
          .from('consumption_logs')
          .select('id, station_id, quantity_used, consumption_date, remarks')
          .eq('item_id', itemId)
          .gte('consumption_date', startDate)
          .lte('consumption_date', endDate);

        const { data: logsData, error: logsErr } = await fetchAll(logsQuery);
        if (logsErr) throw logsErr;
        if (!isMounted) return;

        // Filter out transfers (both transfer-out and transfer-in)
        const genuineLogs = (logsData || []).filter((l) => {
          if (!l.remarks) return true;
          const r = l.remarks.trim().toLowerCase();
          if (r.includes('transfer out') || r.includes('transfer in')) return false;
          if (r.startsWith('inter-station transfer') || r.startsWith('depot transfer')) return false;
          return true;
        });

        setLogs(genuineLogs);
      } catch (err) {
        if (isMounted) setError(err.message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadLogs();

    return () => {
      isMounted = false;
    };
  }, [itemId, startYear, endYear]);

  // Raw base unit and display unit
  const dbUnit = item?.unit || 'Nos';
  const displayUnit = getDisplayUnit(dbUnit);

  // Month classification helper
  const getMonthTiming = (mKey) => {
    if (mKey > currentYM) return 'future';
    if (mKey === currentYM) return 'current';
    return 'elapsed';
  };

  // Build aggregated station consumption map
  // stationTotals[stationId][monthKey] = converted display value
  const { stationMonthData, monthNetworkTotals, stationFYTotals, totalFYConsumption, activeStationsCount } = useMemo(() => {
    const rawMap = {};
    stations.forEach((s) => {
      rawMap[s.id] = {};
    });

    // Accumulate raw quantities
    logs.forEach((log) => {
      if (!log.station_id || !log.consumption_date) return;
      const mKey = log.consumption_date.substring(0, 7); // YYYY-MM
      if (!rawMap[log.station_id]) rawMap[log.station_id] = {};
      rawMap[log.station_id][mKey] = (rawMap[log.station_id][mKey] || 0) + Number(log.quantity_used || 0);
    });

    // Convert to display units
    const converted = {};
    const stationTotals = {};
    const monthTotals = {};
    fyMonths.forEach((m) => {
      monthTotals[m.key] = 0;
    });
    monthTotals[precedingMarch.key] = 0;

    let totalFY = 0;
    let activeCount = 0;

    stations.forEach((s) => {
      converted[s.id] = {};
      let sFYSum = 0;

      // Handle preceding March
      const rawMarch = rawMap[s.id]?.[precedingMarch.key] || 0;
      converted[s.id][precedingMarch.key] = toDisplayValue(rawMarch, dbUnit);
      monthTotals[precedingMarch.key] += converted[s.id][precedingMarch.key];

      // Handle 12 FY months
      fyMonths.forEach((m) => {
        const timing = getMonthTiming(m.key);
        if (timing === 'future') {
          converted[s.id][m.key] = null; // future month indicator
        } else {
          const rawVal = rawMap[s.id]?.[m.key] || 0;
          const dispVal = toDisplayValue(rawVal, dbUnit);
          converted[s.id][m.key] = dispVal;
          sFYSum += dispVal;
          monthTotals[m.key] += dispVal;
        }
      });

      stationTotals[s.id] = sFYSum;
      totalFY += sFYSum;
      if (sFYSum > 0) activeCount += 1;
    });

    return {
      stationMonthData: converted,
      monthNetworkTotals: monthTotals,
      stationFYTotals: stationTotals,
      totalFYConsumption: totalFY,
      activeStationsCount: activeCount,
    };
  }, [stations, logs, fyMonths, precedingMarch, dbUnit, currentYM]);

  // Maximum monthly value across all stations and active months for heatmap intensity
  const maxMonthlyVal = useMemo(() => {
    let max = 0;
    stations.forEach((s) => {
      fyMonths.forEach((m) => {
        const val = stationMonthData[s.id]?.[m.key];
        if (val && val > max) max = val;
      });
    });
    return max;
  }, [stations, fyMonths, stationMonthData]);

  // Determine completed months in the FY
  const completedMonths = useMemo(() => {
    return fyMonths.filter((m) => getMonthTiming(m.key) === 'elapsed');
  }, [fyMonths, currentYM]);

  // Set default comparison month to latest completed month (or current month if none completed)
  useEffect(() => {
    if (completedMonths.length > 0) {
      setMomMonthKey(completedMonths[completedMonths.length - 1].key);
    } else {
      // Default to April if in progress or beginning of FY
      setMomMonthKey(fyMonths[0]?.key || '');
    }
  }, [completedMonths, fyMonths]);

  // Top consuming station calculation
  const topStation = useMemo(() => {
    if (!stations.length) return null;
    let top = null;
    let maxVal = -1;
    stations.forEach((s) => {
      const val = stationFYTotals[s.id] || 0;
      if (val > maxVal) {
        maxVal = val;
        top = { station: s, total: val };
      }
    });
    return top && top.total > 0 ? top : null;
  }, [stations, stationFYTotals]);

  // Initialize selected stations for Chart B with top 3 stations
  useEffect(() => {
    if (stations.length > 0 && selectedStationCodes.length === 0) {
      // Find top 3 consuming stations
      const sorted = [...stations].sort((a, b) => (stationFYTotals[b.id] || 0) - (stationFYTotals[a.id] || 0));
      const top3 = sorted.slice(0, 3).map((s) => s.code);
      setSelectedStationCodes(top3.length > 0 ? top3 : [stations[0].code]);
    }
  }, [stations, stationFYTotals, selectedStationCodes]);

  // Format quantity helper (preserves legitimate source fractions without distortion)
  const fmtQty = (val) => formatQty(val, displayUnit);

  // Network station average (includes all 25 active stations, even those with zero consumption)
  const networkAverage = stations.length > 0 ? totalFYConsumption / stations.length : 0;

  // Sort table rows
  const sortedStations = useMemo(() => {
    const list = [...stations];
    if (tableSort === 'geographic') {
      return list.sort((a, b) => STATION_ORDER.indexOf(a.code) - STATION_ORDER.indexOf(b.code));
    }
    if (tableSort === 'station_asc') {
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (tableSort === 'station_desc') {
      return list.sort((a, b) => b.name.localeCompare(a.name));
    }
    if (tableSort === 'total_desc') {
      return list.sort((a, b) => (stationFYTotals[b.id] || 0) - (stationFYTotals[a.id] || 0));
    }
    if (tableSort === 'total_asc') {
      return list.sort((a, b) => (stationFYTotals[a.id] || 0) - (stationFYTotals[b.id] || 0));
    }
    return list;
  }, [stations, tableSort, stationFYTotals]);

  // Month-on-Month comparison calculation for selected month
  const { momComparisonData, momPrecedingLabel, momCurrentLabel, momNetworkTrend, momIsMTD } = useMemo(() => {
    if (!momMonthKey) {
      return {
        momComparisonData: [],
        momPrecedingLabel: '',
        momCurrentLabel: '',
        momNetworkTrend: null,
        momIsMTD: false,
      };
    }

    // Find index of momMonthKey in fyMonths
    const mIndex = fyMonths.findIndex((m) => m.key === momMonthKey);
    let prevKey = '';
    let prevLabel = '';
    let currLabel = '';
    const isMTD = getMonthTiming(momMonthKey) === 'current';

    if (mIndex === 0) {
      // April compares to March of previous calendar year
      prevKey = precedingMarch.key;
      prevLabel = `March ${startYear}`;
      currLabel = `April ${startYear}`;
    } else if (mIndex > 0) {
      prevKey = fyMonths[mIndex - 1].key;
      prevLabel = `${fyMonths[mIndex - 1].label} ${fyMonths[mIndex - 1].year}`;
      currLabel = `${fyMonths[mIndex].label} ${fyMonths[mIndex].year}`;
    } else {
      prevKey = precedingMarch.key;
      prevLabel = 'Previous Month';
      currLabel = 'Selected Month';
    }

    let netPrev = 0;
    let netCurr = 0;

    const rows = stations.map((s) => {
      const prevVal = stationMonthData[s.id]?.[prevKey] ?? 0;
      const currVal = stationMonthData[s.id]?.[momMonthKey] ?? 0;
      netPrev += prevVal;
      netCurr += currVal;

      const diff = currVal - prevVal;
      let changePct = null;
      let statusLabel = 'No Change';
      let statusVariant = 'neutral';

      if (prevVal === 0 && currVal === 0) {
        changePct = 0;
        statusLabel = 'No Change';
        statusVariant = 'neutral';
      } else if (prevVal === 0 && currVal > 0) {
        changePct = null;
        statusLabel = 'New Consumption';
        statusVariant = 'info';
      } else if (currVal === 0 && prevVal > 0) {
        changePct = -100;
        statusLabel = '-100% Decrease';
        statusVariant = 'success';
      } else if (diff > 0) {
        const pct = (diff / prevVal) * 100;
        changePct = pct;
        if (pct >= 50) {
          statusLabel = `+${pct.toFixed(1)}% Significant`;
          statusVariant = 'danger';
        } else if (pct >= 25) {
          statusLabel = `+${pct.toFixed(1)}% High`;
          statusVariant = 'warning';
        } else if (pct >= 10) {
          statusLabel = `+${pct.toFixed(1)}% Moderate`;
          statusVariant = 'warning';
        } else {
          statusLabel = `+${pct.toFixed(1)}% Normal`;
          statusVariant = 'neutral';
        }
      } else if (diff < 0) {
        const pct = (diff / prevVal) * 100;
        changePct = pct;
        statusLabel = `${pct.toFixed(1)}% Decreased`;
        statusVariant = 'success';
      }

      return {
        station: s,
        prevVal,
        currVal,
        diff,
        changePct,
        statusLabel,
        statusVariant,
      };
    });

    // Network overall trend
    const netDiff = netCurr - netPrev;
    let netPct = 0;
    if (netPrev > 0) {
      netPct = ((netCurr - netPrev) / netPrev) * 100;
    }

    return {
      momComparisonData: rows,
      momPrecedingLabel: prevLabel,
      momCurrentLabel: currLabel,
      momNetworkTrend: { prev: netPrev, curr: netCurr, diff: netDiff, pct: netPct },
      momIsMTD: isMTD,
    };
  }, [momMonthKey, fyMonths, precedingMarch, startYear, stations, stationMonthData]);

  // Stations with persistent or high increase (≥25%) in comparison month
  const highIncreaseStations = useMemo(() => {
    return momComparisonData.filter(
      (r) => r.statusVariant === 'danger' || (r.statusVariant === 'warning' && r.changePct >= 25)
    );
  }, [momComparisonData]);

  // Sorted MoM comparison rows (default by highest actual quantity increase: diff_desc)
  const sortedMomRows = useMemo(() => {
    const list = [...momComparisonData];
    if (momSort === 'diff_desc') {
      return list.sort((a, b) => b.diff - a.diff);
    }
    if (momSort === 'diff_asc') {
      return list.sort((a, b) => a.diff - b.diff);
    }
    if (momSort === 'pct_desc') {
      return list.sort((a, b) => {
        const aPct = a.changePct !== null ? a.changePct : (a.currVal > 0 ? 999999 : 0);
        const bPct = b.changePct !== null ? b.changePct : (b.currVal > 0 ? 999999 : 0);
        return bPct - aPct;
      });
    }
    if (momSort === 'pct_asc') {
      return list.sort((a, b) => {
        const aPct = a.changePct !== null ? a.changePct : (a.currVal > 0 ? 999999 : 0);
        const bPct = b.changePct !== null ? b.changePct : (b.currVal > 0 ? 999999 : 0);
        return aPct - bPct;
      });
    }
    if (momSort === 'station_asc') {
      return list.sort((a, b) => a.station.name.localeCompare(b.station.name));
    }
    if (momSort === 'station_desc') {
      return list.sort((a, b) => b.station.name.localeCompare(a.station.name));
    }
    return list;
  }, [momComparisonData, momSort]);

  // Toggle station selection for Chart B (allows selecting/deselecting up to 6 stations)
  const toggleStationSelection = (code) => {
    if (selectedStationCodes.includes(code)) {
      setSelectedStationCodes(selectedStationCodes.filter((c) => c !== code));
    } else {
      if (selectedStationCodes.length < 6) {
        setSelectedStationCodes([...selectedStationCodes, code]);
      }
    }
  };

  if (isLoading && !item) {
    return (
      <Layout title="Item Consumption Analysis" subtitle="Loading item data...">
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
          <Spinner size="lg" />
        </div>
      </Layout>
    );
  }

  if (error || !item) {
    return (
      <Layout title="Item Consumption Analysis" subtitle="Error">
        <Alert variant="danger">
          <strong>Failed to load item:</strong> {error || 'Item not found'}
        </Alert>
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Link to="/inventory" className="analysis-back-btn">
            <ArrowLeft size={16} /> Back to All Inventory
          </Link>
        </div>
      </Layout>
    );
  }

  const brand = item.rate_master?.brand || 'N/A';
  const tenderYear = item.rate_master?.tender_year || 'N/A';
  const unitRate = item.rate_master?.unit_rate;

  return (
    <Layout
      title="Item Consumption Analysis"
      subtitle={`${item.name} — Station-wise Monthly Trends across all 25 stations`}
    >
      <div className="analysis-container">
        {/* Navigation & Item Header Card */}
        <div className="analysis-header-card">
          <div className="analysis-nav-row">
            <Link to="/inventory" className="analysis-back-btn">
              <ArrowLeft size={16} /> Back to All Inventory
            </Link>

            <div className="analysis-fy-picker">
              <Calendar size={16} color="var(--color-primary-600, #0d9488)" />
              <label htmlFor="fy-selector">Financial Year:</label>
              <select
                id="fy-selector"
                value={financialYear}
                onChange={(e) => setFinancialYear(e.target.value)}
                className="analysis-fy-select"
              >
                {availableFYs.map((fy) => (
                  <option key={fy} value={fy}>
                    FY {fy} (Apr {fy.split('-')[0]} – Mar 20{fy.split('-')[1]})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="analysis-title-row">
            <h1 className="analysis-item-name">
              <Package size={24} color="var(--color-primary-700, #0f766e)" />
              {item.name}
            </h1>

            <div className="analysis-badges-row">
              <span className="meta-pill">
                Brand: <strong>{brand}</strong>
              </span>
              <span className="meta-pill">
                Tender Year: <strong>{tenderYear}</strong>
              </span>
              <span className="meta-pill">
                Category: <strong>{item.category}</strong>
              </span>
              <span className="meta-pill">
                Display Unit: <strong>{displayUnit}</strong>
                {dbUnit !== displayUnit && <span style={{ color: 'var(--color-gray-500)' }}>(Base: {dbUnit})</span>}
              </span>
              {unitRate && (
                <span className="meta-pill">
                  Rate: <strong>₹{unitRate}</strong>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Summary KPI Cards */}
        <div className="analysis-kpi-grid">
          <div className="analysis-kpi-card">
            <div className="analysis-kpi-label">
              <span>Total FY Consumption</span>
              <Package size={16} />
            </div>
            <div className="analysis-kpi-val">
              {fmtQty(totalFYConsumption)} <span style={{ fontSize: '15px', fontWeight: 500 }}>{displayUnit}</span>
            </div>
            <div className="analysis-kpi-sub">
              Network Avg (all 25 stns): <strong>{fmtQty(networkAverage)} {displayUnit}</strong>
            </div>
          </div>

          <div className="analysis-kpi-card">
            <div className="analysis-kpi-label">
              <span>Active Consuming Stations</span>
              <Building2 size={16} />
            </div>
            <div className="analysis-kpi-val">
              {activeStationsCount} <span style={{ fontSize: '15px', fontWeight: 500 }}>/ {stations.length}</span>
            </div>
            <div className="analysis-kpi-sub">
              {stations.length - activeStationsCount} station{stations.length - activeStationsCount === 1 ? '' : 's'} with 0 consumption
            </div>
          </div>

          <div className="analysis-kpi-card">
            <div className="analysis-kpi-label">
              <span>Top Consuming Station</span>
              <TrendingUp size={16} />
            </div>
            <div className="analysis-kpi-val" style={{ fontSize: '18px', display: 'flex', alignItems: 'baseline', gap: 6 }}>
              {topStation ? (
                <>
                  <span>{topStation.station.name}</span>
                  <span style={{ fontSize: '14px', color: 'var(--color-primary-700)', fontWeight: 600 }}>
                    ({fmtQty(topStation.total)} {displayUnit})
                  </span>
                </>
              ) : (
                <span style={{ color: 'var(--color-gray-400)' }}>None</span>
              )}
            </div>
            <div className="analysis-kpi-sub">
              {topStation ? `Station code: ${topStation.station.code}` : 'No consumption recorded'}
            </div>
          </div>

          <div className="analysis-kpi-card">
            <div className="analysis-kpi-label">
              <span>Latest Network Trend</span>
              {momNetworkTrend?.diff > 0 ? (
                <TrendingUp size={16} color="var(--color-warning-600)" />
              ) : momNetworkTrend?.diff < 0 ? (
                <TrendingDown size={16} color="var(--color-success-600)" />
              ) : (
                <Minus size={16} color="var(--color-gray-400)" />
              )}
            </div>
            <div className="analysis-kpi-val">
              {momNetworkTrend ? (
                <span
                  style={{
                    color:
                      momNetworkTrend.diff > 0
                        ? 'var(--color-warning-700)'
                        : momNetworkTrend.diff < 0
                        ? 'var(--color-success-700)'
                        : 'inherit',
                  }}
                >
                  {momNetworkTrend.diff > 0 ? '+' : ''}
                  {momNetworkTrend.pct.toFixed(1)}%
                </span>
              ) : (
                '—'
              )}
            </div>
            <div className="analysis-kpi-sub">
              {momCurrentLabel} vs {momPrecedingLabel}
            </div>
          </div>
        </div>

        {/* Sustained / High Increase Warning Banner */}
        {highIncreaseStations.length > 0 && (
          <Alert variant="warning">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={18} />
              <div>
                <strong>High Consumption Increase Alert in {momCurrentLabel}:</strong>{' '}
                {highIncreaseStations.map((h, idx) => (
                  <span key={h.station.code}>
                    <strong>
                      {h.station.name} ({h.statusLabel})
                    </strong>
                    {idx < highIncreaseStations.length - 1 ? ', ' : ''}
                  </span>
                ))}
                . Monitoring recommended to distinguish operational variation from overconsumption.
              </div>
            </div>
          </Alert>
        )}

        {/* 1. Main 12-Month Station-wise Table */}
        <div className="analysis-table-card">
          <div className="analysis-table-header-wrap">
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--color-gray-900)' }}>
                Station-wise Monthly Consumption (FY {financialYear})
              </h2>
              <div style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginTop: 2 }}>
                All quantities in <strong>{displayUnit}</strong>. Horizontal scroll enabled for 12 months.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '12px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn btn-secondary ${showHeatmap ? 'btn-primary' : ''}`}
                style={{ fontSize: '12px', padding: '4px 10px' }}
                onClick={() => setShowHeatmap(!showHeatmap)}
                title="Toggle subtle color intensity based on station consumption distribution"
              >
                Heatmap: {showHeatmap ? 'ON' : 'OFF'}
              </button>

              <span style={{ color: 'var(--color-gray-500)' }}>Sort by:</span>
              <button
                type="button"
                className={`btn btn-secondary ${tableSort === 'geographic' ? 'btn-primary' : ''}`}
                style={{ fontSize: '12px', padding: '4px 10px' }}
                onClick={() => setTableSort('geographic')}
              >
                Geographic
              </button>
              <button
                type="button"
                className={`btn btn-secondary ${tableSort.startsWith('station') ? 'btn-primary' : ''}`}
                style={{ fontSize: '12px', padding: '4px 10px' }}
                onClick={() => setTableSort(tableSort === 'station_asc' ? 'station_desc' : 'station_asc')}
              >
                Station {tableSort === 'station_asc' ? '▲' : '▼'}
              </button>
              <button
                type="button"
                className={`btn btn-secondary ${tableSort.startsWith('total') ? 'btn-primary' : ''}`}
                style={{ fontSize: '12px', padding: '4px 10px' }}
                onClick={() => setTableSort(tableSort === 'total_desc' ? 'total_asc' : 'total_desc')}
              >
                FY Total {tableSort === 'total_desc' ? '▼' : '▲'}
              </button>
            </div>
          </div>

          <div className="analysis-table-scroll">
            <table className="analysis-table">
              <thead>
                <tr>
                  <th
                    className={`sortable ${tableSort.startsWith('station') ? 'sort-active' : ''}`}
                    onClick={() => setTableSort(tableSort === 'station_asc' ? 'station_desc' : 'station_asc')}
                  >
                    Station
                  </th>
                  {fyMonths.map((m) => {
                    const timing = getMonthTiming(m.key);
                    return (
                      <th key={m.key}>
                        {m.label}
                        {timing === 'current' && <span className="month-mtd">MTD</span>}
                      </th>
                    );
                  })}
                  <th
                    className={`sortable ${tableSort.startsWith('total') ? 'sort-active' : ''}`}
                    onClick={() => setTableSort(tableSort === 'total_desc' ? 'total_asc' : 'total_desc')}
                  >
                    FY Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedStations.map((s) => {
                  const sTotal = stationFYTotals[s.id] || 0;
                  return (
                    <tr key={s.id}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{s.name}</span>{' '}
                        <span style={{ fontSize: '11px', color: 'var(--color-gray-500)' }}>({s.code})</span>
                      </td>
                      {fyMonths.map((m) => {
                        const val = stationMonthData[s.id]?.[m.key];
                        const timing = getMonthTiming(m.key);
                        if (timing === 'future') {
                          return (
                            <td key={m.key} className="month-future">
                              —
                            </td>
                          );
                        }
                        let cellStyle = undefined;
                        if (showHeatmap && val > 0 && maxMonthlyVal > 0) {
                          const ratio = Math.min(val / maxMonthlyVal, 1);
                          const alpha = (0.07 + ratio * 0.40).toFixed(2);
                          cellStyle = {
                            backgroundColor: `rgba(13, 148, 136, ${alpha})`,
                            color: ratio >= 0.5 ? '#0f172a' : 'inherit',
                            fontWeight: ratio >= 0.5 ? 600 : 400,
                          };
                        }
                        return (
                          <td key={m.key} style={cellStyle} className={showHeatmap ? 'cell-heatmap' : undefined}>
                            {fmtQty(val)}
                          </td>
                        );
                      })}
                      <td style={{ fontWeight: 700, color: sTotal > 0 ? 'var(--color-primary-800)' : 'var(--color-gray-400)' }}>
                        {fmtQty(sTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total (All Stations)</td>
                  {fyMonths.map((m) => {
                    const timing = getMonthTiming(m.key);
                    if (timing === 'future') {
                      return (
                        <td key={m.key} className="month-future">
                          —
                        </td>
                      );
                    }
                    const totalVal = monthNetworkTotals[m.key] || 0;
                    return <td key={m.key}>{fmtQty(totalVal)}</td>;
                  })}
                  <td>{fmtQty(totalFYConsumption)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 2. Month-on-Month Comparison Card */}
        <div className="mom-card">
          <div className="mom-header">
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--color-gray-900)' }}>
                Month-on-Month Consumption Comparison
              </h2>
              <div style={{ fontSize: '12px', color: 'var(--color-gray-500)', marginTop: 2 }}>
                Comparing <strong>{momCurrentLabel}</strong> against <strong>{momPrecedingLabel}</strong>.
                {momIsMTD && <span className="month-mtd" style={{ marginLeft: 6 }}>Month to Date (Partial Month)</span>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '13px' }}>
                <label htmlFor="mom-select" style={{ fontWeight: 500, color: 'var(--color-gray-700)' }}>
                  Comparison Month:
                </label>
                <select
                  id="mom-select"
                  value={momMonthKey}
                  onChange={(e) => setMomMonthKey(e.target.value)}
                  className="analysis-fy-select"
                  style={{ padding: '4px 8px', fontSize: '13px' }}
                >
                  {fyMonths
                    .filter((m) => getMonthTiming(m.key) !== 'future')
                    .map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label} {m.year} {getMonthTiming(m.key) === 'current' ? '(MTD)' : ''}
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '12px' }}>
                <span style={{ color: 'var(--color-gray-500)' }}>Sort:</span>
                <button
                  type="button"
                  className={`btn btn-secondary ${momSort.startsWith('diff') ? 'btn-primary' : ''}`}
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  onClick={() => setMomSort(momSort === 'diff_desc' ? 'diff_asc' : 'diff_desc')}
                  title="Sort by actual quantity difference"
                >
                  Qty Diff {momSort === 'diff_desc' ? '▼' : '▲'}
                </button>
                <button
                  type="button"
                  className={`btn btn-secondary ${momSort.startsWith('pct') ? 'btn-primary' : ''}`}
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  onClick={() => setMomSort(momSort === 'pct_desc' ? 'pct_asc' : 'pct_desc')}
                  title="Sort by percentage change"
                >
                  % Change {momSort === 'pct_desc' ? '▼' : '▲'}
                </button>
                <button
                  type="button"
                  className={`btn btn-secondary ${momSort.startsWith('station') ? 'btn-primary' : ''}`}
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  onClick={() => setMomSort(momSort === 'station_asc' ? 'station_desc' : 'station_asc')}
                  title="Sort by station name"
                >
                  Station {momSort === 'station_asc' ? '▲' : '▼'}
                </button>
              </div>

              <div className="mom-legend">
                <Badge variant="neutral">&lt;10% Normal</Badge>
                <Badge variant="warning">10-25% Moderate</Badge>
                <Badge variant="warning">25-50% High</Badge>
                <Badge variant="danger">≥50% Significant</Badge>
                <Badge variant="success">Decreased</Badge>
                <Badge variant="info">New Consumption</Badge>
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="mom-table">
              <thead>
                <tr>
                  <th
                    className={`sortable ${momSort.startsWith('station') ? 'sort-active' : ''}`}
                    onClick={() => setMomSort(momSort === 'station_asc' ? 'station_desc' : 'station_asc')}
                  >
                    Station {momSort === 'station_asc' ? '▲' : momSort === 'station_desc' ? '▼' : ''}
                  </th>
                  <th>{momPrecedingLabel} ({displayUnit})</th>
                  <th>{momCurrentLabel} ({displayUnit})</th>
                  <th
                    className={`sortable ${momSort.startsWith('diff') ? 'sort-active' : ''}`}
                    onClick={() => setMomSort(momSort === 'diff_desc' ? 'diff_asc' : 'diff_desc')}
                  >
                    Difference ({displayUnit}) {momSort === 'diff_desc' ? '▼' : momSort === 'diff_asc' ? '▲' : ''}
                  </th>
                  <th
                    className={`sortable ${momSort.startsWith('pct') ? 'sort-active' : ''}`}
                    onClick={() => setMomSort(momSort === 'pct_desc' ? 'pct_asc' : 'pct_desc')}
                  >
                    Change % {momSort === 'pct_desc' ? '▼' : momSort === 'pct_asc' ? '▲' : ''}
                  </th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedMomRows.map((row) => {
                  const isHighIncrease =
                    (row.changePct !== null && row.changePct >= 25) ||
                    (row.prevVal === 0 && row.currVal > 0);
                  return (
                    <tr key={row.station.id} className={isHighIncrease ? 'mom-row-warning' : undefined}>
                      <td>
                        {row.station.name}{' '}
                        <span style={{ fontSize: '11px', color: 'var(--color-gray-500)' }}>({row.station.code})</span>
                      </td>
                      <td>{fmtQty(row.prevVal)}</td>
                      <td>{fmtQty(row.currVal)}</td>
                      <td
                        style={{
                          fontWeight: 600,
                          color:
                            row.diff > 0
                              ? 'var(--color-warning-700, #b45309)'
                              : row.diff < 0
                              ? 'var(--color-success-700, #15803d)'
                              : 'inherit',
                        }}
                      >
                        {row.diff > 0 ? `+${fmtQty(row.diff)}` : fmtQty(row.diff)}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {row.changePct === null
                          ? '—'
                          : `${row.changePct > 0 ? '+' : ''}${row.changePct.toFixed(1)}%`}
                      </td>
                      <td>
                        <Badge variant={row.statusVariant}>{row.statusLabel}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="mom-total-row">
                  <td>
                    <strong>Total (All 25 Stations)</strong>
                  </td>
                  <td>
                    <strong>{fmtQty(momNetworkTrend?.prev ?? 0)}</strong>
                  </td>
                  <td>
                    <strong>{fmtQty(momNetworkTrend?.curr ?? 0)}</strong>
                  </td>
                  <td
                    style={{
                      fontWeight: 700,
                      color:
                        momNetworkTrend?.diff > 0
                          ? 'var(--color-warning-700, #b45309)'
                          : momNetworkTrend?.diff < 0
                          ? 'var(--color-success-700, #15803d)'
                          : 'inherit',
                    }}
                  >
                    {momNetworkTrend?.diff > 0
                      ? `+${fmtQty(momNetworkTrend.diff)}`
                      : fmtQty(momNetworkTrend?.diff ?? 0)}
                  </td>
                  <td style={{ fontWeight: 700 }}>
                    {momNetworkTrend?.prev > 0
                      ? `${momNetworkTrend.pct > 0 ? '+' : ''}${momNetworkTrend.pct.toFixed(1)}%`
                      : momNetworkTrend?.curr > 0
                      ? 'New'
                      : '0.0%'}
                  </td>
                  <td>
                    <Badge
                      variant={
                        momNetworkTrend?.pct >= 25
                          ? 'warning'
                          : momNetworkTrend?.diff > 0
                          ? 'warning'
                          : momNetworkTrend?.diff < 0
                          ? 'success'
                          : 'neutral'
                      }
                    >
                      {momNetworkTrend?.diff > 0
                        ? `+${momNetworkTrend.pct.toFixed(1)}% Network Increase`
                        : momNetworkTrend?.diff < 0
                        ? `${momNetworkTrend.pct.toFixed(1)}% Network Decrease`
                        : 'No Network Change'}
                    </Badge>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 3. Visual Charts Section */}
        <div className="charts-grid">
          {/* Chart A: Overall Monthly Consumption Line Chart */}
          <div className="chart-card">
            <div className="chart-header">
              <div>
                <h3 className="chart-title">
                  <BarChart2 size={18} color="var(--color-primary-600)" />
                  Chart A: Overall Monthly Consumption Trend
                </h3>
                <div className="chart-subtitle">
                  {isCumulative
                    ? `Cumulative network consumption of ${item.name} over FY ${financialYear}`
                    : `Total network consumption of ${item.name} for each month of FY ${financialYear}`}
                </div>
              </div>

              <div className="chart-header-actions">
                <div className="chart-view-toggle">
                  <button
                    type="button"
                    className={`chart-toggle-btn ${!isCumulative ? 'active' : ''}`}
                    onClick={() => setIsCumulative(false)}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    className={`chart-toggle-btn ${isCumulative ? 'active' : ''}`}
                    onClick={() => setIsCumulative(true)}
                  >
                    Cumulative
                  </button>
                </div>
              </div>
            </div>

            <div className="chart-legend-indicator">
              <span className="chart-legend-item">
                <span className="legend-line-sample solid"></span>
                <span>Completed Months</span>
              </span>
              <span className="chart-legend-item">
                <span className="legend-line-sample dashed"></span>
                <span>Current Month (MTD)</span>
              </span>
            </div>

            <div className="chart-svg-container">
              <MonthlyTrendLineChart
                months={fyMonths}
                totals={monthNetworkTotals}
                unit={displayUnit}
                currentYM={currentYM}
                isCumulative={isCumulative}
                setTooltip={setSvgTooltip}
              />
            </div>
          </div>

          {/* Chart B: Multi-Station Comparison Chart */}
          <div className="chart-card">
            <div className="chart-header">
              <div>
                <h3 className="chart-title">
                  <TrendingUp size={18} color="var(--color-primary-600)" />
                  Chart B: Station Consumption Trend Comparison
                </h3>
                <div className="chart-subtitle">
                  Select stations below to compare their month-on-month trends side by side (up to 6 stations)
                </div>
              </div>

              <div className="chart-header-actions">
                <button
                  type="button"
                  className={`chart-toggle-btn ${showNetworkAverage ? 'active' : ''}`}
                  onClick={() => setShowNetworkAverage(!showNetworkAverage)}
                  title="Toggle Network Average reference line (all 25 active stations)"
                >
                  <span className="legend-line-sample solid" style={{ borderTopColor: '#64748b', width: 14 }}></span>
                  Network Average
                </button>
                <button
                  type="button"
                  className="btn-clear-selection"
                  onClick={() => setSelectedStationCodes([])}
                  disabled={selectedStationCodes.length === 0}
                  title="Deselect all stations"
                >
                  Clear All ({selectedStationCodes.length})
                </button>
              </div>
            </div>

            <div className="chart-legend-indicator">
              <span className="chart-legend-item">
                <span className="legend-line-sample solid" style={{ borderTopColor: '#64748b' }}></span>
                <span>Completed Months</span>
              </span>
              <span className="chart-legend-item">
                <span className="legend-line-sample dashed" style={{ borderTopColor: '#64748b' }}></span>
                <span>Current Month (MTD)</span>
              </span>
              {showNetworkAverage && (
                <span className="chart-legend-item">
                  <span className="legend-line-sample solid" style={{ borderTopColor: '#64748b', borderWidth: 2 }}></span>
                  <span style={{ color: '#475569', fontWeight: 600 }}>Network Avg (all 25 stns)</span>
                </span>
              )}
            </div>

            <div className="station-pill-list">
              {stations.map((s, idx) => {
                const isSelected = selectedStationCodes.includes(s.code);
                const colorIdx = selectedStationCodes.indexOf(s.code);
                const color = isSelected ? PALETTE[colorIdx % PALETTE.length] : undefined;
                return (
                  <button
                    key={s.code}
                    type="button"
                    className={`station-pill ${isSelected ? 'active' : ''}`}
                    style={isSelected ? { backgroundColor: color } : {}}
                    onClick={() => toggleStationSelection(s.code)}
                  >
                    <span>{s.code}</span>
                    <span style={{ fontSize: '10px', opacity: 0.85 }}>({fmtQty(stationFYTotals[s.id] || 0)})</span>
                  </button>
                );
              })}
            </div>

            <div className="chart-svg-container">
              <MultiStationLineChart
                months={fyMonths}
                stations={stations.filter((s) => selectedStationCodes.includes(s.code))}
                selectedStationCodes={selectedStationCodes}
                stationData={stationMonthData}
                unit={displayUnit}
                currentYM={currentYM}
                showNetworkAverage={showNetworkAverage}
                monthNetworkTotals={monthNetworkTotals}
                totalStationsCount={stations.length}
                setTooltip={setSvgTooltip}
              />
            </div>
          </div>

          {/* Chart C: Station Ranking Bar Chart */}
          <div className="chart-card">
            <div className="chart-header">
              <div>
                <h3 className="chart-title">
                  <BarChart2 size={18} color="var(--color-primary-600)" />
                  Chart C: Station Ranking by Total Consumption
                </h3>
                <div className="chart-subtitle">
                  {rankingLimit === 'top5'
                    ? `Top 5 stations ranked by FY ${financialYear} consumption`
                    : `All 25 stations ranked from highest to lowest FY ${financialYear} consumption`}
                </div>
              </div>

              <div className="chart-header-actions">
                <div className="chart-view-toggle">
                  <button
                    type="button"
                    className={`chart-toggle-btn ${rankingLimit === 'top5' ? 'active' : ''}`}
                    onClick={() => setRankingLimit('top5')}
                  >
                    Top 5
                  </button>
                  <button
                    type="button"
                    className={`chart-toggle-btn ${rankingLimit === 'all' ? 'active' : ''}`}
                    onClick={() => setRankingLimit('all')}
                  >
                    All 25 Stations
                  </button>
                </div>
              </div>
            </div>

            <div className="chart-svg-container">
              <StationRankingBarChart
                stations={stations}
                stationTotals={stationFYTotals}
                unit={displayUnit}
                rankingLimit={rankingLimit}
                setTooltip={setSvgTooltip}
              />
            </div>
          </div>
        </div>

        {/* Global SVG Tooltip */}
        {svgTooltip && (
          <div
            className="svg-tooltip"
            style={{ left: `${svgTooltip.x}px`, top: `${svgTooltip.y}px` }}
          >
            {svgTooltip.content}
          </div>
        )}
      </div>
    </Layout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Native SVG Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate nice, clean tick values and maximum for Y-axis.
 * Guarantees that:
 * 1. Tick values are exact and distinct (no duplicate labels).
 * 2. If isIntegerOnly is true (e.g. Nos items), all ticks are integers.
 * 3. Gridlines and data points use the exact same getY transformation.
 */
function getNiceYScale(rawMax, maxTicks = 5, isIntegerOnly = false) {
  if (!rawMax || rawMax <= 0) {
    const niceMax = isIntegerOnly ? 4 : 1;
    const ticks = isIntegerOnly ? [0, 1, 2, 3, 4] : [0, 0.25, 0.5, 0.75, 1.0];
    return { niceMax, ticks };
  }

  // If Nos item and rawMax is small (<= 5), use simple unit steps 0, 1, 2, ...
  if (isIntegerOnly && rawMax <= 5) {
    const niceMax = Math.max(Math.ceil(rawMax), 2);
    const ticks = [];
    for (let i = 0; i <= niceMax; i++) {
      ticks.push(i);
    }
    return { niceMax, ticks };
  }

  // Calculate rough step
  const roughStep = rawMax / (maxTicks - 1);
  const exponent = Math.floor(Math.log10(roughStep));
  const fraction = roughStep / Math.pow(10, exponent);

  let niceFraction;
  if (fraction <= 1.2) niceFraction = 1;
  else if (fraction <= 2.5) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;

  let step = niceFraction * Math.pow(10, exponent);
  if (isIntegerOnly && step < 1) {
    step = 1;
  }

  const ticks = [];
  let current = 0;
  // Guard against infinite loops with max 10 ticks
  while (current < rawMax || ticks.length < 2) {
    ticks.push(Number(current.toFixed(6)));
    current += step;
    if (ticks.length > 10) break;
  }
  ticks.push(Number(current.toFixed(6)));
  const niceMax = ticks[ticks.length - 1];

  return { niceMax, ticks };
}

/**
 * Format a tick value for the axis label without rounding discrepancies
 */
function formatTickLabel(val) {
  if (val >= 1000) {
    const k = val / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  if (Number.isInteger(val)) {
    return val.toString();
  }
  return Number(val.toFixed(2)).toString();
}

/**
 * Chart A: Overall Monthly Consumption Line / Area Chart
 */
function MonthlyTrendLineChart({ months, totals, unit, currentYM, isCumulative = false, setTooltip }) {
  const svgRef = useRef(null);

  const WIDTH = 900;
  const HEIGHT = 260;
  const PADDING = { top: 20, right: 30, bottom: 40, left: 60 };
  const innerW = WIDTH - PADDING.left - PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;

  // Month partitions
  const completedMonths = months.filter((m) => m.key < currentYM);
  const mtdMonth = months.find((m) => m.key === currentYM);

  // Compute values (monthly or cumulative)
  let runningCum = 0;
  const displayValues = {};

  months.forEach((m) => {
    const rawVal = totals[m.key] || 0;
    if (m.key <= currentYM) {
      runningCum += rawVal;
      displayValues[m.key] = isCumulative ? runningCum : rawVal;
    } else {
      displayValues[m.key] = null; // future
    }
  });

  // Calculate nice Y scale based on active values (completed + mtd)
  const activeVals = months
    .filter((m) => m.key <= currentYM)
    .map((m) => displayValues[m.key] || 0);

  const rawMax = Math.max(...activeVals, 0);
  const isIntegerOnly = unit === 'Nos';
  const { niceMax, ticks } = getNiceYScale(rawMax, 5, isIntegerOnly);

  const stepX = innerW / (months.length - 1);
  const getY = (val) => PADDING.top + innerH - (val / niceMax) * innerH;

  // Build SVG path points for completed months
  const completedPoints = completedMonths.map((m) => {
    const idx = months.findIndex((item) => item.key === m.key);
    const val = displayValues[m.key] || 0;
    const x = PADDING.left + idx * stepX;
    const y = getY(val);
    return { x, y, month: m, val };
  });

  // MTD point
  const mtdPoint = mtdMonth
    ? {
        x: PADDING.left + months.findIndex((item) => item.key === mtdMonth.key) * stepX,
        y: getY(displayValues[mtdMonth.key] || 0),
        month: mtdMonth,
        val: displayValues[mtdMonth.key] || 0,
      }
    : null;

  // Completed solid line path
  const completedPathD = completedPoints.reduce((acc, pt, idx) => {
    return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
  }, '');

  // Gradient area fill - strictly restricted to completed months
  const completedAreaD =
    completedPoints.length > 1
      ? `${completedPathD} L ${completedPoints[completedPoints.length - 1].x} ${PADDING.top + innerH} L ${completedPoints[0].x} ${PADDING.top + innerH} Z`
      : '';

  // Dashed segment connecting last completed month to MTD
  let mtdDashedPathD = '';
  if (mtdPoint && completedPoints.length > 0) {
    const lastCompleted = completedPoints[completedPoints.length - 1];
    mtdDashedPathD = `M ${lastCompleted.x} ${lastCompleted.y} L ${mtdPoint.x} ${mtdPoint.y}`;
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      onMouseLeave={() => setTooltip(null)}
    >
      <defs>
        <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d9488" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#0d9488" stopOpacity="0.0" />
        </linearGradient>
      </defs>

      {/* Y-axis gridlines & labels */}
      {ticks.map((tickVal) => {
        const y = getY(tickVal);
        return (
          <g key={tickVal}>
            <line
              x1={PADDING.left}
              y1={y}
              x2={WIDTH - PADDING.right}
              y2={y}
              stroke="#e2e8f0"
              strokeDasharray={tickVal === 0 ? 'none' : '3,3'}
            />
            <text
              x={PADDING.left - 10}
              y={y + 4}
              textAnchor="end"
              fontSize={11}
              fill="#64748b"
              fontWeight={500}
            >
              {formatTickLabel(tickVal)}
            </text>
          </g>
        );
      })}

      {/* Shaded Area (completed months only) */}
      {completedAreaD && <path d={completedAreaD} fill="url(#areaGradient)" />}

      {/* Solid Line (completed months) */}
      {completedPathD && (
        <path d={completedPathD} fill="none" stroke="#0d9488" strokeWidth={3} strokeLinecap="round" />
      )}

      {/* Dashed Line (latest completed month to MTD month) */}
      {mtdDashedPathD && (
        <path
          d={mtdDashedPathD}
          fill="none"
          stroke="#0d9488"
          strokeWidth={3}
          strokeDasharray="6,4"
          strokeLinecap="round"
        />
      )}

      {/* Completed Months Circular Markers */}
      {completedPoints.map((pt) => (
        <circle
          key={pt.month.key}
          cx={pt.x}
          cy={pt.y}
          r={5}
          fill="#ffffff"
          stroke="#0d9488"
          strokeWidth={2.5}
          style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
          onMouseEnter={(e) =>
            setTooltip({
              content: isCumulative
                ? `${pt.month.label} ${pt.month.year} (Cumulative): ${formatQty(pt.val, unit)} ${unit}`
                : `${pt.month.label} ${pt.month.year}: ${formatQty(pt.val, unit)} ${unit}`,
              x: e.clientX,
              y: e.clientY,
            })
          }
          onMouseMove={(e) =>
            setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null))
          }
        />
      ))}

      {/* Distinct MTD Data Point Marker */}
      {mtdPoint && (
        <g>
          {/* Outer dashed halo ring */}
          <circle
            cx={mtdPoint.x}
            cy={mtdPoint.y}
            r={8}
            fill="none"
            stroke="#0d9488"
            strokeWidth={1.5}
            strokeDasharray="3,2"
          />
          {/* Inner core dot */}
          <circle
            cx={mtdPoint.x}
            cy={mtdPoint.y}
            r={4.5}
            fill="#0d9488"
            stroke="#ffffff"
            strokeWidth={2}
            style={{ cursor: 'pointer' }}
            onMouseEnter={(e) =>
              setTooltip({
                content: isCumulative
                  ? `${mtdPoint.month.label} ${mtdPoint.month.year} (MTD - Cumulative): ${formatQty(mtdPoint.val, unit)} ${unit} recorded so far`
                  : `${mtdPoint.month.label} ${mtdPoint.month.year} (MTD - Partial Month): ${formatQty(mtdPoint.val, unit)} ${unit} recorded so far`,
                x: e.clientX,
                y: e.clientY,
              })
            }
            onMouseMove={(e) =>
              setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null))
            }
          />
        </g>
      )}

      {/* X-axis Month Labels & MTD Indicator */}
      {months.map((m, idx) => {
        const x = PADDING.left + idx * stepX;
        const isFuture = m.key > currentYM;
        const isMTD = m.key === currentYM;

        return (
          <g key={m.key}>
            <text
              x={x}
              y={HEIGHT - 24}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill={isFuture ? '#94a3b8' : isMTD ? '#0f766e' : '#334155'}
            >
              {m.label}
            </text>

            {isMTD && (
              <g transform={`translate(${x - 14}, ${HEIGHT - 18})`}>
                <rect
                  x={0}
                  y={0}
                  width={28}
                  height={12}
                  rx={3}
                  fill="#ccfbf1"
                  stroke="#99f6e4"
                  strokeWidth={0.75}
                />
                <text
                  x={14}
                  y={9}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={700}
                  fill="#0f766e"
                  letterSpacing="0.05em"
                >
                  MTD
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Chart B: Multi-Station Consumption Trend Comparison
 */
function MultiStationLineChart({
  months,
  stations,
  selectedStationCodes,
  stationData,
  unit,
  currentYM,
  showNetworkAverage = false,
  monthNetworkTotals = {},
  totalStationsCount = 25,
  setTooltip,
}) {
  const WIDTH = 900;
  const HEIGHT = 260;
  const PADDING = { top: 20, right: 30, bottom: 40, left: 60 };
  const innerW = WIDTH - PADDING.left - PADDING.right;
  const innerH = HEIGHT - PADDING.top - PADDING.bottom;

  const completedMonths = months.filter((m) => m.key < currentYM);
  const mtdMonth = months.find((m) => m.key === currentYM);
  const activeMonths = months.filter((m) => m.key <= currentYM);

  // Determine overall max value for selected stations and network average across active months
  let rawMax = 0;
  stations.forEach((s) => {
    activeMonths.forEach((m) => {
      const v = stationData[s.id]?.[m.key] || 0;
      if (v > rawMax) rawMax = v;
    });
  });

  if (showNetworkAverage && totalStationsCount > 0) {
    activeMonths.forEach((m) => {
      const avg = (monthNetworkTotals[m.key] || 0) / totalStationsCount;
      if (avg > rawMax) rawMax = avg;
    });
  }

  const isIntegerOnly = unit === 'Nos';
  const { niceMax, ticks } = getNiceYScale(rawMax, 5, isIntegerOnly);

  const stepX = innerW / (months.length - 1);
  const getY = (val) => PADDING.top + innerH - (val / niceMax) * innerH;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      onMouseLeave={() => setTooltip(null)}
    >
      {/* Y-axis gridlines & labels */}
      {ticks.map((tickVal) => {
        const y = getY(tickVal);
        return (
          <g key={tickVal}>
            <line
              x1={PADDING.left}
              y1={y}
              x2={WIDTH - PADDING.right}
              y2={y}
              stroke="#e2e8f0"
              strokeDasharray={tickVal === 0 ? 'none' : '3,3'}
            />
            <text
              x={PADDING.left - 10}
              y={y + 4}
              textAnchor="end"
              fontSize={11}
              fill="#64748b"
              fontWeight={500}
            >
              {formatTickLabel(tickVal)}
            </text>
          </g>
        );
      })}

      {/* Empty selection notice if no station selected and network average disabled */}
      {stations.length === 0 && !showNetworkAverage && (
        <text
          x={WIDTH / 2}
          y={HEIGHT / 2}
          textAnchor="middle"
          fontSize={13}
          fill="#94a3b8"
          fontWeight={500}
        >
          Select stations above or enable Network Average to view trends
        </text>
      )}

      {/* Network Average Reference Line */}
      {showNetworkAverage && totalStationsCount > 0 && (() => {
        const avgColor = '#64748b';
        const avgCompletedPts = completedMonths.map((m) => {
          const idx = months.findIndex((item) => item.key === m.key);
          const val = (monthNetworkTotals[m.key] || 0) / totalStationsCount;
          return {
            x: PADDING.left + idx * stepX,
            y: getY(val),
            val,
            month: m,
          };
        });

        const avgCompletedPathD = avgCompletedPts.reduce((acc, pt, idx) => {
          return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
        }, '');

        const avgMtdVal = mtdMonth ? (monthNetworkTotals[mtdMonth.key] || 0) / totalStationsCount : 0;
        const avgMtdPt = mtdMonth
          ? {
              x: PADDING.left + months.findIndex((item) => item.key === mtdMonth.key) * stepX,
              y: getY(avgMtdVal),
              val: avgMtdVal,
              month: mtdMonth,
            }
          : null;

        let avgMtdDashedPathD = '';
        if (avgMtdPt && avgCompletedPts.length > 0) {
          const lastPt = avgCompletedPts[avgCompletedPts.length - 1];
          avgMtdDashedPathD = `M ${lastPt.x} ${lastPt.y} L ${avgMtdPt.x} ${avgMtdPt.y}`;
        }

        return (
          <g key="network-avg-series">
            {/* Solid line for completed months */}
            {avgCompletedPathD && (
              <path
                d={avgCompletedPathD}
                fill="none"
                stroke={avgColor}
                strokeWidth={2}
                strokeLinecap="round"
              />
            )}

            {/* Dashed line to MTD month */}
            {avgMtdDashedPathD && (
              <path
                d={avgMtdDashedPathD}
                fill="none"
                stroke={avgColor}
                strokeWidth={2}
                strokeDasharray="6,4"
                strokeLinecap="round"
              />
            )}

            {/* Completed months circular markers */}
            {avgCompletedPts.map((pt) => (
              <circle
                key={`avg-${pt.month.key}`}
                cx={pt.x}
                cy={pt.y}
                r={3.5}
                fill="#ffffff"
                stroke={avgColor}
                strokeWidth={2}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) =>
                  setTooltip({
                    content: `Network Avg (all 25 stns) - ${pt.month.label} ${pt.month.year}: ${formatQty(pt.val, unit)} ${unit}`,
                    x: e.clientX,
                    y: e.clientY,
                  })
                }
                onMouseMove={(e) =>
                  setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null))
                }
              />
            ))}

            {/* Distinct MTD marker */}
            {avgMtdPt && (
              <g>
                <circle
                  cx={avgMtdPt.x}
                  cy={avgMtdPt.y}
                  r={6.5}
                  fill="none"
                  stroke={avgColor}
                  strokeWidth={1.5}
                  strokeDasharray="3,2"
                />
                <circle
                  cx={avgMtdPt.x}
                  cy={avgMtdPt.y}
                  r={3.5}
                  fill={avgColor}
                  stroke="#ffffff"
                  strokeWidth={2}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) =>
                    setTooltip({
                      content: `Network Avg (all 25 stns) - ${avgMtdPt.month.label} (MTD - Partial Month): ${formatQty(avgMtdPt.val, unit)} ${unit} recorded so far`,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }
                  onMouseMove={(e) =>
                    setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null))
                  }
                />
              </g>
            )}
          </g>
        );
      })()}

      {/* Station Trend Lines */}
      {stations.map((s) => {
        const colorIdx = selectedStationCodes.indexOf(s.code);
        const color = PALETTE[colorIdx % PALETTE.length];

        // Completed points
        const completedPts = completedMonths.map((m) => {
          const idx = months.findIndex((item) => item.key === m.key);
          const val = stationData[s.id]?.[m.key] || 0;
          return {
            x: PADDING.left + idx * stepX,
            y: getY(val),
            val,
            month: m,
          };
        });

        const completedPathD = completedPts.reduce((acc, pt, idx) => {
          return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
        }, '');

        // MTD point and connecting dashed line
        const mtdPt = mtdMonth
          ? {
              x: PADDING.left + months.findIndex((item) => item.key === mtdMonth.key) * stepX,
              y: getY(stationData[s.id]?.[mtdMonth.key] || 0),
              val: stationData[s.id]?.[mtdMonth.key] || 0,
              month: mtdMonth,
            }
          : null;

        let mtdDashedPathD = '';
        if (mtdPt && completedPts.length > 0) {
          const lastPt = completedPts[completedPts.length - 1];
          mtdDashedPathD = `M ${lastPt.x} ${lastPt.y} L ${mtdPt.x} ${mtdPt.y}`;
        }

        return (
          <g key={s.id}>
            {/* Solid line for completed months */}
            {completedPathD && (
              <path d={completedPathD} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
            )}

            {/* Dashed line to MTD month */}
            {mtdDashedPathD && (
              <path
                d={mtdDashedPathD}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeDasharray="6,4"
                strokeLinecap="round"
              />
            )}

            {/* Completed months circular markers */}
            {completedPts.map((pt) => (
              <circle
                key={pt.month.key}
                cx={pt.x}
                cy={pt.y}
                r={4}
                fill="#ffffff"
                stroke={color}
                strokeWidth={2}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) =>
                  setTooltip({
                    content: `${s.name} (${s.code}) - ${pt.month.label} ${pt.month.year}: ${formatQty(pt.val, unit)} ${unit}`,
                    x: e.clientX,
                    y: e.clientY,
                  })
                }
                onMouseMove={(e) =>
                  setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null))
                }
              />
            ))}

            {/* Distinct MTD marker */}
            {mtdPt && (
              <g>
                <circle
                  cx={mtdPt.x}
                  cy={mtdPt.y}
                  r={7}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeDasharray="3,2"
                />
                <circle
                  cx={mtdPt.x}
                  cy={mtdPt.y}
                  r={4}
                  fill={color}
                  stroke="#ffffff"
                  strokeWidth={2}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) =>
                    setTooltip({
                      content: `${s.name} (${s.code}) - ${mtdPt.month.label} (MTD - Partial Month): ${formatQty(mtdPt.val, unit)} ${unit} recorded so far`,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }
                  onMouseMove={(e) =>
                    setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null))
                  }
                />
              </g>
            )}
          </g>
        );
      })}

      {/* Month Labels & MTD Indicator on X-axis */}
      {months.map((m, idx) => {
        const x = PADDING.left + idx * stepX;
        const isFuture = m.key > currentYM;
        const isMTD = m.key === currentYM;

        return (
          <g key={m.key}>
            <text
              x={x}
              y={HEIGHT - 24}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill={isFuture ? '#94a3b8' : isMTD ? '#0f766e' : '#334155'}
            >
              {m.label}
            </text>

            {isMTD && (
              <g transform={`translate(${x - 14}, ${HEIGHT - 18})`}>
                <rect
                  x={0}
                  y={0}
                  width={28}
                  height={12}
                  rx={3}
                  fill="#ccfbf1"
                  stroke="#99f6e4"
                  strokeWidth={0.75}
                />
                <text
                  x={14}
                  y={9}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={700}
                  fill="#0f766e"
                  letterSpacing="0.05em"
                >
                  MTD
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Chart C: Station Ranking Bar Chart
 */
function StationRankingBarChart({ stations, stationTotals, unit, rankingLimit = 'all', setTooltip }) {
  // Sort all stations descending by FY total
  const ranked = useMemo(() => {
    return [...stations].sort((a, b) => (stationTotals[b.id] || 0) - (stationTotals[a.id] || 0));
  }, [stations, stationTotals]);

  // Support Top 5 slice or All Stations
  const displayRanked = useMemo(() => {
    return rankingLimit === 'top5' ? ranked.slice(0, 5) : ranked;
  }, [ranked, rankingLimit]);

  const maxTotal = Math.max(...displayRanked.map((s) => stationTotals[s.id] || 0), 1);

  const BAR_HEIGHT = 20;
  const ROW_GAP = 8;
  const PADDING = { top: 10, right: 100, bottom: 20, left: 160 };
  const WIDTH = 900;
  const HEIGHT = PADDING.top + displayRanked.length * (BAR_HEIGHT + ROW_GAP) + PADDING.bottom;
  const innerW = WIDTH - PADDING.left - PADDING.right;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      onMouseLeave={() => setTooltip(null)}
    >
      {displayRanked.map((s, idx) => {
        const total = stationTotals[s.id] || 0;
        const y = PADDING.top + idx * (BAR_HEIGHT + ROW_GAP);
        const barW = total > 0 ? Math.max((total / maxTotal) * innerW, 4) : 0;

        return (
          <g
            key={s.id}
            onMouseEnter={(e) =>
              setTooltip({
                content: `${s.name} (${s.code}): ${formatQty(total, unit)} ${unit}`,
                x: e.clientX,
                y: e.clientY,
              })
            }
            onMouseMove={(e) =>
              setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null))
            }
            style={{ cursor: 'pointer' }}
          >
            {/* Station Label */}
            <text
              x={PADDING.left - 12}
              y={y + BAR_HEIGHT / 2 + 4}
              textAnchor="end"
              fontSize={12}
              fontWeight={idx < 3 ? 700 : 500}
              fill={idx < 3 ? '#0f766e' : '#334155'}
            >
              #{idx + 1} {s.name} ({s.code})
            </text>

            {/* Background track */}
            <rect
              x={PADDING.left}
              y={y}
              width={innerW}
              height={BAR_HEIGHT}
              rx={4}
              fill="#f1f5f9"
            />

            {/* Value Bar */}
            {barW > 0 && (
              <rect
                x={PADDING.left}
                y={y}
                width={barW}
                height={BAR_HEIGHT}
                rx={4}
                fill={idx < 3 ? '#0d9488' : '#14b8a6'}
                style={{ opacity: total > 0 ? 0.9 : 0.3 }}
              />
            )}

            {/* Value Label beside bar */}
            <text
              x={PADDING.left + barW + 8}
              y={y + BAR_HEIGHT / 2 + 4}
              textAnchor="start"
              fontSize={11}
              fontWeight={600}
              fill="#1e293b"
            >
              {formatQty(total, unit)} {unit}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
