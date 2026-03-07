const ExcelJS = require("exceljs");

function toArr(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v);
  return [];
}

async function generateXLSX(input, outputPath) {
  const wb = new ExcelJS.Workbook();
  wb.title = input.title || "Spreadsheet";
  wb.creator = "AI Research Agent";
  wb.created = new Date();

  const sheets = toArr(input.sheets);

  for (const sheetData of sheets) {
    const ws = wb.addWorksheet(sheetData.name || "Sheet");
    const headers = toArr(sheetData.headers).map(String);
    const rows = toArr(sheetData.rows);

    // Headers
    if (headers.length) {
      const headerRow = ws.addRow(headers);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF065A82" } };
      headerRow.alignment = { horizontal: "center", vertical: "center" };
      headerRow.height = 28;
    }

    // Data rows
    for (let ri = 0; ri < rows.length; ri++) {
      const cells = toArr(rows[ri]).map(cell => cell != null ? cell : "");
      const row = ws.addRow(cells);
      row.font = { name: "Calibri", size: 11 };
      // Alternate row shading
      if (ri % 2 === 1) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F7FA" } };
      }
    }

    // Formulas
    for (const f of toArr(sheetData.formulas)) {
      if (f?.cell && f?.formula) {
        const cell = ws.getCell(f.cell);
        cell.value = { formula: f.formula };
        cell.font = { bold: true, name: "Calibri", size: 11 };
      }
    }

    // Auto-width columns (approximate)
    ws.columns.forEach((col, i) => {
      let maxLen = headers[i]?.length || 10;
      rows.forEach(row => {
        const cell = toArr(row)[i];
        if (cell != null) maxLen = Math.max(maxLen, String(cell).length);
      });
      col.width = Math.min(Math.max(maxLen + 2, 10), 40);
    });

    // Freeze header row
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  await wb.xlsx.writeFile(outputPath);
  return outputPath;
}

module.exports = { generateXLSX };
