const fs = require('fs');
const Papa = require('papaparse');
['Filtered_Rate_Master.csv', 'Filtered_Rate_Master_With_Unit.csv', 'rate_master_import.csv'].forEach(filename => {
  const file = fs.readFileSync(`C:\\Users\\arunk\\Downloads\\${filename}`, 'utf8');
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      console.log(`\n--- ${filename} ---`);
      console.log(`Rows: ${results.data.length}`);
      const names = results.data.map(row => (row['Cleaning Material'] || row['Item Name'] || row['name'] || '').trim().toLowerCase()).filter(n => n);
      console.log(`Unique names: ${new Set(names).size}`);
    }
  });
});
