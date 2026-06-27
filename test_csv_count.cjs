const fs = require('fs');
const Papa = require('papaparse');
const file = fs.readFileSync('C:\\Users\\arunk\\Downloads\\Filtered_Rate_Master.csv', 'utf8');
Papa.parse(file, {
  header: true,
  complete: (results) => {
    const names = results.data.map(r => (r['Cleaning Material'] || '').trim()).filter(n => n === 'Acrylic Dry Mop');
    console.log('Acrylic Dry Mop count in CSV:', names.length);
  }
});
