import { jsPDF } from 'jspdf';
import * as autoTablePkg from 'jspdf-autotable';

console.log("autoTablePkg:", Object.keys(autoTablePkg));
if (typeof autoTablePkg.default === 'function') {
    console.log("default is function");
}
if (typeof autoTablePkg.autoTable === 'function') {
    console.log("autoTable is function");
}
if (typeof autoTablePkg.applyPlugin === 'function') {
    console.log("applyPlugin is function");
}
