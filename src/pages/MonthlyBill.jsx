import React, { useEffect, useState, useMemo } from 'react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import Button from '../components/ui/Button';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';
import { ROLES, ALS_GROUPS } from '../lib/constants';
import { generateMonthlyBillPdf, billingUnitLabel } from '../lib/pdfGenerator';
import { toBillingQty } from '../utils/units';
import toast from 'react-hot-toast';
import { FileText, Download, Calculator } from 'lucide-react';

export default function MonthlyBill() {
  const { role } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  
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
      const endDate = new Date(year, month, 0).toISOString().split('T')[0];

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
      const { data: logsData, error: logsErr } = await supabase
        .from('consumption_logs')
        .select('*, inventory_items(name, unit, rate_master(brand, unit_rate, nos_per_kg, tender_year)), stations(code)')
        .gte('consumption_date', startDate)
        .lte('consumption_date', endDate)
        .limit(5000);
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

  // Build aggregated table data
  const { tableData, totals } = useMemo(() => {
    const groupedItems = {};

    // Initialise every active master item
    allItems.forEach(item => {
      const tYearStr = item.rate_master?.tender_year || '';
      if (tYearStr.toLowerCase().includes('before 2024')) return;
      const startYear = parseInt(tYearStr.split('-')[0]) || 0;
      if (startYear > 0 && startYear < 2024) return; // Exclude < 2024

      const dbUnit   = item.unit || 'Nos';
      const nosPerKg = item.rate_master?.nos_per_kg || null;
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
      };
    });

    // Accumulate raw base-unit consumption
    consumptionLogs.forEach(log => {
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
        };
      }

      if      (ALS_GROUPS['ALVA-KLMT'].includes(stationCode)) groupedItems[itemId]['ALVA-KLMT'] += qty;
      else if (ALS_GROUPS['CCUV-JLSD'].includes(stationCode)) groupedItems[itemId]['CCUV-JLSD'] += qty;
      else if (ALS_GROUPS['KALR-KVTR'].includes(stationCode)) groupedItems[itemId]['KALR-KVTR'] += qty;
      else if (ALS_GROUPS['EMKM-TPHT'].includes(stationCode)) groupedItems[itemId]['EMKM-TPHT'] += qty;
    });

    let totalALVA = 0, totalCCUV = 0, totalKALR = 0, totalEMKM = 0, grandTotal = 0;

    const rows = Object.values(groupedItems).map((item, index) => {
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

      const fmt = (v) => v === 0 ? '0' : v.toFixed(3).replace(/\.?0+$/, '');

      return {
        id: item.id,
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
      };
    });

    return { 
      tableData: rows, 
      totals: {
        alva: totalALVA,
        ccuv: totalCCUV,
        kalr: totalKALR,
        emkm: totalEMKM,
        grand: grandTotal
      }
    };
  }, [allItems, consumptionLogs]);

  const columns = [
    { key: 'sl_no', label: 'Sl. No', width: 60, render: (v) => <span style={{ color: 'var(--color-gray-500)' }}>{v}</span> },
    { key: 'item_name', label: 'Cleaning Material', render: (v) => <strong>{v}</strong> },
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
        />
        
        <div style={{ overflowX: 'auto', padding: 'var(--space-4)', backgroundColor: 'var(--color-bg-subtle)' }}>
          <div style={{ minWidth: '1000px', backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
            <DataTable
              columns={columns}
              data={tableData}
              isLoading={isLoading}
              emptyTitle="No data found for this month"
            />
            {/* Totals Footer row matching the PDF */}
            {!isLoading && tableData.length > 0 && (
              <div style={{ 
                display: 'flex', 
                backgroundColor: 'var(--color-gray-100)', 
                borderTop: '2px solid var(--color-border)', 
                padding: '12px 16px',
                fontWeight: 'bold',
                fontSize: '13px'
              }}>
                <div style={{ flex: '1 1 auto', textAlign: 'center' }}>TOTAL</div>
                <div style={{ width: '90px', textAlign: 'center' }}>₹{totals.alva.toFixed(2)}</div>
                <div style={{ width: '90px', textAlign: 'center' }}>₹{totals.ccuv.toFixed(2)}</div>
                <div style={{ width: '90px', textAlign: 'center' }}>₹{totals.kalr.toFixed(2)}</div>
                <div style={{ width: '90px', textAlign: 'center' }}>₹{totals.emkm.toFixed(2)}</div>
                <div style={{ width: '80px', textAlign: 'center' }}></div>
                <div style={{ minWidth: '100px', textAlign: 'right' }}>₹{totals.grand.toFixed(2)}</div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Layout>
  );
}
