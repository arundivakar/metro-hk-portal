const fs = require('fs');
const Papa = require('papaparse');
const file = fs.readFileSync('C:\\Users\\arunk\\Downloads\\Opening_Stock_Template_PNCU.csv', 'utf8');
const results = Papa.parse(file, { header: true, skipEmptyLines: true });
console.log('Rows in Opening_Stock_Template_PNCU.csv:', results.data.length);
