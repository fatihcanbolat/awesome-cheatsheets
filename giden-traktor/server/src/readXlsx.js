import XLSX from "xlsx";

const COLS = ["a", "b", "c", "d"];

export function readGidenSheet(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false, dense: false });
  const sheet = workbook.Sheets["GİDEN TRAKTÖR"];
  if (!sheet || !sheet["!ref"]) {
    throw new Error("GİDEN TRAKTÖR sayfası bulunamadı");
  }
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row = {};
    for (let c = 0; c < COLS.length; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell || cell.v == null || cell.v === "") continue;
      row[COLS[c]] = cell.v;
    }
    rows.push(row);
  }
  return rows;
}
