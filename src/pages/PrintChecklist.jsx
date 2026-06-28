import React, { useEffect, useState } from 'react';
import { toDisplayValue, getDisplayUnit } from '../utils/units';
import { supabase } from '../lib/supabase';
import { useStationStore } from '../store/stationStore';

export default function PrintChecklist() {
  const { selectedStation } = useStationStore();
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Add a specific class to the body to ensure layout padding is removed when printing
    document.body.classList.add('print-mode');
    return () => {
      document.body.classList.remove('print-mode');
    };
  }, []);



  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Fetch inventory items and balance stock
      const { data: invData, error: invErr } = await supabase
        .from('v_station_inventory_summary')
        .select('item_id, item_name, category, unit, tender_year, brand_name, current_stock')
        .eq('station_id', selectedStation.id)
        .order('tender_year', { ascending: false, nullsFirst: false });

      if (invErr) throw invErr;

      // Filter only for chemicals and consumables (actually all should be, but let's be safe)
      let items = invData.filter(i => i.category === 'Chemical' || i.category === 'Consumable');

      const itemIds = items.map(i => i.item_id);

      // 2. Fetch latest suppliers
      // Using a subquery approach or just fetching the raw table and grouping
      const { data: stockData, error: stockErr } = await supabase
        .from('stock_received')
        .select('item_id, supplier, received_date')
        .eq('station_id', selectedStation.id)
        .in('item_id', itemIds)
        .order('received_date', { ascending: false });

      if (stockErr) throw stockErr;

      const supplierMap = {};
      (stockData || []).forEach(row => {
        if (!supplierMap[row.item_id] && row.supplier) {
          supplierMap[row.item_id] = row.supplier;
        }
      });

      // 3. Fetch asset lifecycle stats
      const { data: assetData, error: assetErr } = await supabase
        .from('station_inventory')
        .select('item_id, quantity_in_use, quantity_damaged, quantity_disposed')
        .eq('station_id', selectedStation.id)
        .in('item_id', itemIds);

      if (assetErr) throw assetErr;

      const assetMap = {};
      (assetData || []).forEach(row => {
        assetMap[row.item_id] = { 
          in_use: Number(row.quantity_in_use || 0), 
          partially_damaged: Number(row.quantity_damaged || 0), 
          disposed: Number(row.quantity_disposed || 0) 
        };
      });

      // 4. Combine and Filter
      let finalData = items.map(item => {
        const assets = assetMap[item.item_id] || { in_use: 0, partially_damaged: 0, disposed: 0 };
        return {
          ...item,
          supplier: supplierMap[item.item_id] || '',
          in_use: assets.in_use,
          partially_damaged: assets.partially_damaged,
          disposed: assets.disposed,
        };
      });

      // 5. User Rule: Neglect all inventory items who have no entry in any of the 4 type stock
      finalData = finalData.filter(item => {
        const hasStock = Number(item.current_stock) > 0;
        const hasInUse = item.in_use > 0;
        const hasDamaged = item.partially_damaged > 0;
        const hasDisposed = item.disposed > 0;
        return hasStock || hasInUse || hasDamaged || hasDisposed;
      });

      setData(finalData);

    } catch (err) {
      console.error(err);
      setError('Failed to load data for print view.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedStation]);

  useEffect(() => {
    if (!selectedStation) {
      // Avoid calling setState synchronously in effect, use setTimeout
      setTimeout(() => {
        setError('No station selected. Please go back and select a station first.');
        setIsLoading(false);
      }, 0);
      return;
    }
    fetchData();
  }, [selectedStation, fetchData]);

  if (isLoading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading print view...</div>;
  }

  if (error) {
    return <div style={{ padding: '2rem', color: 'red' }}>{error}</div>;
  }

  // Group by tender year
  const groupedData = {};
  data.forEach(item => {
    const year = item.tender_year || 'UNSPECIFIED TENDER';
    if (!groupedData[year]) groupedData[year] = [];
    groupedData[year].push(item);
  });

  const tenderYears = Object.keys(groupedData).sort((a, b) => b.localeCompare(a)); // Descending

  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="print-container">
      {/* Header */}
      <div className="print-header">
        <div className="print-logo-section">
          <img src="/kmrl_logo.png" alt="KMRL Logo" className="print-logo" />
        </div>
        <div className="print-title-section">
          <div className="print-station-info">
            <span style={{ fontWeight: 'bold' }}>Station :</span> {selectedStation?.code}
            <br />
            <span style={{ fontWeight: 'bold' }}>Date :</span> {today.replace(/ /g, '-')}
          </div>
          <h1 className="print-main-title">CHECK LIST - 07 : CHEMICALS AND CONSUMABLES</h1>
        </div>
      </div>

      {/* Table */}
      <table className="print-table">
        <thead>
          <tr>
            <th rowSpan="2" style={{ width: '40px' }}>Sl. No</th>
            <th rowSpan="2">Cleaning Material</th>
            <th rowSpan="2">Brand</th>
            <th rowSpan="2">Supplier</th>
            <th rowSpan="2" style={{ width: '80px' }}>Tender Year</th>
            <th colSpan="3" style={{ textAlign: 'center' }}>Consumables</th>
            <th rowSpan="2" style={{ width: '80px' }}>Balance Stock (Ltr / Kg / Nos)</th>
            <th rowSpan="2" style={{ width: '60px' }}>Verified</th>
            <th rowSpan="2" style={{ width: '150px' }}>Remarks</th>
          </tr>
          <tr>
            <th style={{ width: '80px' }}>In Good condition (Currently in Use)</th>
            <th style={{ width: '80px' }}>Partially Damaged Items (Usable)</th>
            <th style={{ width: '80px' }}>Disposed Items available at station (Non-usable)</th>
          </tr>
        </thead>
        <tbody>
          {tenderYears.map(year => (
            <React.Fragment key={year}>
              {/* Tender Year Subheader Row */}
              <tr className="tender-header-row">
                <td></td>
                <td colSpan="10" className="tender-header-text">
                  TENDER {year}
                </td>
              </tr>
              {/* Items for this year */}
              {groupedData[year].map((item, index) => (
                <tr key={item.item_id}>
                  <td style={{ textAlign: 'center' }}>{index + 1}</td>
                  <td>{item.item_name}</td>
                  <td>{item.brand_name}</td>
                  <td>{item.supplier}</td>
                  <td style={{ textAlign: 'center' }}>{item.tender_year}</td>
                  {/* Lifecycle columns: convert base units to display units */}
                  {['in_use', 'partially_damaged', 'disposed'].map(field => (
                    <td key={field} style={{ textAlign: 'center' }}>
                      {item[field] > 0 ? (() => {
                        const u = item.unit || 'Nos';
                        const disp = getDisplayUnit(u);
                        const v = toDisplayValue(item[field], u);
                        return disp === 'Nos' ? Math.round(v) : `${v.toFixed(2)} ${disp}`;
                      })() : ''}
                    </td>
                  ))}
                  {/* Balance stock column */}
                  <td style={{ textAlign: 'center' }}>{(() => {
                    const u = item.unit || 'Nos';
                    const disp = getDisplayUnit(u);
                    const v = toDisplayValue(Number(item.current_stock) || 0, u);
                    return disp === 'Nos' ? `${Math.round(v)} Nos` : `${v.toFixed(2)} ${disp}`;
                  })()}</td>
                  <td style={{ textAlign: 'center' }}>
                    <div className="print-checkbox"></div>
                  </td>
                  <td></td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      {/* Footer */}
      <div className="print-footer">
        <div className="signature-block">
          <div>Verified By (SC Name): ______________________</div>
          <div>Employee ID: ______________________</div>
          <div>Signature: ______________________</div>
        </div>
      </div>

      <div className="print-action-bar no-print">
        <button onClick={() => window.print()} className="btn btn-primary" style={{ marginRight: '1rem' }}>
          Print Checklist
        </button>
        <button onClick={() => window.close()} className="btn btn-outline">
          Close Window
        </button>
      </div>
    </div>
  );
}
