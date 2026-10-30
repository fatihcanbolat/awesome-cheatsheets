import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGiden } from "./parseGiden.js";
import { readGidenSheet } from "./readXlsx.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultXlsx = "/home/ubuntu/.cursor/projects/workspace/uploads/TRAKT_R_2026_a2f7.xlsx";
const xlsxPath = process.argv[2] || process.env.GIDEN_XLSX || defaultXlsx;
const outPath = path.join(here, "..", "seed", "giden-traktor.json");

const days = parseGiden(readGidenSheet(xlsxPath));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(days));

const lines = days.reduce((sum, day) => sum + day.groups.reduce((inner, group) => inner + group.lines.length, 0), 0);
const groups = days.reduce((sum, day) => sum + day.groups.length, 0);
console.log(`${days.length} gün, ${groups} grup, ${lines} satır → ${outPath}`);

const sample = days.find((day) => day.date === "2026-10-30");
if (sample) {
  for (const group of sample.groups) {
    const first = group.lines[0];
    console.log(
      `- ${group.plate || "(plakasız)"} | ${group.carrier || "-"} | fiyat ${group.price ?? "-"} | ${group.lines.length} satır | ${first?.destination || ""}`,
    );
  }
}
