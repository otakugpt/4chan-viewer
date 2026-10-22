export const SOURCE_IDS: readonly BoardSource[] = ["4chan", "5ch", "v2ex", "ptt", "2333chan", "komica", "lainchan"];
export const sources: Record<BoardSource, { label: string; enabled: boolean }> = {
  "4chan": { label: "4chan", enabled: true },
  "5ch": { label: "5ch", enabled: true },
  v2ex: { label: "V2EX", enabled: true },
  ptt: { label: "PTT", enabled: true },
  "2333chan": { label: "2333chan", enabled: true },
  komica: { label: "Komica", enabled: true },
  lainchan: { label: "Lainchan", enabled: true },
};
export const isImageboardSource = (value: unknown): value is ImageboardSource => value === "2333chan" || value === "komica" || value === "lainchan";
export const enabledSources = SOURCE_IDS.filter(source => sources[source].enabled);
export const isSource = (value: unknown): value is BoardSource => typeof value === "string" && SOURCE_IDS.includes(value as BoardSource);
const reserved = new Set(["__proto__", "prototype", "constructor"]);
export function validBoard(source: BoardSource, value: unknown): value is string {
  if (!isSource(source) || typeof value !== "string" || reserved.has(value)) return false;
  return (source === "ptt" || source === "v2ex" ? /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/ : /^[A-Za-z0-9_]{1,32}$/).test(value);
}
export function normalizeThreadId(source: BoardSource, value: unknown): ThreadId | null {
  if (!isSource(source)) return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0 || source === "ptt") return null;
    value = String(value);
  }
  if (typeof value !== "string") return null;
  if (source === "ptt") return /^[MG]\.\d{1,16}\.A\.[A-Fa-f0-9]{3}$/.test(value) ? value : null;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return null;
  if (source === "5ch" && !/^\d{9,13}$/.test(value)) return null;
  return value;
}
export function validThreadKey(source: BoardSource, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return parts.length === 2 && validBoard(source, parts[0]) && normalizeThreadId(source, parts[1]) !== null;
}
export function validPostId(value: unknown): value is PostId {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value) && !reserved.has(value);
}
