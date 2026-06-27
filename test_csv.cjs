const fs = require('fs');
const Papa = require('papaparse');
const file = fs.readFileSync('C:\\Users\\arunk\\Downloads\\Filtered_Rate_Master_With_Unit.csv', 'utf8');

Papa.parse(file, {
  header: true,
  skipEmptyLines: true,
  complete: (results) => {
    const data = results.data;
    console.log(`Parsed ${data.length} rows.`);
    const names = data.map(row => (row['Cleaning Material'] || '').trim().toLowerCase()).filter(n => n);
    const unique = new Set(names);
    console.log(`Unique cleaning materials: ${unique.size}`);
    
    // Check chemicals
    let chem = 0, cons = 0;
    data.forEach(row => {
      let cat = (row['Chemical/Consumable'] || '').toLowerCase();
      if (cat.includes('chemical') || cat.includes('category')) chem++;
      else cons++;
    });
    console.log(`Chemicals: ${chem}, Consumables: ${cons}`);
  }
});
