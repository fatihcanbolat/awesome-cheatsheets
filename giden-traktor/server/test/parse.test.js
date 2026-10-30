import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGiden } from "../src/parseGiden.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(here, "..", "seed", "giden-traktor.json");

test("tarih, boş satır, plaka, EGE ve fiyat ayrışır", () => {
  const days = parseGiden([
    { a: 46024 },
    {},
    { a: "NİMET 75", b: "NP7T4DC8EBSA24048", c: "Sinop/BOYABAT", d: 6000 },
    {},
    { a: "KIYMET 90", b: "NP7T4GC4EBSA21974", c: "Bayburt", d: 6534 },
    { a: "BEREKET 60", b: "NP7T4BC3EASA24028", c: "Bayburt", d: "EGE" },
    { d: 6500 },
    {},
    { a: "KISMET", b: "NP7T4BC2EATA23646", c: "Ağrı", d: "BEKLEMEDE" },
    { a: "FUAR", b: "NP7T4DM0EATA24295", c: "İZMİR FUAR", d: "CUMA SEVK" },
    { a: 46027 },
  ]);

  assert.equal(days.length, 2);
  assert.equal(days[0].date, "2026-01-02");
  assert.equal(days[0].groups.length, 3);

  const priced = days[0].groups[0];
  assert.equal(priced.price, 6000);
  assert.equal(priced.plate, "");
  assert.equal(priced.lines.length, 1);

  const vehicle = days[0].groups[1];
  assert.equal(vehicle.plate, "6534");
  assert.equal(vehicle.carrier, "EGE");
  assert.equal(vehicle.price, 6500);
  assert.equal(vehicle.lines.length, 2);
  assert.equal(vehicle.lines[0].chassis, "NP7T4GC4EBSA21974");

  const waiting = days[0].groups[2];
  assert.equal(waiting.lines[0].note, "BEKLEMEDE");
  assert.equal(waiting.lines[1].note, "CUMA SEVK");
  assert.equal(waiting.plate, "");
});

test("2026 tohumunda 30 Ekim grupları doğru kurulmuş", () => {
  assert.equal(fs.existsSync(seedPath), true, "tohum dosyası üretilmeli");
  const days = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  assert.ok(days.length >= 200);
  assert.equal(days[0].date, "2026-01-02");
  assert.equal(days.at(-1).date, "2026-10-30");

  const day = days.find((item) => item.date === "2026-10-30");
  assert.ok(day);

  const gaziantep = day.groups.find((group) => group.plate === "FKJ 310");
  assert.ok(gaziantep);
  assert.equal(gaziantep.carrier, "EGE");
  assert.deepEqual(
    gaziantep.lines.map((line) => line.chassis),
    ["NP7T4BM5EATA25754", "NP7T4BM5EATA25609", "NP7T4BM5EATA25523", "NP7T4BM5EATA25535"],
  );
  assert.match(gaziantep.lines[0].destination, /Gaziantep/);
  assert.match(gaziantep.lines[3].destination, /Şanlıurfa/);

  const denizli = day.groups.find((group) => group.plate === "32 ND 537");
  assert.ok(denizli);
  assert.equal(denizli.carrier, "EGE");
  assert.equal(denizli.price, 20000);
  assert.equal(denizli.lines.length, 2);
  assert.equal(denizli.lines[0].chassis, "NP7T4DM0EBTA25714");
  assert.equal(denizli.lines[1].chassis, "NP7T4BR3EATA25676");
  assert.match(denizli.lines[0].destination, /Denizli/);

  const bandirma = day.groups.find((group) => group.plate === "41 TC 464");
  assert.ok(bandirma);
  assert.equal(bandirma.carrier, "EGE");
  assert.equal(bandirma.price, 9000);
  assert.equal(bandirma.lines.length, 1);
});
