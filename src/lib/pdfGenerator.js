import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ALS_GROUPS } from './constants';

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

  // Add Logo
  try {
    const response = await fetch('/kmrl_logo.png');
    const blob = await response.blob();
    const base64data = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    // Adjust x, y, width, height for the logo
    // Let's place it at top-left
    doc.addImage(base64data, 'PNG', 14, 5, 20, 20);
  } catch (err) {
    console.warn('Failed to load logo for PDF', err);
  }

  // Subtitle banner
  doc.setFillColor(0, 150, 136); // Teal
  doc.rect(14, 25, doc.internal.pageSize.getWidth() - 28, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Cleaning Material Consumption (Stations)', doc.internal.pageSize.getWidth() / 2, 31, { align: 'center' });

  // Month
  doc.setFillColor(0, 150, 136);
  doc.rect(14, 33, doc.internal.pageSize.getWidth() - 28, 8, 'F');
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' }).toUpperCase();
  doc.text('Name of Month:', 16, 39);
  doc.text(`${monthName} ${year}`, doc.internal.pageSize.getWidth() / 2, 39, { align: 'center' });
  
  doc.setTextColor(0, 0, 0);

  // Group data by Item
  const groupedItems = {};
  
  // First, initialize all available items in the system
  allItems.forEach(item => {
    groupedItems[item.name] = {
      name: item.name,
      brand: item.rate_master?.brand || 'ORDINARY',
      supplier: 'Tricuesta',
      rate: Number(item.rate_master?.unit_rate || 0),
      'ALVA-KLMT': 0,
      'CCUV-JLSD': 0,
      'KALR-KVTR': 0,
      'EMKM-TPHT': 0,
    };
  });

  // Then add the consumption data
  consumptionData.forEach(log => {
    const itemName = log.inventory_items?.name || 'Unknown';
    const stationCode = log.stations?.code;
    const qty = Number(log.quantity_used || 0);
    
    // If an item was consumed but wasn't in allItems for some reason, initialize it
    if (!groupedItems[itemName]) {
      groupedItems[itemName] = {
        name: itemName,
        brand: log.inventory_items?.rate_master?.brand || 'ORDINARY',
        supplier: 'Tricuesta',
        rate: Number(log.inventory_items?.rate_master?.unit_rate || 0),
        'ALVA-KLMT': 0,
        'CCUV-JLSD': 0,
        'KALR-KVTR': 0,
        'EMKM-TPHT': 0,
      };
    }
    
    // Assign qty to correct group
    if (ALS_GROUPS['ALVA-KLMT'].includes(stationCode)) groupedItems[itemName]['ALVA-KLMT'] += qty;
    else if (ALS_GROUPS['CCUV-JLSD'].includes(stationCode)) groupedItems[itemName]['CCUV-JLSD'] += qty;
    else if (ALS_GROUPS['KALR-KVTR'].includes(stationCode)) groupedItems[itemName]['KALR-KVTR'] += qty;
    else if (ALS_GROUPS['EMKM-TPHT'].includes(stationCode)) groupedItems[itemName]['EMKM-TPHT'] += qty;
  });

  // Convert to table rows
  let totalALVA = 0, totalCCUV = 0, totalKALR = 0, totalEMKM = 0, grandTotal = 0;
  
  const tableData = Object.values(groupedItems).map((item, index) => {
    const itemTotalQty = item['ALVA-KLMT'] + item['CCUV-JLSD'] + item['KALR-KVTR'] + item['EMKM-TPHT'];
    const itemAmount = itemTotalQty * item.rate;
    
    // Add to sums
    totalALVA += item['ALVA-KLMT'] * item.rate;
    totalCCUV += item['CCUV-JLSD'] * item.rate;
    totalKALR += item['KALR-KVTR'] * item.rate;
    totalEMKM += item['EMKM-TPHT'] * item.rate;
    grandTotal += itemAmount;

    return [
      index + 1,
      item.name,
      item.brand,
      item.supplier,
      item.rate.toFixed(2),
      item['ALVA-KLMT'] || 0,
      item['CCUV-JLSD'] || 0,
      item['KALR-KVTR'] || 0,
      item['EMKM-TPHT'] || 0,
      itemTotalQty.toFixed(2),
      itemAmount.toFixed(2)
    ];
  });

  // Footer row
  tableData.push([
    { content: 'TOTAL', colSpan: 5, styles: { halign: 'center', fontStyle: 'bold' } },
    totalALVA.toFixed(2),
    totalCCUV.toFixed(2),
    totalKALR.toFixed(2),
    totalEMKM.toFixed(2),
    '', // Empty for quantity total
    grandTotal.toFixed(2)
  ]);

  autoTable(doc, {
    startY: 41,
    head: [['Sl.\nNo', 'Cleaning Material', 'Brand', 'Supplier', 'Rate', 'ALVA-KLMT', 'CCUV-JLSD', 'KALR-KVTR', 'EMKM-TPHT', 'Total', 'Amount']],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [0, 150, 136], textColor: 255, halign: 'center', valign: 'middle' },
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 40 },
      4: { halign: 'right' },
      5: { halign: 'center' },
      6: { halign: 'center' },
      7: { halign: 'center' },
      8: { halign: 'center' },
      9: { halign: 'center' },
      10: { halign: 'right', fontStyle: 'bold' }
    },
    didDrawCell: (data) => {
      // Bold the last row
      if (data.row.index === tableData.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [240, 240, 240];
      }
    }
  });

  doc.save(`KMRL_Consumption_Bill_${monthName}_${year}.pdf`);
};
