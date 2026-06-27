const fs = require('fs');
const Papa = require('papaparse');
const file = fs.readFileSync(`C:\\Users\\arunk\\Downloads\\Opening_Stock_Template_PNCU.csv`, 'utf8');
Papa.parse(file, {
  header: true,
  skipEmptyLines: true,
  complete: (results) => {
    console.log(`Rows: ${results.data.length}`);
    const names = results.data.map(row => (row['Cleaning Material'] || '').trim()).filter(n => n);
    console.log(`Unique names: ${new Set(names).size}`);
    console.log(names.slice(0, 10));
  }
});
