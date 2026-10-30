import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { chassisKey } from "../format";
import type { Day, Group, Line } from "../types";

const TAGS = ["BEKLEMEDE", "BEKLEYECEK", "SAT", "ARIZALI", "BİZİM", "BEKLET"] as const;

type DragItem = { type: "line" | "group"; groupId: number; lineId?: number };

type BoardProps = {
  day: Day;
  plates: string[];
  query: string;
  selected: number[];
  highlightLine: number | null;
  onToggle: (id: number) => void;
  onChange: (day: Day) => void;
  onError: (message: string) => void;
};

function groupDragId(id: number) {
  return `group-${id}`;
}

function lineDragId(id: number) {
  return `line-${id}`;
}

const TAG_CLASS: Record<(typeof TAGS)[number], string> = {
  BEKLEMEDE: "tag-wait",
  BEKLEYECEK: "tag-wait",
  BEKLET: "tag-wait",
  SAT: "tag-sold",
  ARIZALI: "tag-broken",
  BİZİM: "tag-ours",
};

function noteClass(note: string) {
  const upper = note.trim().toLocaleUpperCase("tr-TR");
  const tag = TAGS.find((item) => upper === item || upper.startsWith(`${item} `) || upper.startsWith(`${item} ·`));
  return tag ? TAG_CLASS[tag] : "";
}

function centersClose(event: DragEndEvent | DragOverEvent) {
  const translated = event.active.rect.current.translated;
  const overRect = event.over?.rect;
  if (!translated || !overRect) return false;
  const activeCenter = translated.top + translated.height / 2;
  const overCenter = overRect.top + overRect.height / 2;
  return Math.abs(activeCenter - overCenter) < overRect.height * 0.4;
}

