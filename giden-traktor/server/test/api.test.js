import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { createStore, openDatabase, seedDatabase } from "../src/store.js";

const sample = [
  {
    date: "2026-10-30",
    groups: [
      {
        plate: "FKJ 310",
        carrier: "EGE",
        price: null,
        note: "",
        lines: [
          { model: "Kısmet 55", chassis: "NP7T4BM5EATA25754", destination: "Gaziantep / Merkez", note: "" },
          { model: "Kısmet 55", chassis: "NP7T4BM5EATA25609", destination: "Gaziantep / Merkez", note: "" },
          { model: "Kısmet 55", chassis: "NP7T4BM5EATA25523", destination: "Gaziantep / Nizip", note: "" },
        ],
      },
      {
        plate: "",
        carrier: "",
        price: null,
        note: "",
        lines: [
          { model: "Bekleyen A", chassis: "SASIA", destination: "Bolu", note: "BEKLEMEDE" },
          { model: "Bekleyen B", chassis: "SASIB", destination: "Düzce", note: "" },
          { model: "Bekleyen C", chassis: "SASIC", destination: "Kars", note: "" },
        ],
      },
    ],
  },
];

async function request(base, method, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { status: response.status, data };
}

test("gün, sıralama, gruplama, kopyalama ve arama", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "giden-"));
  const dbPath = path.join(dir, "giden.sqlite");
  const { db } = openDatabase(dbPath);
  seedDatabase(db, sample);
  const app = createApp(createStore(db));
  const server = await new Promise((resolve) => {
    const httpServer = app.listen(0, "127.0.0.1", () => resolve(httpServer));
  });
  t.after(() => new Promise((resolve) => {
    server.close(() => {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
      resolve();
    });
  }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port alınamadı");
  const base = `http://127.0.0.1:${address.port}`;

  const listed = await request(base, "GET", "/api/days");
  assert.equal(listed.status, 200);
  assert.equal(listed.data[0].date, "2026-10-30");
  assert.equal(listed.data[0].tractorCount, 6);

  const day = await request(base, "GET", "/api/days/2026-10-30");
  assert.equal(day.data.groups[0].plate, "FKJ 310");
  assert.equal(day.data.groups[0].carrier, "EGE");
  const gaziantep = day.data.groups[0];
  const pool = day.data.groups[1];

  const moved = await request(base, "POST", "/api/reorder", {
    kind: "line",
    lineId: gaziantep.lines[2].id,
    toGroupId: gaziantep.id,
    index: 0,
  });
  assert.equal(moved.data.groups[0].lines[0].chassis, "NP7T4BM5EATA25523");

  const regrouped = await request(base, "POST", "/api/reorder", {
    kind: "regroup",
    lineIds: [pool.lines[0].id, pool.lines[1].id],
    afterGroupId: pool.id,
  });
  assert.equal(regrouped.status, 200);
  const created = regrouped.data.groups.find((group) => group.lines.some((line) => line.chassis === "SASIA"));
  assert.ok(created);
  assert.deepEqual(
    created.lines.map((line) => line.chassis),
    ["SASIA", "SASIB"],
  );
  assert.equal(created.plate, "");
  const leftover = regrouped.data.groups.find((group) => group.lines.some((line) => line.chassis === "SASIC"));
  assert.ok(leftover);
  assert.equal(leftover.lines.length, 1);

  const joined = await request(base, "POST", "/api/reorder", {
    kind: "line",
    lineId: leftover.lines[0].id,
    toGroupId: gaziantep.id,
    index: 1,
  });
  assert.equal(joined.data.groups[0].lines[1].chassis, "SASIC");

  const copied = await request(base, "POST", "/api/lines/copy", {
    lineIds: [gaziantep.lines[0].id],
    toDate: "2026-10-31",
  });
  assert.equal(copied.status, 201);
  assert.equal(copied.data.date, "2026-10-31");
  assert.equal(copied.data.groups[0].plate, "FKJ 310");
  assert.equal(copied.data.groups[0].lines.length, 1);

  const source = await request(base, "GET", "/api/days/2026-10-30");
  assert.ok(source.data.groups[0].lines.some((line) => line.chassis === "NP7T4BM5EATA25523"));

  const found = await request(base, "GET", "/api/search?q=SASIB");
  assert.equal(found.data.length, 1);
  assert.equal(found.data[0].date, "2026-10-30");

  const duplicate = await request(base, "POST", `/api/groups/${gaziantep.id}/lines`, {
    model: "Kopya",
    chassis: "NP7T4BM5EATA25754",
    destination: "Gaziantep",
  });
  assert.ok(duplicate.data.duplicateChassis.includes("NP7T4BM5EATA25754"));
});
