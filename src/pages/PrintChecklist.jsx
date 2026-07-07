import React, { useEffect, useState, useRef } from 'react';
import { toDisplayValue, getDisplayUnit } from '../utils/units';
import { supabase } from '../lib/supabase';
import { useStationStore } from '../store/stationStore';
import SignatureCanvas from 'react-signature-canvas';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import toast from 'react-hot-toast';
import { CheckCircle2, Circle, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDate } from '../utils/dateHelpers';

export default function PrintChecklist() {
  const { selectedStation } = useStationStore();
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

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

      let items = invData.filter(i => i.category === 'Chemical' || i.category === 'Consumable' || i.category === 'Disposable');
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
      const today = formatDate(new Date());

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

  if (isLoading) return <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui' }}>Loading verification data...</div>;
  if (error) return <div style={{ padding: '2rem', color: 'red', textAlign: 'center' }}>{error}</div>;

  const displayData = data.filter(item =>
    !searchQuery || item.item_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const verifiedCount = Object.values(verificationData).filter(v => v.verified).length;

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', background: '#f0f4f3', minHeight: '100vh', paddingBottom: '76px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Sticky Header */}
      <div style={{ background: 'var(--color-primary-600)', color: 'white', padding: '0.6rem 1rem', position: 'sticky', top: 0, zIndex: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>Stock Verification</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>{selectedStation.code} — {selectedStation.name}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.7rem', opacity: 0.75 }}>Progress</div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{verifiedCount}/{data.length}</div>
          </div>
        </div>
      </div>

      {/* Sticky Search */}
      <div style={{ position: 'sticky', top: '46px', zIndex: 19, background: '#f0f4f3', padding: '0.5rem 0.75rem 0.35rem' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#888' }} />
          <input
            type="search"
            placeholder="Search items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '0.45rem 0.75rem 0.45rem 2rem', borderRadius: '20px', border: '1px solid #d0d7d5', fontSize: '0.85rem', background: 'white', boxSizing: 'border-box', outline: 'none' }}
          />
        </div>
      </div>

      <div style={{ padding: '0.35rem 0.75rem' }}>
        {/* Item Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {displayData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>No items match your search.</div>
          ) : displayData.map((item) => {
            const vData = verificationData[item.item_id] || { verified: false, remarks: '' };
            const isVerified = vData.verified;
            const showRemarksKey = `remarks_open_${item.item_id}`;

            return (
              <VerificationCard
                key={item.item_id}
                item={item}
                isVerified={isVerified}
                vData={vData}
                formatQty={formatQty}
                onToggle={() => toggleVerify(item.item_id)}
                onRemarkChange={(val) => handleRemarkChange(item.item_id, val)}
              />
            );
          })}
        </div>

        {/* Sign & Submit panel */}
        <div style={{ marginTop: '0.75rem', background: 'white', borderRadius: '10px', padding: '0.85rem', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.6rem', color: '#1a1a1a' }}>Sign & Submit</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.6rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#555', marginBottom: '3px' }}>Verified By *</label>
              <input type="text" style={{ width: '100%', padding: '0.35rem 0.5rem', border: '1px solid #d0d7d5', borderRadius: '6px', fontSize: '0.82rem', boxSizing: 'border-box' }}
                value={verifierName} onChange={e => setVerifierName(e.target.value)} placeholder="Full name" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: '#555', marginBottom: '3px' }}>Employee ID *</label>
              <input type="text" style={{ width: '100%', padding: '0.35rem 0.5rem', border: '1px solid #d0d7d5', borderRadius: '6px', fontSize: '0.82rem', boxSizing: 'border-box' }}
                value={empId} onChange={e => setEmpId(e.target.value)} placeholder="EMP-ID" />
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#555' }}>Signature *</label>
              <button onClick={clearSignature} style={{ background: 'none', border: 'none', color: 'var(--color-danger-600)', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}>Clear</button>
            </div>
            <div style={{ border: '1.5px dashed #b0bcba', borderRadius: '8px', background: '#fafafa', overflow: 'hidden' }}>
              <SignatureCanvas
                ref={sigCanvas}
                penColor="black"
                canvasProps={{ width: 500, height: 120, style: { width: '100%', height: '120px' } }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Bottom Bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white', padding: '0.6rem 0.75rem', borderTop: '1px solid #e0e7e5', display: 'flex', gap: '0.5rem', zIndex: 100, boxShadow: '0 -2px 12px rgba(0,0,0,0.1)' }}>
        <button className="btn btn-outline" onClick={() => window.close()} style={{ flex: 1, padding: '0.55rem', fontSize: '0.85rem' }}>Cancel</button>
        <button className="btn btn-primary" onClick={handleDownloadPdf} style={{ flex: 2, padding: '0.55rem', fontSize: '0.85rem', fontWeight: 600 }}>Submit & Download PDF</button>
      </div>
    </div>
  );
}

// ─── Compact verification card sub-component ─────────────────────────────────
function VerificationCard({ item, isVerified, vData, formatQty, onToggle, onRemarkChange }) {
  const [remarkOpen, setRemarkOpen] = useState(false);
  const balance = Number(item.current_stock) || 0;

  const badgeStyle = (color) => ({
    display: 'inline-flex', alignItems: 'center', gap: '2px',
    background: color, borderRadius: '4px',
    padding: '1px 6px', fontSize: '0.7rem', fontWeight: 600, color: 'white',
    whiteSpace: 'nowrap'
  });

  return (
    <div
      style={{
        background: 'white',
        borderRadius: '8px',
        padding: '0.55rem 0.65rem',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        border: isVerified ? '1.5px solid #00b894' : '1.5px solid transparent',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Top row: name + verify toggle */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1a1a1a', lineHeight: 1.25, marginBottom: '1px' }}>
            {item.item_name}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#888', lineHeight: 1.2 }}>
            {[item.brand_name, item.supplier].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button
          onClick={onToggle}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', flexShrink: 0, color: isVerified ? '#00b894' : '#ccc' }}
          aria-label={isVerified ? 'Verified' : 'Mark verified'}
        >
          {isVerified ? <CheckCircle2 size={24} /> : <Circle size={24} />}
        </button>
      </div>

      {/* Badge row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '0.35rem' }}>
        <span style={badgeStyle('#0082b0')}>Stock: {formatQty(balance, item.unit) || '0'}</span>
        {item.in_use > 0 && <span style={badgeStyle('#6c757d')}>In Use: {formatQty(item.in_use, item.unit)}</span>}
        {item.partially_damaged > 0 && <span style={badgeStyle('#e67e22')}>Damaged: {formatQty(item.partially_damaged, item.unit)}</span>}
        {item.disposed > 0 && <span style={badgeStyle('#c0392b')}>Disposed: {formatQty(item.disposed, item.unit)}</span>}
        <span style={{ ...badgeStyle(isVerified ? '#00b894' : '#aaa'), marginLeft: 'auto' }}>
          {isVerified ? '✓ Verified' : 'Pending'}
        </span>
      </div>

      {/* Collapsible remarks */}
      <div style={{ marginTop: '0.35rem' }}>
        {!remarkOpen && !vData.remarks ? (
          <button
            onClick={() => setRemarkOpen(true)}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.72rem', color: '#009688', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}
          >
            <ChevronDown size={12} /> Add Remarks
          </button>
        ) : (
          <div>
            <button
              onClick={() => setRemarkOpen(r => !r)}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.72rem', color: '#009688', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '3px' }}
            >
              {remarkOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {vData.remarks ? 'Edit Remarks' : 'Add Remarks'}
            </button>
            {(remarkOpen || vData.remarks) && (
              <input
                type="text"
                placeholder="Add remarks..."
                value={vData.remarks}
                onChange={(e) => onRemarkChange(e.target.value)}
                style={{ width: '100%', padding: '0.3rem 0.5rem', border: '1px solid #d0d7d5', borderRadius: '5px', fontSize: '0.8rem', boxSizing: 'border-box', background: '#fafafa' }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