export function Board({ day, plates, query, selected, highlightLine, onToggle, onChange, onError }: BoardProps) {
  const [active, setActive] = useState<DragItem | null>(null);
  const [combineId, setCombineId] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const duplicates = new Set(day.duplicateChassis.map((item) => item.toLocaleUpperCase("tr-TR")));
  const needle = query.trim().toLocaleLowerCase("tr-TR");

  async function run(work: Promise<Day>) {
    try {
      onChange(await work);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Kaydedilemedi");
    }
  }

  function locate(lineId: number) {
    for (const group of day.groups) {
      const line = group.lines.find((item) => item.id === lineId);
      if (line) return { group, line };
    }
    return null;
  }

  function onDragStart(event: DragStartEvent) {
    setActive(event.active.data.current as DragItem);
  }

  function onDragOver(event: DragOverEvent) {
    const source = event.active.data.current as DragItem | undefined;
    const target = event.over?.data.current as DragItem | undefined;
    if (!source || !target || source.type !== "line" || target.type !== "line" || !target.lineId) {
      setCombineId(null);
      return;
    }
    const from = day.groups.find((group) => group.id === source.groupId);
    const to = day.groups.find((group) => group.id === target.groupId);
    const canCombine = Boolean(from && to && !from.plate && !to.plate && centersClose(event));
    setCombineId(canCombine ? target.lineId : null);
  }

  async function onDragEnd(event: DragEndEvent) {
    const source = event.active.data.current as DragItem | undefined;
    const target = event.over?.data.current as DragItem | undefined;
    setActive(null);
    setCombineId(null);
    if (!source || !target || event.active.id === event.over?.id) return;

    if (source.type === "group") {
      const ids = day.groups.map((group) => group.id);
      const from = ids.indexOf(source.groupId);
      const to = ids.indexOf(target.groupId);
      if (from < 0 || to < 0 || from === to) return;
      const index = arrayMove(ids, from, to).indexOf(source.groupId);
      await run(api.moveGroup(source.groupId, index));
      return;
    }

    if (!source.lineId) return;
    const fromGroup = day.groups.find((group) => group.id === source.groupId);
    const toGroup = day.groups.find((group) => group.id === target.groupId);
    if (!fromGroup || !toGroup) return;

    if (target.type === "line" && target.lineId && !fromGroup.plate && !toGroup.plate && centersClose(event)) {
      const alone = fromGroup.id === toGroup.id && fromGroup.lines.length <= 2;
      if (!alone) {
        await run(api.regroup([source.lineId, target.lineId], toGroup.id));
        return;
      }
    }

    if (target.type === "line" && target.lineId) {
      const destinationIds = toGroup.lines.map((line) => line.id);
      let index = destinationIds.indexOf(target.lineId);
      if (fromGroup.id === toGroup.id) {
        index = arrayMove(destinationIds, destinationIds.indexOf(source.lineId), index).indexOf(source.lineId);
      }
      await run(api.moveLine(source.lineId, toGroup.id, index));
      return;
    }

    await run(api.moveLine(source.lineId, toGroup.id, toGroup.lines.length));
  }

  const activeLine = active?.lineId ? locate(active.lineId)?.line : null;

  useEffect(() => {
    if (!highlightLine) return;
    document.querySelector(`[data-line-id="${highlightLine}"]`)?.scrollIntoView({ block: "center" });
  }, [highlightLine, day.date]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        setCombineId(null);
      }}
    >
      {day.groups.length === 0 ? (
        <p className="empty">Bu günde sevk satırı yok. Satır ekleyerek başlayın.</p>
      ) : (
        <SortableContext items={day.groups.map((group) => groupDragId(group.id))} strategy={verticalListSortingStrategy}>
          <div className="board">
            {day.groups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                needle={needle}
                duplicates={duplicates}
                selected={selected}
                highlightLine={highlightLine}
                combineId={combineId}
                onToggle={onToggle}
                onCommitGroup={(patch) => run(api.updateGroup(group.id, patch))}
                onCommitLine={(lineId, patch) => run(api.updateLine(lineId, patch))}
                onDeleteGroup={() => {
                  if (!window.confirm("Araç grubu ve içindeki satırlar silinsin mi?")) return;
                  void run(api.deleteGroup(group.id));
                }}
                onDeleteLine={(line) => {
                  if ((line.model || line.chassis) && !window.confirm("Satır silinsin mi?")) return;
                  void run(api.deleteLine(line.id));
                }}
                onAddLine={() => run(api.createLine(group.id))}
              />
            ))}
          </div>
        </SortableContext>
      )}
      <datalist id="plates">
        {plates.map((plate) => <option key={plate} value={plate} />)}
      </datalist>
      <datalist id="carriers">
        <option value="EGE" />
      </datalist>
      <p className="hint">
        Tutamacı sürükleyerek sırayı değiştirin. Atanmamış iki satırı üst üste bırakınca yeni araç grubu açılır.
        Plaka, nakliyeci ve fiyat gruba bir kez yazılır.
      </p>
      <DragOverlay>
        {activeLine ? (
          <div className="drag-preview">
            <strong>{activeLine.model || "Yeni satır"}</strong>
            <span>{activeLine.chassis}</span>
            <span>{activeLine.destination}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function GroupCard({
  group,
  needle,
  duplicates,
  selected,
  highlightLine,
  combineId,
  onToggle,
  onCommitGroup,
  onCommitLine,
  onDeleteGroup,
  onDeleteLine,
  onAddLine,
}: {
  group: Group;
  needle: string;
  duplicates: Set<string>;
  selected: number[];
  highlightLine: number | null;
  combineId: number | null;
  onToggle: (id: number) => void;
  onCommitGroup: (patch: Record<string, unknown>) => void;
  onCommitLine: (lineId: number, patch: Record<string, unknown>) => void;
  onDeleteGroup: () => void;
  onDeleteLine: (line: Line) => void;
  onAddLine: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: groupDragId(group.id),
    data: { type: "group", groupId: group.id } satisfies DragItem,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const assigned = Boolean(group.plate);

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={assigned ? "group assigned" : "group unassigned"}
      data-group-id={group.id}
      data-plate={group.plate}
    >
      <div className="group-head">
        <div className="grip" {...attributes} {...listeners} aria-label="Araç grubunu taşı" />
        <span className={assigned ? "badge assigned" : "badge"}>{assigned ? "Araç" : "Atanmamış"}</span>
        <CommitInput
          className="plate"
          value={group.plate}
          placeholder="Plaka"
          ariaLabel="Plaka"
          listId="plates"
          onCommit={(value) => onCommitGroup({ plate: value })}
        />
        <CommitInput
          className="carrier"
          value={group.carrier}
          placeholder="Nakliyeci"
          ariaLabel="Nakliyeci"
          listId="carriers"
          onCommit={(value) => onCommitGroup({ carrier: value })}
        />
        <CommitInput
          className="price"
          value={group.price == null ? "" : String(group.price)}
          placeholder="Fiyat"
          ariaLabel="Fiyat"
          inputMode="decimal"
          onCommit={(value) => onCommitGroup({ price: value.trim() === "" ? null : value })}
        />
        <CommitInput
          className="group-note"
          value={group.note}
          placeholder="Grup notu"
          ariaLabel="Grup notu"
          onCommit={(value) => onCommitGroup({ note: value })}
        />
        <span className="count">{group.lines.length}</span>
        <button type="button" className="icon danger" onClick={onDeleteGroup} aria-label="Grubu sil">
          Sil
        </button>
      </div>
      <SortableContext items={group.lines.map((line) => lineDragId(line.id))} strategy={verticalListSortingStrategy}>
        <div className="lines">
          {group.lines.length === 0 && <p className="muted">Bu grupta traktör yok.</p>}
          {group.lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              groupId={group.id}
              needle={needle}
              duplicate={duplicates.has(chassisKey(line.chassis))}
              selected={selected.includes(line.id)}
              highlighted={highlightLine === line.id}
              combining={combineId === line.id}
              onToggle={() => onToggle(line.id)}
              onCommit={(patch) => onCommitLine(line.id, patch)}
              onDelete={() => onDeleteLine(line)}
            />
          ))}
        </div>
      </SortableContext>
      <button type="button" className="add-line" onClick={onAddLine}>+ Satır</button>
    </section>
  );
}

