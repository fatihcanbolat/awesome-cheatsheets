import type { Day, DaySummary, SearchHit } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : "İstek başarısız";
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  days: () => request<DaySummary[]>("/api/days"),
  day: (date: string) => request<Day>(`/api/days/${date}`),
  createDay: (date: string) => request<Day>("/api/days", { method: "POST", body: JSON.stringify({ date }) }),
  createGroup: (date: string) => request<Day>(`/api/days/${date}/groups`, { method: "POST", body: JSON.stringify({}) }),
  updateGroup: (id: number, patch: Record<string, unknown>) =>
    request<Day>(`/api/groups/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteGroup: (id: number) => request<Day>(`/api/groups/${id}`, { method: "DELETE" }),
  createLine: (groupId: number) => request<Day>(`/api/groups/${groupId}/lines`, { method: "POST", body: JSON.stringify({}) }),
  updateLine: (id: number, patch: Record<string, unknown>) =>
    request<Day>(`/api/lines/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteLine: (id: number) => request<Day>(`/api/lines/${id}`, { method: "DELETE" }),
  moveLine: (lineId: number, toGroupId: number, index: number) =>
    request<Day>("/api/reorder", { method: "POST", body: JSON.stringify({ kind: "line", lineId, toGroupId, index }) }),
  moveGroup: (groupId: number, index: number) =>
    request<Day>("/api/reorder", { method: "POST", body: JSON.stringify({ kind: "group", groupId, index }) }),
  regroup: (lineIds: number[], afterGroupId: number) =>
    request<Day>("/api/reorder", { method: "POST", body: JSON.stringify({ kind: "regroup", lineIds, afterGroupId }) }),
  copyLines: (lineIds: number[], toDate: string) =>
    request<Day>("/api/lines/copy", { method: "POST", body: JSON.stringify({ lineIds, toDate }) }),
  search: (q: string) => request<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  plates: () => request<string[]>("/api/plates"),
};
