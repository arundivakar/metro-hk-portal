import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';
applyPlugin(jsPDF);
import { ALS_GROUPS } from './constants';

/**
 * Convert raw base-unit quantity to billing quantity.
 * Items are stored in ml/g/Nos in the DB.
 * Bills are expressed in Ltr/Kg/Nos (or Kg for nos_per_kg items).
 *
 *  ml  → divide by 1000 → Ltr
 *  g   → divide by 1000 → Kg
 *  Nos with nos_per_kg → divide by nos_per_kg → Kg (e.g. garbage covers)
 *  Nos without nos_per_kg → 1:1 → Nos
 */
function toBillingQty(rawQty, dbUnit, nosPerKg) {
  if (dbUnit === 'ml') return rawQty / 1000;              // ml → Ltr
  if (dbUnit === 'g')  return rawQty / 1000;              // g  → Kg
  if (nosPerKg && nosPerKg > 0) return rawQty / nosPerKg; // Nos → Kg (garbage covers etc.)
  return rawQty;                                           // Nos → Nos
}

function billingUnitLabel(dbUnit, nosPerKg) {
  if (dbUnit === 'ml') return 'Ltr';
  if (dbUnit === 'g')  return 'Kg';
  if (nosPerKg && nosPerKg > 0) return 'Kg';
  return 'Nos';
}

export const generateMonthlyBillPdf = async (month, year, consumptionData, allItems = []) => {
  const doc = new jsPDF('landscape');
  
  // Title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('KOCHI METRO RAIL LIMITED', doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' });
  
  doc.setFontSize(12);
  doc.text('KMRL-O&M-OPC-FOR-150', doc.internal.pageSize.getWidth() - 15, 10, { align: 'right' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Revision No: 01', doc.internal.pageSize.getWidth() - 15, 15, { align: 'right' });
  doc.text(`Date: ${new Date().toLocaleDateString('en-GB')}`, doc.internal.pageSize.getWidth() - 15, 20, { align: 'right' });

  // Logo
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

  // Subtitle banner
  doc.setFillColor(0, 150, 136);
  doc.rect(14, 25, doc.internal.pageSize.getWidth() - 28, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Cleaning Material Consumption (Stations)', doc.internal.pageSize.getWidth() / 2, 31, { align: 'center' });

  // Month banner
  doc.setFillColor(0, 150, 136);
  doc.rect(14, 33, doc.internal.pageSize.getWidth() - 28, 8, 'F');
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' }).toUpperCase();
  doc.text('Name of Month:', 16, 39);
  doc.text(`${monthName} ${year}`, doc.internal.pageSize.getWidth() / 2, 39, { align: 'center' });
  
  doc.setTextColor(0, 0, 0);

  // ─── Build item map ─────────────────────────────────────────────────────────
  const groupedItems = {};

  // Initialise every active master item (ensures all 149 appear even with 0 consumption)
  allItems.forEach(item => {
    const dbUnit   = item.unit || 'Nos';
    const nosPerKg = item.rate_master?.nos_per_kg || null;
    groupedItems[item.name] = {
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

  // Accumulate raw base-unit consumption by ALS group
  consumptionData.forEach(log => {
    const itemName   = log.inventory_items?.name || 'Unknown';
    const stationCode = log.stations?.code;
    const qty        = Number(log.quantity_used || 0);

    // Ensure the item exists (consumed items not in master — shouldn't happen but safe)
    if (!groupedItems[itemName]) {
      const dbUnit   = log.inventory_items?.unit || 'Nos';
      const nosPerKg = log.inventory_items?.rate_master?.nos_per_kg || null;
      groupedItems[itemName] = {
        name:     itemName,
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

    if      (ALS_GROUPS['ALVA-KLMT'].includes(stationCode)) groupedItems[itemName]['ALVA-KLMT'] += qty;
    else if (ALS_GROUPS['CCUV-JLSD'].includes(stationCode)) groupedItems[itemName]['CCUV-JLSD'] += qty;
    else if (ALS_GROUPS['KALR-KVTR'].includes(stationCode)) groupedItems[itemName]['KALR-KVTR'] += qty;
    else if (ALS_GROUPS['EMKM-TPHT'].includes(stationCode)) groupedItems[itemName]['EMKM-TPHT'] += qty;
  });

  // ─── Build PDF table rows ────────────────────────────────────────────────────
  let totalALVA = 0, totalCCUV = 0, totalKALR = 0, totalEMKM = 0, grandTotal = 0;

  const tableData = Object.values(groupedItems).map((item, index) => {
    const { dbUnit, nosPerKg, rate } = item;

    // Convert each group's raw qty to billing qty
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

    const fmt  = (v) => v === 0 ? '' : v.toFixed(3).replace(/\.?0+$/, ''); // compact: "1.5" not "1.500"

    return [
      index + 1,
      item.name,
      item.brand,
      item.supplier,
      `${rate.toFixed(2)} / ${billingUnitLabel(dbUnit, nosPerKg)}`,
      fmt(alvaQty),
      fmt(ccuvQty),
      fmt(kalrQty),
      fmt(emkmQty),
      fmt(totalQty),
      amount > 0 ? amount.toFixed(2) : '',
    ];
  });

  // Footer totals row
  tableData.push([
    { content: 'TOTAL', colSpan: 5, styles: { halign: 'center', fontStyle: 'bold' } },
    totalALVA.toFixed(2),
    totalCCUV.toFixed(2),
    totalKALR.toFixed(2),
    totalEMKM.toFixed(2),
    '',
    grandTotal.toFixed(2),
  ]);

  doc.autoTable({
    startY: 41,
    head: [['Sl.\nNo', 'Cleaning Material', 'Brand', 'Supplier', 'Rate', 'ALVA-KLMT', 'CCUV-JLSD', 'KALR-KVTR', 'EMKM-TPHT', 'Total', 'Amount (₹)']],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [0, 150, 136], textColor: 255, halign: 'center', valign: 'middle' },
    styles: { fontSize: 7.5, cellPadding: 2 },
    columnStyles: {
      0:  { halign: 'center', cellWidth: 8 },
      1:  { cellWidth: 38 },
      4:  { halign: 'right', cellWidth: 22 },
      5:  { halign: 'center' },
      6:  { halign: 'center' },
      7:  { halign: 'center' },
      8:  { halign: 'center' },
      9:  { halign: 'center' },
      10: { halign: 'right', fontStyle: 'bold' },
    },
    didDrawCell: (data) => {
      if (data.row.index === tableData.length - 1) {
        data.cell.styles.fontStyle    = 'bold';
        data.cell.styles.fillColor    = [240, 240, 240];
      }
    },
  });

  doc.save(`KMRL_Consumption_Bill_${monthName}_${year}.pdf`);
};
