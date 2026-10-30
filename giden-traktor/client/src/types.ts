export type Line = {
  id: number;
  sortOrder: number;
  model: string;
  chassis: string;
  destination: string;
  note: string;
};

export type Group = {
  id: number;
  sortOrder: number;
  plate: string;
  carrier: string;
  price: number | null;
  note: string;
  lines: Line[];
};

export type Day = {
  id: number;
  date: string;
  groups: Group[];
  duplicateChassis: string[];
};

export type DaySummary = {
  date: string;
  groupCount: number;
  tractorCount: number;
};

export type SearchHit = {
  date: string;
  groupId: number;
  plate: string;
  lineId: number;
  model: string;
  chassis: string;
  destination: string;
  note: string;
};
