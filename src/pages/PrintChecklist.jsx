import React, { useEffect, useState, useRef, useCallback } from 'react';
import { toDisplayValue, getDisplayUnit } from '../utils/units';
import { supabase } from '../lib/supabase';
import { useStationStore } from '../store/stationStore';
import SignatureCanvas from 'react-signature-canvas';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import toast from 'react-hot-toast';
import {
  CheckCircle2, Circle, Search, ChevronDown, ChevronUp,
  Save, ChevronRight, ChevronLeft, Package, Wrench, AlertTriangle, Trash2,
} from 'lucide-react';
import { formatDate, getVerificationPeriodInfo } from '../utils/dateHelpers';

// ── Stage configuration ───────────────────────────────────────────────────────
const STAGES = [
  { id: 1, key: 's1', label: 'Available Stock',   short: 'Stock',   field: 'current_stock',    color: '#0082b0', lightBg: '#e8f4fd', Icon: Package                        },
  { id: 2, key: 's2', label: 'Items In Use',       short: 'In Use',  field: 'in_use',           color: '#5c6bc0', lightBg: '#ede7f6', Icon: Wrench,       consumableOnly: true },
  { id: 3, key: 's3', label: 'Partially Damaged',  short: 'Damaged', field: 'partially_damaged', color: '#e67e22', lightBg: '#fff3e0', Icon: AlertTriangle, consumableOnly: true },
  { id: 4, key: 's4', label: 'Disposed',           short: 'Disposed',field: 'disposed',          color: '#c0392b', lightBg: '#ffebee', Icon: Trash2,       consumableOnly: true },
];

