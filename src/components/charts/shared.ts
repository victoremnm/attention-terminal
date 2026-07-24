export const CHART_PALETTE = [
  "var(--cyan)",
  "var(--mag)",
  "var(--amber)",
  "var(--blue)",
  "var(--emerald)",
  "#a855f7",
  "#ec4899",
];

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toLocaleString();
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function humanizeKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

export function parseDateLike(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

export function getLabel(row: Record<string, unknown>, fallback: string) {
  const preferred = ["label", "name", "actor", "subject", "category", "task", "region", "id"];
  for (const key of preferred) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  for (const value of Object.values(row)) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export function getStringFields(row: Record<string, unknown>, exclude: string[] = []) {
  return Object.entries(row)
    .filter(([key, value]) => !exclude.includes(key) && typeof value === "string" && value.trim().length > 0)
    .map(([key]) => key);
}

export function getNumericFields(row: Record<string, unknown>, exclude: string[] = []) {
  return Object.entries(row)
    .filter(([key, value]) => !exclude.includes(key) && typeof value === "number" && Number.isFinite(value))
    .map(([key]) => key);
}

export function getParsableDateFields(row: Record<string, unknown>, exclude: string[] = []) {
  return Object.entries(row)
    .filter(([key, value]) => !exclude.includes(key) && parseDateLike(value) !== null)
    .map(([key]) => key);
}

