const STATUS = new Set(["BEKLEMEDE", "BEKLEYECEK", "SAT", "ARIZALI", "BİZİM", "BEKLET"]);

const NOTE_HINT =
  /SEVK|BEKLE|GİDECEK|GELECEK|HAZIR|ARIZA|YÜKLE|PAZARTESİ|SALI|ÇARŞAMBA|PERŞEMBE|CUMA|CUMARTESİ|PAZAR|SONRA|BERABER|NİSAN|MAYIS|HAZİRAN|YUNAK/i;

export function trUpper(value) {
  return String(value).toLocaleUpperCase("tr-TR");
}

export function isExcelDate(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (Math.abs(value - Math.round(value)) > 1e-6) return false;
  const n = Math.round(value);
  return n > 40000 && n < 60000;
}

export function excelSerialToIso(serial) {
  const n = Math.round(Number(serial));
  const utc = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function clean(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

function isNumberValue(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  return /^-?\d+(?:[.,]\d+)?$/.test(value.replace(/\s/g, ""));
}

function toNumber(value) {
  if (typeof value === "number") return value;
  return Number(String(value).replace(/\s/g, "").replace(",", "."));
}

function formatPlainNumber(value) {
  const n = typeof value === "number" ? value : toNumber(value);
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  return String(Math.round(n * 100) / 100);
}

function asText(value) {
  if (value == null) return "";
  if (typeof value === "number") return formatPlainNumber(value);
  return String(value);
}

function looksLikePlate(text) {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 16) return false;
  if (NOTE_HINT.test(s)) return false;
  if (/^\d{2}\s+[A-ZÇĞİÖŞÜa-zçğıöşü]{1,3}\s+\d{2,5}$/.test(s)) return true;
  if (/^[A-ZÇĞİÖŞÜa-zçğıöşü]{2,3}\s*\d{2,4}$/.test(s)) return true;
  if (/^\d{2}\s*[A-ZÇĞİÖŞÜa-zçğıöşü]{1,3}\s*\d{2,5}$/.test(s)) return true;
  return false;
}

function isNoteText(text) {
  if (STATUS.has(trUpper(text))) return true;
  if (text.length > 22) return true;
  if (NOTE_HINT.test(text)) return true;
  if (text.startsWith("(")) return true;
  return false;
}

function appendNote(existing, extra) {
  if (!extra) return existing || "";
  if (!existing) return extra;
  if (existing === extra || existing.includes(extra)) return existing;
  return `${existing} · ${extra}`;
}

function cellText(value) {
  if (value == null) return null;
  return trUpper(asText(value));
}

export function parseGiden(rows) {
  const days = [];
  let day = null;
  let group = null;

  function startGroup() {
    group = { plate: "", carrier: "", price: null, note: "", lines: [] };
    day.groups.push(group);
    return group;
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    const a = clean(row.a);
    const b = clean(row.b);
    const c = clean(row.c);
    const d = clean(row.d);
    const nextD = clean(rows[i + 1]?.d);

    if (typeof a === "number" && isExcelDate(a) && b == null && c == null) {
      const iso = excelSerialToIso(a);
      group = null;
      day = days.find((item) => item.date === iso);
      if (!day) {
        day = { date: iso, groups: [] };
        days.push(day);
      }
      continue;
    }

    if (a == null && b == null && c == null && d == null) {
      group = null;
      continue;
    }

    if (!day) continue;
    if (!group) startGroup();

    const hasModel = a != null || b != null || c != null;
    let line = null;
    if (hasModel) {
      line = {
        model: asText(a),
        chassis: asText(b),
        destination: asText(c),
        note: "",
      };
      group.lines.push(line);
    }

    if (d == null) continue;

    const dText = asText(d);
    const upper = trUpper(dText);
    const nextIsEge = cellText(nextD) === "EGE";

    if (upper === "EGE") {
      group.carrier = "EGE";
      continue;
    }

    if (isNumberValue(d)) {
      const numeric = toNumber(d);
      const whole = Math.abs(numeric - Math.round(numeric)) < 1e-6 ? Math.round(numeric) : Math.round(numeric * 100) / 100;
      if (nextIsEge && !group.plate) group.plate = formatPlainNumber(whole);
      else group.price = whole;
      continue;
    }

    if (isNoteText(dText) || !looksLikePlate(dText)) {
      if (line) line.note = appendNote(line.note, dText);
      else group.note = appendNote(group.note, dText);
      continue;
    }

    if (!group.plate) group.plate = dText;
    else if (line) line.note = appendNote(line.note, dText);
    else group.note = appendNote(group.note, dText);
  }

  for (const item of days) {
    item.groups = item.groups.filter((entry) => entry.lines.length > 0);
  }

  return days;
}
