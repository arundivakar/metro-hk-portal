const fs = require('fs');
const Papa = require('papaparse');
const files = fs.readdirSync('C:\\Users\\arunk\\Downloads').filter(f => f.endsWith('.csv'));
files.forEach(filename => {
  const file = fs.readFileSync(`C:\\Users\\arunk\\Downloads\\${filename}`, 'utf8');
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      console.log(`\n--- ${filename} ---`);
      if (results.data.length > 0) {
        console.log(Object.keys(results.data[0]));
      }
    }
  });
});