function LineRow({
  line,
  groupId,
  needle,
  duplicate,
  selected,
  highlighted,
  combining,
  onToggle,
  onCommit,
  onDelete,
}: {
  line: Line;
  groupId: number;
  needle: string;
  duplicate: boolean;
  selected: boolean;
  highlighted: boolean;
  combining: boolean;
  onToggle: () => void;
  onCommit: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lineDragId(line.id),
    data: { type: "line", groupId, lineId: line.id } satisfies DragItem,
  });
  const haystack = `${line.model} ${line.chassis} ${line.destination} ${line.note}`.toLocaleLowerCase("tr-TR");
  const matched = needle.length >= 2 && haystack.includes(needle);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={["line", matched ? "is-match" : "", highlighted ? "is-highlight" : "", combining ? "is-combine" : ""].filter(Boolean).join(" ")}
      data-line-id={line.id}
    >
      <div className="grip" {...attributes} {...listeners} aria-label="Satırı taşı" />
      <input type="checkbox" checked={selected} onChange={onToggle} aria-label="Satırı seç" />
      <CommitInput className="model" value={line.model} placeholder="Traktör" ariaLabel="Traktör" onCommit={(value) => onCommit({ model: value })} />
      <CommitInput
        className={duplicate ? "chassis is-duplicate" : "chassis"}
        value={line.chassis}
        placeholder="Şasi no"
        ariaLabel={duplicate ? "Şasi no, bu günde tekrar ediyor" : "Şasi no"}
        onCommit={(value) => onCommit({ chassis: value })}
      />
      <CommitInput className="destination" value={line.destination} placeholder="İl / ilçe" ariaLabel="Varış" onCommit={(value) => onCommit({ destination: value })} />
      <CommitInput
        className={`note ${noteClass(line.note)}`}
        value={line.note}
        placeholder="Not"
        ariaLabel="Satır notu"
        onCommit={(value) => onCommit({ note: value })}
      />
      <button type="button" className="icon" onClick={onDelete} aria-label="Satırı sil">×</button>
    </div>
  );
}

function CommitInput({
  value,
  onCommit,
  className,
  placeholder,
  ariaLabel,
  listId,
  inputMode,
}: {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel: string;
  listId?: string;
  inputMode?: "decimal";
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return (
    <input
      className={className}
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      list={listId}
      inputMode={inputMode}
      title={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
