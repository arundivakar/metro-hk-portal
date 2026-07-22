import React, { useEffect, useState, useMemo } from 'react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { useAuthStore } from '../store/authStore';
import { supabase, fetchAll } from '../lib/supabase';
import { ROLES, ALS_GROUPS, STATION_ORDER } from '../lib/constants';
import { generateMonthlyBillPdf } from '../lib/pdfGenerator';
import { toBillingQty } from '../utils/units';
import toast from 'react-hot-toast';
import { Download, Calculator, Grid, List, Search } from 'lucide-react';

export default function MonthlyBill() {
  const { role } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  
  // View Mode: 'group' (4 Groups) or 'station' (All 25 Stations)
  const [viewMode, setViewMode] = useState('group');

  // Modal for detailed station breakdown of a selected item
  const [selectedItemForDetail, setSelectedItemForDetail] = useState(null);
  
  // Month Selection
  const today = new Date();
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonthStr);
  
  // Data
  const [allItems, setAllItems] = useState([]);
  const [consumptionLogs, setConsumptionLogs] = useState([]);

  useEffect(() => {
    loadData();
  }, [selectedMonth]); // eslint-disable-line

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [year, month] = selectedMonth.split('-');
      const startDate = `${year}-${month}-01`;
      const endDate = `${year}-${month}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

      // Fetch all active items
      const { data: itemsData, error: itemsErr } = await supabase
        .from('inventory_items')
        .select('*, rate_master ( unit_rate, tender_year, brand, supplier, nos_per_kg )')
        .eq('is_active', true)
        .limit(1000)
        .order('name');
      if (itemsErr) throw itemsErr;
      setAllItems(itemsData || []);

      // Fetch all consumption logs
      const logsQuery = supabase
        .from('consumption_logs')
        .select('*, inventory_items(name, unit, rate_master(brand, unit_rate, nos_per_kg, tender_year)), stations(code)')
        .gte('consumption_date', startDate)
        .lte('consumption_date', endDate);
      const { data: logsData, error: logsErr } = await fetchAll(logsQuery);
      if (logsErr) throw logsErr;
      setConsumptionLogs(logsData || []);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load bill data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGeneratePdf = async () => {
    setGeneratingPdf(true);
    try {
      const [year, month] = selectedMonth.split('-');
      await generateMonthlyBillPdf(month, year, consumptionLogs, allItems);
      toast.success('PDF downloaded successfully!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate PDF: ' + err.message);
    } finally {
      setGeneratingPdf(false);
    }
  };

  // Build aggregated table data (Group view & Station view)
  const { tableData, stationTableData, totals, stationTotals } = useMemo(() => {
    const groupedItems = {};

    // Initialise every active master item
    allItems.forEach(item => {
      const tYearStr = item.rate_master?.tender_year || '';
      if (tYearStr.toLowerCase().includes('before 2024')) return;
      const startYear = parseInt(tYearStr.split('-')[0]) || 0;
      if (startYear > 0 && startYear < 2024) return; // Exclude < 2024

      const dbUnit   = item.unit || 'Nos';
      const nosPerKg = item.rate_master?.nos_per_kg || null;

      const byStation = {};
      STATION_ORDER.forEach(code => { byStation[code] = 0; });

      groupedItems[item.id] = {
        id:        item.id,
        name:      item.name,
        brand:     item.rate_master?.brand    || 'ORDINARY',
        supplier:  item.rate_master?.supplier || 'Tricuesta',
        rate:      Number(item.rate_master?.unit_rate || 0),
        dbUnit,
        nosPerKg,
        'ALVA-KLMT': 0,
        'CCUV-JLSD': 0,
        'KALR-KVTR': 0,
        'EMKM-TPHT': 0,
        byStation,
      };
    });

    // Accumulate raw base-unit consumption
    consumptionLogs.forEach(log => {
      // Exclude transfer out logs (which are not real consumption)
      if (log.remarks?.startsWith('Inter-Station Transfer Out') || log.remarks?.startsWith('Depot Transfer Out')) {
        return;
      }
      
      const itemId = log.item_id;
      const stationCode = log.stations?.code;
      const qty = Number(log.quantity_used || 0);

      if (!groupedItems[itemId]) {
        const tYearStr = log.inventory_items?.rate_master?.tender_year || '';
        if (tYearStr.toLowerCase().includes('before 2024')) return;
        const startYear = parseInt(tYearStr.split('-')[0]) || 0;
        if (startYear > 0 && startYear < 2024) return; // Skip if it's explicitly before 2024

        const dbUnit   = log.inventory_items?.unit || 'Nos';
        const nosPerKg = log.inventory_items?.rate_master?.nos_per_kg || null;

        const byStation = {};
        STATION_ORDER.forEach(code => { byStation[code] = 0; });

        groupedItems[itemId] = {
          id:       itemId,
          name:     log.inventory_items?.name || 'Unknown',
          brand:    log.inventory_items?.rate_master?.brand    || 'ORDINARY',
          supplier: log.inventory_items?.rate_master?.supplier || 'Tricuesta',
          rate:     Number(log.inventory_items?.rate_master?.unit_rate || 0),
          dbUnit,
          nosPerKg,
          'ALVA-KLMT': 0,
          'CCUV-JLSD': 0,
          'KALR-KVTR': 0,
          'EMKM-TPHT': 0,
          byStation,
        };
      }

      if (stationCode && groupedItems[itemId].byStation[stationCode] !== undefined) {
        groupedItems[itemId].byStation[stationCode] += qty;
      }

      if      (ALS_GROUPS['ALVA-KLMT'].includes(stationCode)) groupedItems[itemId]['ALVA-KLMT'] += qty;
      else if (ALS_GROUPS['CCUV-JLSD'].includes(stationCode)) groupedItems[itemId]['CCUV-JLSD'] += qty;
      else if (ALS_GROUPS['KALR-KVTR'].includes(stationCode)) groupedItems[itemId]['KALR-KVTR'] += qty;
      else if (ALS_GROUPS['EMKM-TPHT'].includes(stationCode)) groupedItems[itemId]['EMKM-TPHT'] += qty;
    });

    let totalALVA = 0, totalCCUV = 0, totalKALR = 0, totalEMKM = 0, grandTotal = 0;
    const stTotals = {};
    STATION_ORDER.forEach(code => { stTotals[code] = 0; });

    const fmt = (v) => v === 0 ? '0' : v.toFixed(3).replace(/\.?0+$/, '');

    const groupRows = [];
    const stationRows = [];

    Object.values(groupedItems).forEach((item, index) => {
      const { dbUnit, nosPerKg, rate } = item;

      // Convert to billing qty
      const alvaQty = toBillingQty(item['ALVA-KLMT'], dbUnit, nosPerKg);
      const ccuvQty = toBillingQty(item['CCUV-JLSD'], dbUnit, nosPerKg);
      const kalrQty = toBillingQty(item['KALR-KVTR'], dbUnit, nosPerKg);
      const emkmQty = toBillingQty(item['EMKM-TPHT'], dbUnit, nosPerKg);

      const totalQty = alvaQty + ccuvQty + kalrQty + emkmQty;
      const amount   = totalQty * rate;

      totalALVA += alvaQty * rate;
      totalCCUV += ccuvQty * rate;
      totalKALR += kalrQty * rate;
      totalEMKM += emkmQty * rate;
      grandTotal += amount;

      // Station billing quantities map
      const stationBillingQty = {};
      STATION_ORDER.forEach(code => {
        const bQty = toBillingQty(item.byStation[code] || 0, dbUnit, nosPerKg);
        stationBillingQty[code] = fmt(bQty);
        stTotals[code] += bQty * rate;
      });

      groupRows.push({
        id: item.id,
        rawItem: item,
        sl_no: index + 1,
        item_name: item.name,
        brand: item.brand,
        supplier: item.supplier,
        rate: rate.toFixed(2),
        alva: fmt(alvaQty),
        ccuv: fmt(ccuvQty),
        kalr: fmt(kalrQty),
        emkm: fmt(emkmQty),
        total_qty: fmt(totalQty),
        amount: amount > 0 ? amount.toFixed(2) : '0.00',
      });

      stationRows.push({
        id: item.id,
        rawItem: item,
        sl_no: index + 1,
        item_name: item.name,
        brand: item.brand,
        supplier: item.supplier,
        rate: rate.toFixed(2),
        ...stationBillingQty,
        total_qty: fmt(totalQty),
        amount: amount > 0 ? amount.toFixed(2) : '0.00',
      });
    });

    return { 
      tableData: groupRows, 
      stationTableData: stationRows,
      totals: {
        alva: totalALVA,
        ccuv: totalCCUV,
        kalr: totalKALR,
        emkm: totalEMKM,
        grand: grandTotal
      },
      stationTotals: stTotals
    };
  }, [allItems, consumptionLogs]);

  // Group View Columns
  const groupColumns = [
    { key: 'sl_no', label: 'Sl. No', width: 60, render: (v) => <span style={{ color: 'var(--color-gray-500)' }}>{v}</span> },
    { key: 'item_name', label: 'Cleaning Material', render: (v, r) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button 
          type="button" 
          onClick={() => setSelectedItemForDetail(r.rawItem)} 
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary-600)', fontWeight: 'bold', cursor: 'pointer', textAlign: 'left' }}
          title="Click to view station-by-station breakdown"
        >
          {v}
        </button>
        <span 
          style={{ fontSize: '11px', color: 'var(--color-gray-400)', cursor: 'pointer', opacity: 0.7 }} 
          onClick={() => setSelectedItemForDetail(r.rawItem)}
          title="View station-wise breakdown"
        >
          🔍
        </span>
      </div>
    ) },
    { key: 'brand', label: 'Brand' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'rate', label: 'Rate' },
    { key: 'alva', label: 'ALVA-KLMT', width: 90, render: (v) => <span style={{ textAlign: 'center', display: 'block' }}>{v}</span> },
    { key: 'ccuv', label: 'CCUV-JLSD', width: 90, render: (v) => <span style={{ textAlign: 'center', display: 'block' }}>{v}</span> },
    { key: 'kalr', label: 'KALR-KVTR', width: 90, render: (v) => <span style={{ textAlign: 'center', display: 'block' }}>{v}</span> },
    { key: 'emkm', label: 'EMKM-TPHT', width: 90, render: (v) => <span style={{ textAlign: 'center', display: 'block' }}>{v}</span> },
    { key: 'total_qty', label: 'Total', width: 80, render: (v) => <strong style={{ textAlign: 'center', display: 'block' }}>{v}</strong> },
    { key: 'amount', label: 'Amount (₹)', render: (v) => <strong style={{ float: 'right' }}>₹{v}</strong> },
  ];

  // Station View Columns (All 25 Stations)
  const stationColumns = useMemo(() => [
    { key: 'sl_no', label: 'Sl. No', width: 60, render: (v) => <span style={{ color: 'var(--color-gray-500)' }}>{v}</span> },
    { key: 'item_name', label: 'Cleaning Material', render: (v, r) => (
      <button 
        type="button" 
        onClick={() => setSelectedItemForDetail(r.rawItem)} 
        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary-600)', fontWeight: 'bold', cursor: 'pointer', textAlign: 'left' }}
        title="Click to view station breakdown"
      >
        {v}
      </button>
    ) },
    { key: 'brand', label: 'Brand' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'rate', label: 'Rate' },
    ...STATION_ORDER.map(code => ({
      key: code,
      label: code,
      width: 70,
      render: (v) => <span style={{ textAlign: 'center', display: 'block', color: v === '0' ? 'var(--color-gray-400)' : 'var(--color-gray-900)' }}>{v}</span>
    })),
    { key: 'total_qty', label: 'Total', width: 80, render: (v) => <strong style={{ textAlign: 'center', display: 'block' }}>{v}</strong> },
    { key: 'amount', label: 'Amount (₹)', render: (v) => <strong style={{ float: 'right' }}>₹{v}</strong> },
  ], []);

  // Restrict access: requested by user to be only for ALS
  if (role !== ROLES.ALS) {
    return (
      <Layout title="Monthly Bill">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <h3>Access Denied</h3>
          <p>This page is restricted to ALS users only.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      title="Monthly Bill Preview"
      subtitle="KMRL-O&M-OPC-FOR-150"
      actions={
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600 }}>Month:</label>
            <input 
              type="month" 
              className="form-control" 
              value={selectedMonth} 
              onChange={e => setSelectedMonth(e.target.value)}
            />
          </div>
          <Button variant="primary" onClick={handleGeneratePdf} isLoading={generatingPdf}>
            <Download size={16} style={{ marginRight: '8px' }} />
            Download PDF
          </Button>
        </div>
      }
    >
      <Card>
        <CardHeader 
          title="Cleaning Material Consumption (Stations)" 
          icon={<Calculator size={16} />} 
          subtitle={`${tableData.length} items`}
          actions={
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button 
                variant={viewMode === 'group' ? 'primary' : 'outline'} 
                size="sm"
                onClick={() => setViewMode('group')}
              >
                <Grid size={14} style={{ marginRight: '6px' }} />
                Group Summary View
              </Button>
              <Button 
                variant={viewMode === 'station' ? 'primary' : 'outline'} 
                size="sm"
                onClick={() => setViewMode('station')}
              >
                <List size={14} style={{ marginRight: '6px' }} />
                All 25 Stations View
              </Button>
            </div>
          }
        />

        <div style={{ padding: 'var(--space-2) var(--space-4)', fontSize: '12px', color: 'var(--color-gray-500)', backgroundColor: 'var(--color-bg-subtle)', borderBottom: '1px solid var(--color-border)' }}>
          💡 <strong>Tip:</strong> Click on any material name to open its detailed station-by-station breakdown modal.
        </div>
        
        <div style={{ overflowX: 'auto', padding: 'var(--space-4)', backgroundColor: 'var(--color-bg-subtle)' }}>
          <div style={{ minWidth: viewMode === 'station' ? '2200px' : '1000px', backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
            <DataTable
              columns={viewMode === 'group' ? groupColumns : stationColumns}
              data={viewMode === 'group' ? tableData : stationTableData}
              isLoading={isLoading}
              emptyTitle="No data found for this month"
              footer={
                !isLoading && tableData.length > 0 ? (
                  viewMode === 'group' ? (
                    <tr style={{ backgroundColor: 'var(--color-gray-100)', fontWeight: 'bold', fontSize: '13px' }}>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '12px 16px', borderTop: '2px solid var(--color-border)' }}>TOTAL</td>
                      <td style={{ textAlign: 'center', padding: '12px 16px', borderTop: '2px solid var(--color-border)' }}>₹{totals.alva.toFixed(2)}</td>
                      <td style={{ textAlign: 'center', padding: '12px 16px', borderTop: '2px solid var(--color-border)' }}>₹{totals.ccuv.toFixed(2)}</td>
                      <td style={{ textAlign: 'center', padding: '12px 16px', borderTop: '2px solid var(--color-border)' }}>₹{totals.kalr.toFixed(2)}</td>
                      <td style={{ textAlign: 'center', padding: '12px 16px', borderTop: '2px solid var(--color-border)' }}>₹{totals.emkm.toFixed(2)}</td>
                      <td style={{ padding: '12px 16px', borderTop: '2px solid var(--color-border)' }}></td>
                      <td style={{ textAlign: 'right', padding: '12px 16px', borderTop: '2px solid var(--color-border)' }}>₹{totals.grand.toFixed(2)}</td>
                    </tr>
                  ) : (
                    <tr style={{ backgroundColor: 'var(--color-gray-100)', fontWeight: 'bold', fontSize: '13px' }}>
                      <td colSpan={5} style={{ textAlign: 'center', padding: '12px 16px', borderTop: '2px solid var(--color-border)' }}>TOTAL</td>
                      {STATION_ORDER.map(code => (
                        <td key={code} style={{ textAlign: 'center', padding: '12px 4px', fontSize: '11px', borderTop: '2px solid var(--color-border)' }}>
                          ₹{(stationTotals[code] || 0).toFixed(0)}
                        </td>
                      ))}
                      <td style={{ padding: '12px 16px', borderTop: '2px solid var(--color-border)' }}></td>
                      <td style={{ textAlign: 'right', padding: '12px 16px', borderTop: '2px solid var(--color-border)' }}>₹{totals.grand.toFixed(2)}</td>
                    </tr>
                  )
                ) : null
              }
            />
          </div>
        </div>
      </Card>

      {/* Station Breakdown Modal */}
      <Modal
        isOpen={!!selectedItemForDetail}
        onClose={() => setSelectedItemForDetail(null)}
        title={`Station Breakdown: ${selectedItemForDetail?.name}`}
        size="lg"
      >
        {selectedItemForDetail && (
          <div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px', fontSize: '13px', backgroundColor: 'var(--color-bg-subtle)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <div><strong>Brand:</strong> {selectedItemForDetail.brand}</div>
              <div><strong>Supplier:</strong> {selectedItemForDetail.supplier}</div>
              <div><strong>Rate:</strong> ₹{selectedItemForDetail.rate.toFixed(2)}</div>
              <div><strong>Billing Unit:</strong> {selectedItemForDetail.dbUnit}</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              {Object.entries(ALS_GROUPS).map(([groupName, stationCodes]) => {
                if (!stationCodes) return null;
                
                let groupTotal = 0;
                stationCodes.forEach(code => {
                  const bQty = toBillingQty(selectedItemForDetail.byStation[code] || 0, selectedItemForDetail.dbUnit, selectedItemForDetail.nosPerKg);
                  groupTotal += bQty;
                });

                const formattedGroupTotal = groupTotal === 0 ? '0' : groupTotal.toFixed(3).replace(/\.?0+$/, '');

                return (
                  <div key={groupName} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px', backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '2px solid var(--color-border)', paddingBottom: '6px' }}>
                      <strong style={{ fontSize: '13px', color: 'var(--color-primary-700)' }}>{groupName}</strong>
                      <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-gray-800)', backgroundColor: 'var(--color-primary-50)', padding: '2px 6px', borderRadius: '4px' }}>
                        {formattedGroupTotal}
                      </span>
                    </div>
                    <table style={{ width: '100%', fontSize: '12px' }}>
                      <tbody>
                        {stationCodes.map(code => {
                          const rawQty = selectedItemForDetail.byStation[code] || 0;
                          const bQty = toBillingQty(rawQty, selectedItemForDetail.dbUnit, selectedItemForDetail.nosPerKg);
                          const formatted = bQty === 0 ? '0' : bQty.toFixed(3).replace(/\.?0+$/, '');
                          const isZero = bQty === 0;

                          return (
                            <tr key={code} style={{ borderBottom: '1px solid var(--color-gray-100)' }}>
                              <td style={{ padding: '6px 0', fontWeight: 600, color: 'var(--color-gray-800)' }}>{code}</td>
                              <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: isZero ? 'normal' : 'bold', color: isZero ? 'var(--color-gray-400)' : 'var(--color-success-700)' }}>
                                {formatted}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
