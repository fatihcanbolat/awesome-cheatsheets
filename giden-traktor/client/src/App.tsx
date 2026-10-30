import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { Board } from "./components/Board";
import { formatLongDate, todayIstanbul } from "./format";
import type { Day, DaySummary, SearchHit } from "./types";

export function App() {
  const [days, setDays] = useState<DaySummary[]>([]);
  const [date, setDate] = useState("");
  const [day, setDay] = useState<Day | null>(null);
  const [plates, setPlates] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [copyDate, setCopyDate] = useState(todayIstanbul());
  const [toast, setToast] = useState<{ text: string; date?: string } | null>(null);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);

  async function refreshLists() {
    const [list, plateList] = await Promise.all([api.days(), api.plates()]);
    setDays(list);
    setPlates(plateList);
    return list;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const today = todayIstanbul();
        const data = await api.createDay(today);
        const list = await refreshLists();
        if (cancelled) return;
        setDays(list);
        setCopyDate(today);
        setDate(today);
        setDay(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Pano açılamadı");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      api.search(q).then(setHits).catch(() => setHits([]));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!toast) return;
    const handle = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const dates = useMemo(() => days.map((item) => item.date), [days]);
  const index = dates.indexOf(date);
  const previousDate = index > 0 ? dates[index - 1] : null;
  const nextDate = index >= 0 && index < dates.length - 1 ? dates[index + 1] : null;

  const tractorCount = day?.groups.reduce((sum, group) => sum + group.lines.length, 0) ?? 0;
  const vehicleCount = day?.groups.filter((group) => group.plate).length ?? 0;
  const unassignedCount = day?.groups.reduce((sum, group) => sum + (group.plate ? 0 : group.lines.length), 0) ?? 0;

  async function openDate(next: string, lineId?: number) {
    setLoading(true);
    setSelected([]);
    setHighlightLine(lineId ?? null);
    setSearchOpen(false);
    try {
      const known = days.some((item) => item.date === next);
      const data = known ? await api.day(next) : await api.createDay(next);
      if (!known) await refreshLists();
      setDate(next);
      setDay(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gün açılamadı");
    } finally {
      setLoading(false);
    }
  }

  function toggleLine(id: number) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function groupSelected() {
    if (!day || selected.length < 2) return;
    const host = [...day.groups].reverse().find((group) => group.lines.some((line) => selected.includes(line.id)));
    if (!host) return;
    try {
      setDay(await api.regroup(selected, host.id));
      setSelected([]);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grup oluşturulamadı");
    }
  }

  async function copySelected() {
    if (!selected.length || !copyDate) return;
    try {
      await api.copyLines(selected, copyDate);
      const count = selected.length;
      setSelected([]);
      await refreshLists();
      if (copyDate === date) setDay(await api.day(date));
      setToast({ text: `${count} satır ${formatLongDate(copyDate)} gününe kopyalandı`, date: copyDate });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kopyalanamadı");
    }
  }

  async function addGroup() {
    if (!date) return;
    try {
      const data = await api.createGroup(date);
      setDay(data);
      await refreshLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grup eklenemedi");
    }
  }

  async function addLine() {
    if (!day) return;
    try {
      const target = [...day.groups].reverse().find((group) => !group.plate) ?? day.groups.at(-1);
      const data = target ? await api.createLine(target.id) : await api.createGroup(date);
      setDay(data);
      const newest = data.groups.flatMap((group) => group.lines).at(-1);
      if (newest) {
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>(`[data-line-id="${newest.id}"] .model`)?.focus();
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Satır eklenemedi");
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark">GT</span>
          <div>
            <p className="eyebrow">Sevk panosu</p>
            <h1>Giden Traktör</h1>
          </div>
        </div>

        <div className="date-nav">
          <button type="button" onClick={() => previousDate && openDate(previousDate)} disabled={!previousDate}>
            Önceki
          </button>
          <label className="date-picker">
            <input
              type="date"
              value={date}
              aria-label="Sevk tarihi"
              onChange={(event) => {
                if (event.target.value) openDate(event.target.value);
              }}
            />
            <strong>{date ? formatLongDate(date) : "Tarih"}</strong>
          </label>
          <button type="button" onClick={() => nextDate && openDate(nextDate)} disabled={!nextDate}>
            Sonraki
          </button>
          <button type="button" className="ghost" onClick={() => openDate(todayIstanbul())}>
            Bugün
          </button>
        </div>

        <div className="search">
          <input
            value={query}
            placeholder="Şasi, plaka veya il ara"
            aria-label="Şasi, plaka veya il ara"
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
          />
          {searchOpen && hits.length > 0 && (
            <div className="search-results" role="listbox">
              {hits.map((hit) => (
                <button
                  type="button"
                  key={`${hit.date}-${hit.lineId}`}
                  onClick={() => {
                    setQuery("");
                    openDate(hit.date, hit.lineId);
                  }}
                >
                  <b>{formatLongDate(hit.date)}</b>
                  <span>{hit.plate || "Atanmamış"}</span>
                  <span>{hit.chassis || hit.model}</span>
                  <span>{hit.destination}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="toolbar">
        <p className="counts">
          <span>{tractorCount} traktör</span>
          <span>{vehicleCount} araç</span>
          <span>{unassignedCount} atanmamış</span>
        </p>
        <div className="toolbar-actions">
          <button type="button" onClick={addLine}>Satır ekle</button>
          <button type="button" onClick={addGroup}>Araç grubu</button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              if (!date) return;
              setLoading(true);
              api.day(date).then(setDay).catch((err: Error) => setError(err.message)).finally(() => setLoading(false));
            }}
          >
            Yenile
          </button>
        </div>
      </div>

      {error && <p className="banner" role="alert">{error}</p>}

      <main onMouseDown={() => setSearchOpen(false)}>
        {loading && !day && <p className="muted pad">Pano yükleniyor…</p>}
        {day && (
          <Board
            day={day}
            plates={plates}
            query={query}
            selected={selected}
            highlightLine={highlightLine}
            onToggle={toggleLine}
            onChange={(next) => {
              setDay(next);
              setError("");
            }}
            onError={setError}
          />
        )}
      </main>

      {selected.length > 0 && (
        <div className="selection-bar">
          <strong>{selected.length} satır seçili</strong>
          <label>
            Hedef gün
            <input type="date" value={copyDate} onChange={(event) => setCopyDate(event.target.value)} />
          </label>
          <button type="button" onClick={copySelected}>Bu güne kopyala</button>
          {selected.length >= 2 && <button type="button" onClick={groupSelected}>Yeni araç grubu</button>}
          <button type="button" className="ghost" onClick={() => setSelected([])}>Seçimi kaldır</button>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.date && toast.date !== date && (
            <button type="button" onClick={() => openDate(toast.date!)}>Güne git</button>
          )}
        </div>
      )}
    </div>
  );
}
