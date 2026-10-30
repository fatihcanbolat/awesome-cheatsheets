import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { openDatabase, seedDatabase, createStore } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const dbPath = process.env.DB_PATH || path.join(root, "data", "giden.sqlite");
const seedPath = path.join(here, "..", "seed", "giden-traktor.json");
const port = Number(process.env.PORT || 8787);

const { db, fresh } = openDatabase(dbPath);
if (fresh) {
  if (!fs.existsSync(seedPath)) {
    console.warn("Tohum dosyası yok, boş veritabanı ile açılıyor");
  } else {
    const days = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    seedDatabase(db, days);
    console.log(`${days.length} gün tohumdan yüklendi`);
  }
}

const app = createApp(createStore(db));
app.listen(port, "0.0.0.0", () => {
  console.log(`Giden Traktör API http://localhost:${port}`);
});
