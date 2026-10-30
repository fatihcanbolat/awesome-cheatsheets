import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const fresh = !fs.existsSync(dbPath);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS days (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY,
      day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      plate TEXT NOT NULL DEFAULT '',
      carrier TEXT NOT NULL DEFAULT '',
      price REAL,
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS lines (
      id INTEGER PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      chassis TEXT NOT NULL DEFAULT '',
      destination TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_groups_day ON groups(day_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_lines_group ON lines(group_id, sort_order);
  `);
  return { db, fresh };
}

export function seedDatabase(db, days) {
  const insertDay = db.prepare("INSERT INTO days (date) VALUES (?)");
  const insertGroup = db.prepare(
    "INSERT INTO groups (day_id, sort_order, plate, carrier, price, note) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertLine = db.prepare(
    "INSERT INTO lines (group_id, sort_order, model, chassis, destination, note) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const tx = db.transaction((items) => {
    for (const day of items) {
      const dayInfo = insertDay.run(day.date);
      day.groups.forEach((group, groupIndex) => {
        const groupInfo = insertGroup.run(
          dayInfo.lastInsertRowid,
          groupIndex,
          group.plate || "",
          group.carrier || "",
          group.price ?? null,
          group.note || "",
        );
        group.lines.forEach((line, lineIndex) => {
          insertLine.run(
            groupInfo.lastInsertRowid,
            lineIndex,
            line.model || "",
            line.chassis || "",
            line.destination || "",
            line.note || "",
          );
        });
      });
    }
  });
  tx(days);
}

function assertDate(date) {
  if (!DATE_RE.test(date || "")) throw httpError(400, "Tarih YYYY-AA-GG biçiminde olmalı");
  return date;
}

function text(value, field) {
  if (value == null) return "";
  const trimmed = String(value).trim();
  if (trimmed.length > 500) throw httpError(400, `${field} çok uzun`);
  return trimmed;
}

function priceValue(value) {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(number) || number < 0) throw httpError(400, "Fiyat geçersiz");
  if (Math.abs(number - Math.round(number)) < 1e-6) return Math.round(number);
  return Math.round(number * 100) / 100;
}

function mapLine(row) {
  return {
    id: row.id,
    sortOrder: row.sort_order,
    model: row.model,
    chassis: row.chassis,
    destination: row.destination,
    note: row.note,
  };
}

function mapGroup(row, lines) {
  return {
    id: row.id,
    sortOrder: row.sort_order,
    plate: row.plate,
    carrier: row.carrier,
    price: row.price,
    note: row.note,
    lines,
  };
}

function duplicateChassis(groups) {
  const counts = new Map();
  for (const group of groups) {
    for (const line of group.lines) {
      const key = line.chassis.trim().toLocaleUpperCase("tr-TR");
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

export function createStore(db) {
  const dayByDate = db.prepare("SELECT * FROM days WHERE date = ?");
  const dayById = db.prepare("SELECT * FROM days WHERE id = ?");
  const groupById = db.prepare("SELECT * FROM groups WHERE id = ?");
  const lineById = db.prepare("SELECT * FROM lines WHERE id = ?");
  const groupsByDay = db.prepare("SELECT * FROM groups WHERE day_id = ? ORDER BY sort_order, id");
  const linesByGroup = db.prepare("SELECT * FROM lines WHERE group_id = ? ORDER BY sort_order, id");
  const insertDay = db.prepare("INSERT INTO days (date) VALUES (?)");
  const insertGroup = db.prepare(
    "INSERT INTO groups (day_id, sort_order, plate, carrier, price, note) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertLine = db.prepare(
    "INSERT INTO lines (group_id, sort_order, model, chassis, destination, note) VALUES (?, ?, ?, ?, ?, ?)",
  );

  function requireGroup(id) {
    const group = groupById.get(id);
    if (!group) throw httpError(404, "Araç grubu bulunamadı");
    return group;
  }

  function requireLine(id) {
    const line = lineById.get(id);
    if (!line) throw httpError(404, "Satır bulunamadı");
    return line;
  }

  function dayIdOfGroup(groupId) {
    return requireGroup(groupId).day_id;
  }

  function loadDayId(dayId) {
    const day = dayById.get(dayId);
    if (!day) return null;
    const groups = groupsByDay.all(day.id).map((group) => mapGroup(group, linesByGroup.all(group.id).map(mapLine)));
    return {
      id: day.id,
      date: day.date,
      groups,
      duplicateChassis: duplicateChassis(groups),
    };
  }

  function ensureDay(date) {
    assertDate(date);
    const existing = dayByDate.get(date);
    if (existing) return existing;
    const info = insertDay.run(date);
    return dayById.get(info.lastInsertRowid);
  }

  function orderedLineIds(groupId) {
    return linesByGroup.all(groupId).map((line) => line.id);
  }

  function rewriteLines(groupId, ids) {
    const update = db.prepare("UPDATE lines SET group_id = ?, sort_order = ? WHERE id = ?");
    ids.forEach((id, index) => update.run(groupId, index, id));
  }

  function rewriteGroups(dayId, ids) {
    const update = db.prepare("UPDATE groups SET sort_order = ? WHERE id = ? AND day_id = ?");
    ids.forEach((id, index) => update.run(index, id, dayId));
  }

  function listDays() {
    return db
      .prepare(
        `SELECT d.date AS date,
                (SELECT COUNT(*) FROM groups g WHERE g.day_id = d.id) AS groupCount,
                (SELECT COUNT(*) FROM lines l JOIN groups g ON g.id = l.group_id WHERE g.day_id = d.id) AS tractorCount
         FROM days d
         ORDER BY d.date`,
      )
      .all();
  }

  function getDay(date) {
    assertDate(date);
    const day = dayByDate.get(date);
    if (!day) return null;
    return loadDayId(day.id);
  }

  function createGroup(date, input = {}) {
    const day = ensureDay(date);
    const sortOrder = groupsByDay.all(day.id).length;
    const info = insertGroup.run(
      day.id,
      sortOrder,
      text(input.plate, "Plaka"),
      text(input.carrier, "Nakliyeci"),
      priceValue(input.price),
      text(input.note, "Not"),
    );
    const groupId = Number(info.lastInsertRowid);
    if (input.withBlankLine !== false) {
      insertLine.run(groupId, 0, "", "", "", "");
    }
    return loadDayId(day.id);
  }

  function updateGroup(id, patch) {
    const group = requireGroup(id);
    const next = {
      plate: Object.hasOwn(patch, "plate") ? text(patch.plate, "Plaka") : group.plate,
      carrier: Object.hasOwn(patch, "carrier") ? text(patch.carrier, "Nakliyeci") : group.carrier,
      price: Object.hasOwn(patch, "price") ? priceValue(patch.price) : group.price,
      note: Object.hasOwn(patch, "note") ? text(patch.note, "Not") : group.note,
    };
    db.prepare("UPDATE groups SET plate = ?, carrier = ?, price = ?, note = ? WHERE id = ?").run(
      next.plate,
      next.carrier,
      next.price,
      next.note,
      group.id,
    );
    return loadDayId(group.day_id);
  }

  function deleteGroup(id) {
    const group = requireGroup(id);
    db.prepare("DELETE FROM groups WHERE id = ?").run(group.id);
    const ids = groupsByDay.all(group.day_id).map((item) => item.id);
    rewriteGroups(group.day_id, ids);
    return loadDayId(group.day_id);
  }

  function createLine(groupId, input = {}) {
    const group = requireGroup(groupId);
    const ids = orderedLineIds(group.id);
    const index = input.index == null ? ids.length : Math.max(0, Math.min(Number(input.index), ids.length));
    const info = insertLine.run(
      group.id,
      ids.length,
      text(input.model, "Model"),
      text(input.chassis, "Şasi"),
      text(input.destination, "Varış"),
      text(input.note, "Not"),
    );
    ids.splice(index, 0, Number(info.lastInsertRowid));
    rewriteLines(group.id, ids);
    return loadDayId(group.day_id);
  }

  function updateLine(id, patch) {
    const line = requireLine(id);
    const next = {
      model: Object.hasOwn(patch, "model") ? text(patch.model, "Model") : line.model,
      chassis: Object.hasOwn(patch, "chassis") ? text(patch.chassis, "Şasi") : line.chassis,
      destination: Object.hasOwn(patch, "destination") ? text(patch.destination, "Varış") : line.destination,
      note: Object.hasOwn(patch, "note") ? text(patch.note, "Not") : line.note,
    };
    db.prepare("UPDATE lines SET model = ?, chassis = ?, destination = ?, note = ? WHERE id = ?").run(
      next.model,
      next.chassis,
      next.destination,
      next.note,
      line.id,
    );
    return loadDayId(dayIdOfGroup(line.group_id));
  }

  function deleteLine(id) {
    const line = requireLine(id);
    const dayId = dayIdOfGroup(line.group_id);
    db.prepare("DELETE FROM lines WHERE id = ?").run(line.id);
    rewriteLines(line.group_id, orderedLineIds(line.group_id));
    return loadDayId(dayId);
  }

  function moveLine(lineId, toGroupId, index) {
    const line = requireLine(lineId);
    const target = requireGroup(toGroupId);
    const sourceDay = dayIdOfGroup(line.group_id);
    if (sourceDay !== target.day_id) throw httpError(400, "Satır başka bir güne sürüklenemez");
    const tx = db.transaction(() => {
      if (line.group_id === target.id) {
        const ids = orderedLineIds(target.id);
        const from = ids.indexOf(line.id);
        ids.splice(from, 1);
        const nextIndex = Math.max(0, Math.min(Number(index) || 0, ids.length));
        ids.splice(nextIndex, 0, line.id);
        rewriteLines(target.id, ids);
      } else {
        const sourceIds = orderedLineIds(line.group_id).filter((id) => id !== line.id);
        const destIds = orderedLineIds(target.id);
        const nextIndex = Math.max(0, Math.min(Number(index) || 0, destIds.length));
        destIds.splice(nextIndex, 0, line.id);
        db.prepare("UPDATE lines SET group_id = ? WHERE id = ?").run(target.id, line.id);
        rewriteLines(line.group_id, sourceIds);
        rewriteLines(target.id, destIds);
        if (sourceIds.length === 0) {
          const source = groupById.get(line.group_id);
          if (source && !source.plate && !source.carrier && source.price == null && !source.note) {
            db.prepare("DELETE FROM groups WHERE id = ?").run(source.id);
            rewriteGroups(source.day_id, groupsByDay.all(source.day_id).map((item) => item.id));
          }
        }
      }
    });
    tx();
    return loadDayId(target.day_id);
  }

  function moveGroup(groupId, index) {
    const group = requireGroup(groupId);
    const ids = groupsByDay.all(group.day_id).map((item) => item.id);
    const from = ids.indexOf(group.id);
    ids.splice(from, 1);
    const nextIndex = Math.max(0, Math.min(Number(index) || 0, ids.length));
    ids.splice(nextIndex, 0, group.id);
    rewriteGroups(group.day_id, ids);
    return loadDayId(group.day_id);
  }

  function regroupLines(lineIds, afterGroupId) {
    if (!Array.isArray(lineIds) || lineIds.length < 2) throw httpError(400, "Gruplamak için iki satır gerekli");
    const uniqueIds = [...new Set(lineIds.map((id) => Number(id)))];
    const lines = uniqueIds.map((id) => requireLine(id));
    const after = requireGroup(afterGroupId);
    const dayId = after.day_id;
    if (lines.some((line) => dayIdOfGroup(line.group_id) !== dayId)) {
      throw httpError(400, "Satırlar aynı günde olmalı");
    }
    const sourceGroups = [...new Set(lines.map((line) => line.group_id))];
    if (sourceGroups.length === 1 && orderedLineIds(sourceGroups[0]).length === lines.length) {
      rewriteLines(sourceGroups[0], uniqueIds);
      return loadDayId(dayId);
    }

    const tx = db.transaction(() => {
      const afterOrder = requireGroup(after.id).sort_order;
      db.prepare("UPDATE groups SET sort_order = sort_order + 1 WHERE day_id = ? AND sort_order > ?").run(dayId, afterOrder);
      const info = insertGroup.run(dayId, afterOrder + 1, "", "", null, "");
      const newGroupId = Number(info.lastInsertRowid);
      uniqueIds.forEach((id, index) => {
        db.prepare("UPDATE lines SET group_id = ?, sort_order = ? WHERE id = ?").run(newGroupId, index, id);
      });
      for (const groupId of sourceGroups) {
        const remaining = orderedLineIds(groupId);
        if (remaining.length === 0) db.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
        else rewriteLines(groupId, remaining);
      }
      rewriteGroups(dayId, groupsByDay.all(dayId).map((group) => group.id));
    });
    tx();
    return loadDayId(dayId);
  }

  function copyLines(lineIds, toDate) {
    if (!Array.isArray(lineIds) || lineIds.length === 0) throw httpError(400, "Kopyalanacak satır seçilmedi");
    const target = ensureDay(assertDate(toDate));
    const lines = lineIds.map((id) => requireLine(Number(id)));
    const clusters = [];
    for (const line of lines) {
      let cluster = clusters.find((item) => item.groupId === line.group_id);
      if (!cluster) {
        const group = requireGroup(line.group_id);
        cluster = {
          groupId: group.id,
          plate: group.plate,
          carrier: group.carrier,
          price: group.price,
          note: group.note,
          lines: [],
        };
        clusters.push(cluster);
      }
      cluster.lines.push(line);
    }
    const tx = db.transaction(() => {
      let sortOrder = groupsByDay.all(target.id).length;
      for (const cluster of clusters) {
        const info = insertGroup.run(target.id, sortOrder, cluster.plate, cluster.carrier, cluster.price, cluster.note);
        cluster.lines.forEach((line, index) => {
          insertLine.run(info.lastInsertRowid, index, line.model, line.chassis, line.destination, line.note);
        });
        sortOrder += 1;
      }
    });
    tx();
    return loadDayId(target.id);
  }

  function search(query) {
    const q = text(query, "Arama");
    if (q.length < 2) return [];
    const like = `%${q.replace(/[%_]/g, "")}%`;
    return db
      .prepare(
        `SELECT d.date AS date, g.id AS groupId, g.plate AS plate, l.id AS lineId,
                l.model AS model, l.chassis AS chassis, l.destination AS destination, l.note AS note
         FROM lines l
         JOIN groups g ON g.id = l.group_id
         JOIN days d ON d.id = g.day_id
         WHERE l.chassis LIKE ? COLLATE NOCASE
            OR l.model LIKE ? COLLATE NOCASE
            OR l.destination LIKE ? COLLATE NOCASE
            OR l.note LIKE ? COLLATE NOCASE
            OR g.plate LIKE ? COLLATE NOCASE
            OR g.carrier LIKE ? COLLATE NOCASE
            OR g.note LIKE ? COLLATE NOCASE
         ORDER BY d.date DESC, g.sort_order, l.sort_order
         LIMIT 40`,
      )
      .all(like, like, like, like, like, like, like);
  }

  function plates() {
    return db
      .prepare(
        `SELECT plate, COUNT(*) AS count
         FROM groups
         WHERE plate != ''
         GROUP BY plate
         ORDER BY count DESC, plate
         LIMIT 40`,
      )
      .all()
      .map((row) => row.plate);
  }

  return {
    listDays,
    getDay,
    ensureDay: (date) => loadDayId(ensureDay(date).id),
    createGroup,
    updateGroup,
    deleteGroup,
    createLine,
    updateLine,
    deleteLine,
    moveLine,
    moveGroup,
    regroupLines,
    copyLines,
    search,
    plates,
  };
}
