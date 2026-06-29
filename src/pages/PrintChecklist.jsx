import React, { useEffect, useState, useRef } from 'react';
import { toDisplayValue, getDisplayUnit } from '../utils/units';
import { supabase } from '../lib/supabase';
import { useStationStore } from '../store/stationStore';
import SignatureCanvas from 'react-signature-canvas';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import toast from 'react-hot-toast';
import { CheckCircle2, Circle } from 'lucide-react';

export default function PrintChecklist() {
  const { selectedStation } = useStationStore();
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Form State
  const [verificationData, setVerificationData] = useState({});
  const [verifierName, setVerifierName] = useState('');
  const [empId, setEmpId] = useState('');
  const sigCanvas = useRef(null);

  const fetchData = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data: invData, error: invErr } = await supabase
        .from('v_station_inventory_summary')
        .select('item_id, item_name, category, unit, tender_year, brand_name, current_stock')
        .eq('station_id', selectedStation.id)
        .order('tender_year', { ascending: false, nullsFirst: false });

      if (invErr) throw invErr;

      let items = invData.filter(i => i.category === 'Chemical' || i.category === 'Consumable');
      const itemIds = items.map(i => i.item_id);

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

      finalData = finalData.filter(item => {
        const hasStock = Number(item.current_stock) > 0;
        const hasInUse = item.in_use > 0;
        const hasDamaged = item.partially_damaged > 0;
        const hasDisposed = item.disposed > 0;
        return hasStock || hasInUse || hasDamaged || hasDisposed;
      });

      setData(finalData);

      // Initialize verification state
      const initialVerif = {};
      finalData.forEach(item => {
        initialVerif[item.item_id] = { verified: false, remarks: '' };
      });
      setVerificationData(initialVerif);

    } catch (err) {
      console.error(err);
      setError('Failed to load data for verification.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedStation]);

  useEffect(() => {
    if (!selectedStation) {
      setTimeout(() => {
        setError('No station selected. Please go back and select a station first.');
        setIsLoading(false);
      }, 0);
      return;
    }
    fetchData();
  }, [selectedStation, fetchData]);

  const toggleVerify = (itemId) => {
    setVerificationData(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], verified: !prev[itemId].verified }
    }));
  };

  const handleRemarkChange = (itemId, val) => {
    setVerificationData(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], remarks: val }
    }));
  };

  const clearSignature = () => {
    if (sigCanvas.current) sigCanvas.current.clear();
  };

  const formatQty = (qty, unit) => {
    if (qty <= 0) return '';
    const u = unit || 'Nos';
    const disp = getDisplayUnit(u);
    const v = toDisplayValue(qty, u);
    return disp === 'Nos' ? `${Math.round(v)}` : `${v.toFixed(2)} ${disp}`;
  };

  const handleDownloadPdf = async () => {
    if (!verifierName.trim() || !empId.trim()) {
      toast.error('Please enter your Name and Employee ID');
      return;
    }
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      toast.error('Please draw your signature before submitting');
      return;
    }

    const unverifiedCount = Object.values(verificationData).filter(v => !v.verified).length;
    if (unverifiedCount > 0) {
      const confirm = window.confirm(`You have ${unverifiedCount} unverified items. Are you sure you want to submit?`);
      if (!confirm) return;
    }

    try {
      const doc = new jsPDF('landscape');
      const today = new Date().toLocaleDateString('en-GB');

      // Title
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('KOCHI METRO RAIL LIMITED', doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' });
      
      doc.setFontSize(12);
      doc.text('KMRL-O&M-OPC-FOR-150', doc.internal.pageSize.getWidth() - 15, 10, { align: 'right' });
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('Revision No: 01', doc.internal.pageSize.getWidth() - 15, 15, { align: 'right' });
      
      try {
        const response = await fetch('/kmrl_logo.png');
        const blob = await response.blob();
        const base64data = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        doc.addImage(base64data, 'PNG', 14, 5, 20, 20);
      } catch (err) {
        console.warn('Failed to load logo for PDF', err);
      }

      // Banner
      doc.setFillColor(0, 150, 136);
      doc.rect(14, 25, doc.internal.pageSize.getWidth() - 28, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('CHECK LIST - 07 : CHEMICALS AND CONSUMABLES', doc.internal.pageSize.getWidth() / 2, 31, { align: 'center' });

      // Station / Date
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Station: ${selectedStation.code}`, 15, 40);
      doc.text(`Date: ${today}`, doc.internal.pageSize.getWidth() - 15, 40, { align: 'right' });

      // Group Data by Tender Year
      const groupedData = {};
      data.forEach(item => {
        const year = item.tender_year || 'UNSPECIFIED TENDER';
        if (!groupedData[year]) groupedData[year] = [];
        groupedData[year].push(item);
      });
      const tenderYears = Object.keys(groupedData).sort((a, b) => b.localeCompare(a));

      const tableBody = [];
      tenderYears.forEach(year => {
        tableBody.push([{ content: `TENDER ${year}`, colSpan: 11, styles: { fillColor: [240, 240, 240], fontStyle: 'bold', halign: 'center' } }]);
        groupedData[year].forEach((item, index) => {
          const vData = verificationData[item.item_id] || {};
          const balance = Number(item.current_stock) || 0;
          tableBody.push([
            index + 1,
            item.item_name,
            item.brand_name || '',
            item.supplier || '',
            item.tender_year || '',
            formatQty(item.in_use, item.unit),
            formatQty(item.partially_damaged, item.unit),
            formatQty(item.disposed, item.unit),
            formatQty(balance, item.unit),
            vData.verified ? 'Yes' : 'No',
            vData.remarks || ''
          ]);
        });
      });

      doc.autoTable({
        startY: 45,
        head: [
          [
            { content: 'Sl.\nNo', rowSpan: 2 },
            { content: 'Cleaning Material', rowSpan: 2 },
            { content: 'Brand', rowSpan: 2 },
            { content: 'Supplier', rowSpan: 2 },
            { content: 'Tender\nYear', rowSpan: 2 },
            { content: 'Consumables', colSpan: 3, styles: { halign: 'center' } },
            { content: 'Balance Stock\n(Ltr / Kg / Nos)', rowSpan: 2 },
            { content: 'Verified', rowSpan: 2 },
            { content: 'Remarks', rowSpan: 2 }
          ],
          [
            'In Good condition\n(Currently in Use)',
            'Partially Damaged\nItems (Usable)',
            'Disposed Items\n(Non-usable)'
          ]
        ],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [0, 150, 136], textColor: 255, halign: 'center', valign: 'middle', fontSize: 8 },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          4: { cellWidth: 15, halign: 'center' },
          5: { cellWidth: 25, halign: 'center' },
          6: { cellWidth: 25, halign: 'center' },
          7: { cellWidth: 25, halign: 'center' },
          8: { cellWidth: 25, halign: 'center' },
          9: { cellWidth: 15, halign: 'center' },
        }
      });

      // Signature & Details Footer
      const tableFinalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : (doc.autoTable && doc.autoTable.previous ? doc.autoTable.previous.finalY : 120);
      const finalY = tableFinalY + 15;
      
      // If signature is pushed to next page, add a new page
      if (finalY > doc.internal.pageSize.getHeight() - 40) {
        doc.addPage();
      }

      const sigBase64 = sigCanvas.current.getCanvas().toDataURL('image/png');
      
      doc.setFont('helvetica', 'bold');
      doc.text('Verification Details:', 15, finalY);
      
      doc.setFont('helvetica', 'normal');
      doc.text(`Verified By (SC Name): ${verifierName}`, 15, finalY + 8);
      doc.text(`Employee ID: ${empId}`, 15, finalY + 16);
      doc.text('Signature:', 15, finalY + 24);
      
      doc.addImage(sigBase64, 'PNG', 35, finalY + 15, 40, 20);

      doc.save(`KMRL_Stock_Verification_${selectedStation.code}_${today.replace(/\//g, '-')}.pdf`);
      toast.success('Checklist generated successfully!');

    } catch (err) {
      console.error('PDF Generation Error:', err);
      toast.error('Failed to generate PDF: ' + (err.message || 'Unknown error'));
    }
  };

  if (isLoading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading verification data...</div>;
  if (error) return <div style={{ padding: '2rem', color: 'red', textAlign: 'center' }}>{error}</div>;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', background: '#f8f9fa', minHeight: '100vh', paddingBottom: '80px' }}>
      
      {/* App-like Header */}
      <div style={{ background: 'var(--color-primary-600)', color: 'white', padding: '1rem', position: 'sticky', top: 0, zIndex: 10 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Stock Verification</h2>
        <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>{selectedStation.code} - {selectedStation.name}</div>
      </div>

      <div style={{ padding: '1rem' }}>
        <p style={{ color: 'var(--color-gray-600)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          Please physically verify the following items at the station and check them off.
        </p>

        {/* Item Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {data.map((item, i) => {
            const vData = verificationData[item.item_id] || { verified: false, remarks: '' };
            const isVerified = vData.verified;

            return (
              <div 
                key={item.item_id} 
                style={{ 
                  background: 'white', 
                  borderRadius: '12px', 
                  padding: '1rem', 
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  border: isVerified ? '2px solid var(--color-success-500)' : '2px solid transparent',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div style={{ flex: 1, paddingRight: '1rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--color-gray-900)' }}>{item.item_name}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>{item.brand_name || 'No Brand'} • {item.supplier || 'No Supplier'}</div>
                  </div>
                  <button 
                    onClick={() => toggleVerify(item.item_id)}
                    style={{ 
                      background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem',
                      color: isVerified ? 'var(--color-success-600)' : 'var(--color-gray-300)'
                    }}
                  >
                    {isVerified ? <CheckCircle2 size={32} /> : <Circle size={32} />}
                  </button>
                </div>

                <div style={{ background: '#f8f9fa', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <div><span style={{ color: 'var(--color-gray-500)' }}>Balance Stock:</span> <strong style={{ color: 'var(--color-primary-600)' }}>{formatQty(item.current_stock, item.unit) || '0'}</strong></div>
                    {item.in_use > 0 && <div><span style={{ color: 'var(--color-gray-500)' }}>In Use:</span> <strong>{formatQty(item.in_use, item.unit)}</strong></div>}
                    {item.partially_damaged > 0 && <div><span style={{ color: 'var(--color-gray-500)' }}>Damaged:</span> <strong>{formatQty(item.partially_damaged, item.unit)}</strong></div>}
                    {item.disposed > 0 && <div><span style={{ color: 'var(--color-gray-500)' }}>Disposed:</span> <strong>{formatQty(item.disposed, item.unit)}</strong></div>}
                  </div>
                </div>

                <input
                  type="text"
                  placeholder="Add remarks (optional)..."
                  className="form-control"
                  style={{ width: '100%', fontSize: '0.9rem' }}
                  value={vData.remarks}
                  onChange={(e) => handleRemarkChange(item.item_id, e.target.value)}
                />
              </div>
            );
          })}
        </div>

        {/* Verification Form Footer */}
        <div style={{ marginTop: '2rem', background: 'white', borderRadius: '12px', padding: '1.25rem', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem' }}>Sign & Submit</h3>
          
          <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
            <div>
              <label className="form-label form-label-required">Verified By (Name)</label>
              <input type="text" className="form-control" value={verifierName} onChange={e => setVerifierName(e.target.value)} placeholder="Enter your full name" />
            </div>
            <div>
              <label className="form-label form-label-required">Employee ID</label>
              <input type="text" className="form-control" value={empId} onChange={e => setEmpId(e.target.value)} placeholder="Enter your ID" />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label className="form-label form-label-required" style={{ margin: 0 }}>Signature</label>
              <button onClick={clearSignature} style={{ background: 'none', border: 'none', color: 'var(--color-danger-600)', fontSize: '0.85rem', cursor: 'pointer', padding: 0 }}>Clear</button>
            </div>
            <div style={{ border: '2px dashed var(--color-gray-300)', borderRadius: '8px', background: '#fafafa', overflow: 'hidden' }}>
              <SignatureCanvas 
                ref={sigCanvas} 
                penColor="black"
                canvasProps={{ width: 500, height: 150, className: 'sigCanvas', style: { width: '100%', height: '150px' } }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Floating Action Button Bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white', padding: '1rem', borderTop: '1px solid var(--color-gray-200)', display: 'flex', gap: '1rem', zIndex: 100 }}>
        <button className="btn btn-outline" onClick={() => window.close()} style={{ flex: 1 }}>Cancel</button>
        <button className="btn btn-primary" onClick={handleDownloadPdf} style={{ flex: 2 }}>Submit & Download PDF</button>
      </div>

    </div>
  );
}