function fmtQty(qty, unit) {
  if (!qty || qty <= 0) return '0';
  const u    = unit || 'Nos';
  const disp = getDisplayUnit(u);
  const v    = toDisplayValue(qty, u);
  return disp === 'Nos' ? `${Math.round(v)} Nos` : `${v.toFixed(2)} ${disp}`;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PrintChecklist() {
  const { selectedStation } = useStationStore();
  const [data, setData]             = useState([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [error, setError]           = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentStage, setCurrentStage] = useState(1);

  // { [itemId]: { s1:{verified,remark}, s2:{…}, s3:{…}, s4:{…} } }
  const [verificationData, setVerificationData] = useState({});
  const [verifierName, setVerifierName] = useState('');
  const [empId, setEmpId]           = useState('');
  const [draftId, setDraftId]       = useState(null);
  const [resumeBanner, setResumeBanner] = useState(null);
  const [isSaving, setIsSaving]     = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sigCanvas  = useRef(null);
  const autoTimer  = useRef(null);
  const saveFnRef  = useRef(null);           // stable ref for auto-save
  const periodInfo = getVerificationPeriodInfo(new Date());

  // ── Fetch inventory data (identical logic to original) ────────────────────
  const fetchData = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      const { data: invData, error: invErr } = await supabase
        .from('v_station_inventory_summary')
        .select('item_id, item_name, category, unit, tender_year, brand_name, current_stock')
        .eq('station_id', selectedStation.id)
        .order('tender_year', { ascending: false, nullsFirst: false });
      if (invErr) throw invErr;

      let items = invData.filter(i =>
        i.category === 'Chemical' || i.category === 'Consumable' || i.category === 'Disposable'
      );
      const itemIds = items.map(i => i.item_id);

      const [{ data: stockData }, { data: assetData }] = await Promise.all([
        supabase.from('stock_received')
          .select('item_id, supplier, received_date')
          .eq('station_id', selectedStation.id)
          .in('item_id', itemIds)
          .order('received_date', { ascending: false }),
        supabase.from('station_inventory')
          .select('item_id, quantity_in_use, quantity_damaged, quantity_disposed')
          .eq('station_id', selectedStation.id)
          .in('item_id', itemIds),
      ]);

      const supplierMap = {};
      (stockData || []).forEach(r => { if (!supplierMap[r.item_id] && r.supplier) supplierMap[r.item_id] = r.supplier; });

      const assetMap = {};
      (assetData || []).forEach(r => {
        assetMap[r.item_id] = {
          in_use:            Number(r.quantity_in_use   || 0),
          partially_damaged: Number(r.quantity_damaged  || 0),
          disposed:          Number(r.quantity_disposed || 0),
        };
      });

      let finalData = items.map(item => ({
        ...item,
        supplier:          supplierMap[item.item_id] || '',
        in_use:            assetMap[item.item_id]?.in_use            || 0,
        partially_damaged: assetMap[item.item_id]?.partially_damaged || 0,
        disposed:          assetMap[item.item_id]?.disposed          || 0,
      })).filter(item =>
        Number(item.current_stock) > 0 ||
        item.in_use > 0 ||
        item.partially_damaged > 0 ||
        item.disposed > 0
      );

      finalData.sort((a, b) => {
        const aS = Number(a.current_stock) > 0 ? 1 : 0;
        const bS = Number(b.current_stock) > 0 ? 1 : 0;
        if (aS !== bS) return bS - aS;
        return a.item_name.localeCompare(b.item_name);
      });

      setData(finalData);

      // Initialise per-item per-stage verification state
      const init = {};
      finalData.forEach(item => {
        init[item.item_id] = {
          s1: { verified: false, remark: '' },
          s2: { verified: false, remark: '' },
          s3: { verified: false, remark: '' },
          s4: { verified: false, remark: '' },
        };
      });
      setVerificationData(init);
    } catch (err) {
      console.error(err);
      setError('Failed to load data for verification.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedStation]);

  // ── Check for existing draft ──────────────────────────────────────────────
  const checkDraft = useCallback(async () => {
    if (!selectedStation) return;
    const { data: draft } = await supabase
      .from('verification_drafts')
      .select('*')
      .eq('station_id', selectedStation.id)
      .eq('verification_period', periodInfo.period)
      .maybeSingle();
    if (draft) setResumeBanner(draft);
  }, [selectedStation, periodInfo.period]);

  useEffect(() => {
    if (!selectedStation) { setError('No station selected.'); setIsLoading(false); return; }
    Promise.all([fetchData(), checkDraft()]);
  }, [selectedStation, fetchData, checkDraft]);

  // ── Resume draft ──────────────────────────────────────────────────────────
  const resumeDraft = (draft) => {
    setDraftId(draft.id);
    setCurrentStage(draft.current_stage || 1);
    setVerifierName(draft.verifier_name || '');
    setEmpId(draft.emp_id || '');
    if (draft.draft_data?.items) {
      setVerificationData(prev => {
        const merged = { ...prev };
        Object.entries(draft.draft_data.items).forEach(([iid, sd]) => {
          if (merged[iid]) merged[iid] = { ...merged[iid], ...sd };
        });
        return merged;
      });
    }
    setResumeBanner(null);
    toast.success('Draft resumed!');
  };

  const startFresh = async () => {
    if (resumeBanner?.id) await supabase.from('verification_drafts').delete().eq('id', resumeBanner.id);
    setResumeBanner(null); setDraftId(null);
  };

  // ── Save draft ────────────────────────────────────────────────────────────
  const saveDraft = useCallback(async (stageOverride, silent = false) => {
    if (!selectedStation || isSubmitting) return;
    setIsSaving(true);
    try {
      const payload = {
        station_id:          selectedStation.id,
        verification_period: periodInfo.period,
        current_stage:       stageOverride ?? currentStage,
        draft_data:          { items: verificationData },
        verifier_name:       verifierName || null,
        emp_id:              empId       || null,
        updated_at:          new Date().toISOString(),
      };
      const { data: saved } = await supabase
        .from('verification_drafts')
        .upsert(payload, { onConflict: 'station_id,verification_period' })
        .select('id').single();
      if (saved?.id) setDraftId(saved.id);
      if (!silent) toast.success('Draft saved!', { duration: 1500 });
    } catch {
      if (!silent) toast.error('Failed to save draft');
    } finally {
      setIsSaving(false);
    }
  }, [selectedStation, periodInfo.period, currentStage, verificationData, verifierName, empId, isSubmitting]);

  // Keep a stable ref so the auto-save interval always calls the latest version
  useEffect(() => { saveFnRef.current = saveDraft; }, [saveDraft]);

  // Auto-save every 30 seconds (set up once)
  useEffect(() => {
    autoTimer.current = setInterval(() => saveFnRef.current?.(undefined, true), 30000);
    return () => clearInterval(autoTimer.current);
  }, []);

  // ── Stage helpers ─────────────────────────────────────────────────────────
  const getStageItems = useCallback((stageId) => {
    const stage = STAGES.find(s => s.id === stageId);
    if (!stage) return [];
    return data.filter(item => {
      if (stage.consumableOnly && item.category !== 'Consumable') return false;
      return Number(item[stage.field] || 0) > 0;
    });
  }, [data]);

  const getStageProgress = useCallback((stageId) => {
    const sk    = STAGES.find(s => s.id === stageId)?.key;
    const items = getStageItems(stageId);
    const done  = items.filter(i => verificationData[i.item_id]?.[sk]?.verified).length;
    return { verified: done, total: items.length };
  }, [getStageItems, verificationData]);

  const allStagesComplete = STAGES.every(s => {
    const { verified, total } = getStageProgress(s.id);
    return total === 0 || verified === total;
  });

  // ── Toggle / remark ───────────────────────────────────────────────────────
  const toggleVerify = (itemId, sk) => {
    setVerificationData(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], [sk]: { ...prev[itemId]?.[sk], verified: !prev[itemId]?.[sk]?.verified } },
    }));
  };

  const setRemark = (itemId, sk, val) => {
    setVerificationData(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], [sk]: { ...prev[itemId]?.[sk], remark: val } },
    }));
  };

  // ── Navigate between stages ───────────────────────────────────────────────
  const goToStage = async (n) => {
    await saveDraft(n, true);
    setCurrentStage(n);
    setSearchQuery('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── PDF generation (identical output to original) ─────────────────────────
  const handleDownloadPdf = async () => {
    if (!verifierName.trim() || !empId.trim()) {
      toast.error('Please enter your Name and Employee ID'); return;
    }
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      toast.error('Please draw your signature before submitting'); return;
    }

    // Count items that appear in at least one stage but are unverified in that stage
    const unverifiedCount = data.filter(item => {
      return STAGES.some(s => {
        const si = getStageItems(s.id);
        if (!si.find(i => i.item_id === item.item_id)) return false;
        return !verificationData[item.item_id]?.[s.key]?.verified;
      });
    }).length;

    if (unverifiedCount > 0) {
      const ok = window.confirm(`${unverifiedCount} item(s) are not fully verified. Submit anyway?`);
      if (!ok) return;
    }

    setIsSubmitting(true);
    try {
      const doc   = new jsPDF('landscape');
      const today = formatDate(new Date());

      // Title
      doc.setFontSize(18); doc.setFont('helvetica', 'bold');
      doc.text('KOCHI METRO RAIL LIMITED', doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' });
      doc.setFontSize(12);
      doc.text('KMRL-O&M-OPC-FOR-150', doc.internal.pageSize.getWidth() - 15, 10, { align: 'right' });
      doc.setFontSize(10); doc.setFont('helvetica', 'normal');
      doc.text('Revision No: 01', doc.internal.pageSize.getWidth() - 15, 15, { align: 'right' });

      // Logo
      await new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const cv = document.createElement('canvas');
            cv.width = img.naturalWidth; cv.height = img.naturalHeight;
            const ctx = cv.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.drawImage(img, 0, 0);
            doc.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 14, 5, 22, 22);
          } catch (_) {}
          resolve();
        };
        img.onerror = () => resolve();
        img.src = '/kmrl_logo.png';
      });

      // Banner
      doc.setFillColor(0, 150, 136);
      doc.rect(14, 25, doc.internal.pageSize.getWidth() - 28, 8, 'F');
      doc.setTextColor(255, 255, 255); doc.setFontSize(14); doc.setFont('helvetica', 'bold');
      doc.text('CHECK LIST - 07 : CHEMICALS AND CONSUMABLES', doc.internal.pageSize.getWidth() / 2, 31, { align: 'center' });

      doc.setTextColor(0, 0, 0); doc.setFontSize(10); doc.setFont('helvetica', 'normal');
      doc.text(`Station: ${selectedStation.code}`, 15, 40);
      doc.text(`Date: ${today}`, doc.internal.pageSize.getWidth() - 15, 40, { align: 'right' });

      // Group by tender year
      const grouped = {};
      data.forEach(item => {
        const yr = item.tender_year || 'UNSPECIFIED TENDER';
        if (!grouped[yr]) grouped[yr] = [];
        grouped[yr].push(item);
      });
      const tenderYears = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

      const tableBody = [];
      tenderYears.forEach(yr => {
        tableBody.push([{ content: `TENDER ${yr}`, colSpan: 11, styles: { fillColor: [240, 240, 240], fontStyle: 'bold', halign: 'center' } }]);
        grouped[yr].forEach((item, idx) => {
          const vd        = verificationData[item.item_id] || {};
          const balance   = Number(item.current_stock) || 0;
          const allVerif  = STAGES.every(s => {
            const si = getStageItems(s.id);
            if (!si.find(i => i.item_id === item.item_id)) return true;
            return vd[s.key]?.verified;
          });
          const remarks = STAGES.map(s => vd[s.key]?.remark).filter(Boolean).join('; ');
          const fmt = (qty) => fmtQty(qty, item.unit).replace(/ Nos$/, '');
          tableBody.push([
            idx + 1, item.item_name, item.brand_name || '', item.supplier || '', item.tender_year || '',
            item.category === 'Consumable' ? fmt(item.in_use)            : '—',
            item.category === 'Consumable' ? fmt(item.partially_damaged) : '—',
            item.category === 'Consumable' ? fmt(item.disposed)          : '—',
            fmt(balance), allVerif ? 'Yes' : 'No', remarks,
          ]);
        });
      });

      doc.autoTable({
        startY: 45,
        head: [
          [
            { content: 'Sl.\nNo', rowSpan: 2 }, { content: 'Cleaning Material', rowSpan: 2 },
            { content: 'Brand', rowSpan: 2 },   { content: 'Supplier', rowSpan: 2 },
            { content: 'Tender\nYear', rowSpan: 2 },
            { content: 'Consumables', colSpan: 3, styles: { halign: 'center' } },
            { content: 'Balance Stock\n(Ltr / Kg / Nos)', rowSpan: 2 },
            { content: 'Verified', rowSpan: 2 }, { content: 'Remarks', rowSpan: 2 },
          ],
          ['In Good condition\n(Currently in Use)', 'Partially Damaged\nItems (Usable)', 'Disposed Items\n(Non-usable)'],
        ],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [0, 150, 136], textColor: 255, halign: 'center', valign: 'middle', fontSize: 8 },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' }, 4: { cellWidth: 15, halign: 'center' },
          5: { cellWidth: 25, halign: 'center' }, 6: { cellWidth: 25, halign: 'center' },
          7: { cellWidth: 25, halign: 'center' }, 8: { cellWidth: 25, halign: 'center' },
          9: { cellWidth: 15, halign: 'center' },
        },
      });

      // Signature section
      const finalY = (doc.lastAutoTable?.finalY ?? 120) + 15;
      if (finalY > doc.internal.pageSize.getHeight() - 40) doc.addPage();

      const sigBase64 = sigCanvas.current.getCanvas().toDataURL('image/png');
      doc.setFont('helvetica', 'bold');  doc.text('Verification Details:', 15, finalY);
      doc.setFont('helvetica', 'normal');
      doc.text(`Verified By (SC Name): ${verifierName}`, 15, finalY + 8);
      doc.text(`Employee ID: ${empId}`, 15, finalY + 16);
      doc.text('Signature:', 15, finalY + 24);
      doc.addImage(sigBase64, 'PNG', 35, finalY + 15, 40, 20);

      doc.save(`KMRL_Stock_Verification_${selectedStation.code}_${today.replace(/\//g, '-')}.pdf`);
      toast.success('Checklist generated successfully!');

      // Record completion
      const { error: dbErr } = await supabase.from('stock_verifications').insert({
        station_id:          selectedStation.id,
        verifier_name:       verifierName.trim(),
        emp_id:              empId.trim(),
        verification_month:  periodInfo.month,
        verification_period: periodInfo.period,
      });
      if (dbErr) toast.error('PDF saved but failed to log in database.');
      else toast.success('Verification recorded!');

      // Delete draft after successful submission
      if (draftId) {
        await supabase.from('verification_drafts').delete().eq('id', draftId);
        setDraftId(null);
      }
    } catch (err) {
      console.error('PDF Error:', err);
      toast.error('Failed to generate PDF: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'system-ui' }}>
      <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⏳</div>
      Loading verification data…
    </div>
  );
  if (error) return (
    <div style={{ padding: '2rem', color: '#e74c3c', textAlign: 'center', fontFamily: 'system-ui' }}>{error}</div>
  );

  const stage      = STAGES.find(s => s.id === currentStage);
  const stageItems = getStageItems(currentStage);
  const stageKey   = stage.key;
  const { verified: stageVerified, total: stageTotal } = getStageProgress(currentStage);
  const stagePct   = stageTotal > 0 ? Math.round((stageVerified / stageTotal) * 100) : 100;
  const isLastStage = currentStage === 4;

  const displayItems = stageItems.filter(item =>
    !searchQuery || item.item_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', background: '#f0f4f3', minHeight: '100vh', paddingBottom: '80px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Sticky Header + Stage Pills ── */}
      <div style={{ background: 'var(--color-primary-600)', color: 'white', padding: '0.65rem 1rem 0', position: 'sticky', top: 0, zIndex: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.2 }}>Stock Verification</div>
            <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>{selectedStation.code} — {selectedStation.name}</div>
          </div>
          {draftId && (
            <span style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.2)', borderRadius: '12px', padding: '2px 8px', whiteSpace: 'nowrap' }}>
              {isSaving ? 'Saving…' : '✓ Draft saved'}
            </span>
          )}
        </div>

        {/* Stage pill navigator */}
        <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '0.55rem', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {STAGES.map(s => {
            const { verified, total } = getStageProgress(s.id);
            const complete = total > 0 && verified === total;
            const active   = s.id === currentStage;
            return (
              <button
                key={s.id}
                onClick={() => goToStage(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '4px 10px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                  background: active ? 'white' : complete ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)',
                  color: active ? s.color : 'white',
                  fontWeight: active ? 700 : 500, fontSize: '0.72rem',
                  whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.2s',
                }}
              >
                {complete && <span>✓</span>}
                <span>{s.id}. {s.short}</span>
                {total > 0 && <span style={{ opacity: 0.75, fontSize: '0.65rem' }}>{verified}/{total}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Resume Banner ── */}
      {resumeBanner && (
        <div style={{ background: '#fff8e1', borderBottom: '2px solid #ffc107', padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.82rem', color: '#795548' }}>
            <strong>Draft found</strong> — you were on Stage {resumeBanner.current_stage}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
            <button onClick={startFresh} style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #bbb', background: 'white', fontSize: '0.75rem', cursor: 'pointer' }}>
              Start Fresh
            </button>
            <button onClick={() => resumeDraft(resumeBanner)} style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: '#ffc107', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', color: '#333' }}>
              Resume ›
            </button>
          </div>
        </div>
      )}

      {/* ── Stage Title + Progress Bar ── */}
      <div style={{ padding: '0.6rem 0.75rem 0.35rem', background: stage.lightBg, borderBottom: `3px solid ${stage.color}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <stage.Icon size={17} color={stage.color} />
            <span style={{ fontWeight: 700, fontSize: '0.92rem', color: stage.color }}>Stage {currentStage}: {stage.label}</span>
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: stage.color }}>
            {stageTotal === 0 ? 'N/A' : `${stageVerified} / ${stageTotal}`}
          </span>
        </div>
        <div style={{ marginTop: '0.4rem', height: '5px', background: 'rgba(0,0,0,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${stagePct}%`, background: stage.color, borderRadius: '3px', transition: 'width 0.3s ease' }} />
        </div>
      </div>

      {/* ── Search ── */}
      <div style={{ padding: '0.4rem 0.75rem 0.25rem', background: '#f0f4f3' }}>
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: '#888' }} />
          <input
            type="search"
            placeholder={`Search Stage ${currentStage} items…`}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '0.4rem 0.75rem 0.4rem 1.8rem', borderRadius: '20px', border: '1px solid #d0d7d5', fontSize: '0.82rem', background: 'white', boxSizing: 'border-box', outline: 'none' }}
          />
        </div>
      </div>

      {/* ── Item Cards ── */}
      <div style={{ padding: '0.3rem 0.75rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {stageTotal === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', background: 'white', borderRadius: '10px', marginTop: '0.5rem', color: '#888' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✓</div>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>No items for this stage</div>
              <div style={{ fontSize: '0.8rem' }}>All quantities are zero — tap <strong>Next Stage</strong> to continue.</div>
            </div>
          ) : displayItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>No items match your search.</div>
          ) : displayItems.map(item => {
            const vd  = verificationData[item.item_id]?.[stageKey] || { verified: false, remark: '' };
            const qty = Number(item[stage.field] || 0);
            return (
              <StageCard
                key={item.item_id}
                item={item} stage={stage} qty={qty}
                isVerified={vd.verified} remark={vd.remark}
                onToggle={() => toggleVerify(item.item_id, stageKey)}
                onRemarkChange={val => setRemark(item.item_id, stageKey, val)}
              />
            );
          })}
        </div>

        {/* ── Overall Progress (collapsible) ── */}
        <OverallProgress stages={STAGES} getProgress={getStageProgress} />

        {/* ── Sign & Submit — Stage 4 only ── */}
        {isLastStage && (
          <div style={{ marginTop: '0.75rem', background: 'white', borderRadius: '10px', padding: '0.85rem', boxShadow: '0 1px 6px rgba(0,0,0,0.07)' }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.6rem', color: '#1a1a1a' }}>Sign &amp; Submit</div>
            {!allStagesComplete && (
              <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#856404', marginBottom: '0.6rem' }}>
                ⚠ Some stages are not fully verified. Unverified items will show "No" in the PDF.
              </div>
            )}
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
                <button onClick={() => sigCanvas.current?.clear()} style={{ background: 'none', border: 'none', color: '#e74c3c', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}>Clear</button>
              </div>
              <div style={{ border: '1.5px dashed #b0bcba', borderRadius: '8px', background: '#fafafa', overflow: 'hidden' }}>
                <SignatureCanvas ref={sigCanvas} penColor="black"
                  canvasProps={{ width: 500, height: 120, style: { width: '100%', height: '120px' } }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky Bottom Footer ── */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white', padding: '0.6rem 0.75rem', borderTop: '1px solid #e0e7e5', display: 'flex', gap: '0.4rem', zIndex: 100, boxShadow: '0 -2px 12px rgba(0,0,0,0.1)' }}>
        {/* Save Draft */}
        <button
          onClick={() => saveDraft(undefined, false)}
          disabled={isSaving}
          title="Save progress"
          style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0.5rem 0.65rem', borderRadius: '8px', border: '1px solid #d0d7d5', background: 'white', fontSize: '0.78rem', cursor: 'pointer', color: '#555', flexShrink: 0 }}
        >
          <Save size={14} />
          <span style={{ display: window.innerWidth < 360 ? 'none' : 'inline' }}>{isSaving ? 'Saving…' : 'Save'}</span>
        </button>

        {/* Back */}
        {currentStage > 1 && (
          <button
            onClick={() => goToStage(currentStage - 1)}
            style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '0.5rem 0.65rem', borderRadius: '8px', border: '1px solid #d0d7d5', background: 'white', fontSize: '0.8rem', cursor: 'pointer', color: '#555', flexShrink: 0 }}
          >
            <ChevronLeft size={15} /> Back
          </button>
        )}

        {/* Next Stage / Submit */}
        {!isLastStage ? (
          <button
            onClick={() => goToStage(currentStage + 1)}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', padding: '0.5rem', borderRadius: '8px', border: 'none', background: stage.color, color: 'white', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}
          >
            Next Stage — {STAGES[currentStage]?.short} <ChevronRight size={16} />
          </button>
        ) : (
          <button
            onClick={handleDownloadPdf}
            disabled={isSubmitting}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', padding: '0.5rem', borderRadius: '8px', border: 'none', background: allStagesComplete ? '#00b894' : '#e67e22', color: 'white', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}
          >
            {isSubmitting ? 'Generating PDF…' : <><CheckCircle2 size={16} /> Submit &amp; Download PDF</>}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Stage Item Card ────────────────────────────────────────────────────────────
function StageCard({ item, stage, qty, isVerified, remark, onToggle, onRemarkChange }) {
  const [remarkOpen, setRemarkOpen] = useState(false);

  return (
    <div style={{
      background: 'white', borderRadius: '8px', padding: '0.55rem 0.65rem',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      border: isVerified ? `1.5px solid ${stage.color}` : '1.5px solid transparent',
      transition: 'border-color 0.15s',
    }}>
      {/* Item name + checkbox */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1a1a1a', lineHeight: 1.25, marginBottom: '1px' }}>
            {item.item_name}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#888' }}>
            {[item.brand_name, item.supplier, item.tender_year ? `Tender: ${item.tender_year}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', flexShrink: 0, color: isVerified ? stage.color : '#ccc' }}>
          {isVerified ? <CheckCircle2 size={24} /> : <Circle size={24} />}
        </button>
      </div>

      {/* Only this stage's quantity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '0.35rem', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: stage.lightBg, borderRadius: '5px', padding: '3px 9px', fontSize: '0.8rem', fontWeight: 600, color: stage.color }}>
          {stage.label}: {fmtQty(qty, item.unit)}
        </span>
        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: isVerified ? stage.color : '#aaa', display: 'flex', alignItems: 'center', gap: '3px', marginLeft: 'auto' }}>
          {isVerified ? <><CheckCircle2 size={11} /> Verified</> : 'Pending'}
        </span>
      </div>

      {/* Collapsible remark */}
      <div style={{ marginTop: '0.3rem' }}>
        {!remarkOpen && !remark ? (
          <button onClick={() => setRemarkOpen(true)} style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.72rem', color: '#009688', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <ChevronDown size={12} /> Add Remarks
          </button>
        ) : (
          <div>
            <button onClick={() => setRemarkOpen(r => !r)} style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.72rem', color: '#009688', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '3px' }}>
              {remarkOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {remark ? 'Edit Remarks' : 'Add Remarks'}
            </button>
            {(remarkOpen || remark) && (
              <input type="text" placeholder="Add remarks…" value={remark} onChange={e => onRemarkChange(e.target.value)}
                style={{ width: '100%', padding: '0.3rem 0.5rem', border: '1px solid #d0d7d5', borderRadius: '5px', fontSize: '0.8rem', boxSizing: 'border-box', background: '#fafafa' }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Overall Progress Summary ──────────────────────────────────────────────────
function OverallProgress({ stages, getProgress }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginTop: '0.6rem', background: 'white', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.55rem 0.75rem', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', color: '#333' }}
      >
        <span>Overall Progress</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div style={{ padding: '0 0.75rem 0.6rem' }}>
          {stages.map(s => {
            const { verified, total } = getProgress(s.id);
            const pct      = total > 0 ? Math.round((verified / total) * 100) : 100;
            const complete = total === 0 || verified === total;
            return (
              <div key={s.id} style={{ marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '3px' }}>
                  <span style={{ fontWeight: 600, color: s.color }}>Stage {s.id}: {s.label}</span>
                  <span style={{ color: complete ? s.color : '#888' }}>
                    {total === 0 ? 'N/A' : `${verified} / ${total}`}{complete && total > 0 ? ' ✓' : ''}
                  </span>
                </div>
                <div style={{ height: '4px', background: '#f0f0f0', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: s.color, borderRadius: '2px', transition: 'width 0.3s ease' }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
