const fs = require('fs');
const Papa = require('papaparse');
const file = fs.readFileSync('C:\\Users\\arunk\\Downloads\\Opening_Stock_Template_PNCU.csv', 'utf8');
Papa.parse(file, {
  header: true,
  complete: (results) => {
    const names = results.data.map(r => (r['Item Name'] || '').trim()).filter(n => n.includes('Acrylic'));
    console.log(names);
  }
});
