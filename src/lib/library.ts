import { useSyncExternalStore } from "react";
export type Reading = { post: number; scroll: number; updated: number };
type Library = {
  version: 1; boards: string[]; threads: string[]; reads: Record<string, Reading>;
  filters: { ids: string[]; words: string[] };
  last: { board: string; thread: number | null } | null;
};
const KEY = "4chan-viewer.library.v1";
const boardPattern = /^[a-zA-Z0-9_]{1,32}$/;
const threadPattern = /^[a-zA-Z0-9_]{1,32}\/\d+$/;
const empty = (): Library => ({ version: 1, boards: [], threads: [], reads: {}, filters: { ids: [], words: [] }, last: null });
export function parseLibrary(raw: string | null): Library {
  try {
    const data = JSON.parse(raw ?? "null");
    if (data?.version !== 1) return empty();
    const strings = (value: unknown, pattern: RegExp): string[] => Array.isArray(value)
      ? [...new Set(value.filter((v): v is string => typeof v === "string" && pattern.test(v)))].slice(0, 200) : [];
    const reads: Record<string, Reading> = {};
    for (const [key, value] of Object.entries(data.reads ?? {}).slice(-200)) {
      const r = value as Reading;
      if (threadPattern.test(key) && r && Number.isSafeInteger(r.post) && r.post >= 0 &&
          Number.isFinite(r.scroll) && r.scroll >= 0 && Number.isFinite(r.updated)) reads[key] = r;
    }
    const last = data.last;
    return { version: 1, boards: strings(data.boards, boardPattern), threads: strings(data.threads, threadPattern), reads,
      filters: { ids: strings(data.filters?.ids, /^.{1,128}$/).slice(0, 50), words: strings(data.filters?.words, /^.{1,128}$/).slice(0, 50) },
      last: last && typeof last.board === "string" && boardPattern.test(last.board) &&
        (last.thread === null || (Number.isSafeInteger(last.thread) && last.thread > 0)) ? last : null };
  } catch { return empty(); }
}

const V2_KEY = "rift.library.v2";
type Libraries = { version: 2; currentSource: BoardSource; sites: Record<BoardSource, Library> };
let state: Libraries = { version: 2, currentSource: "4chan", sites: { "4chan": empty(), "5ch": empty() } };
try {
  const raw = localStorage.getItem(V2_KEY);
  const saved = raw ? JSON.parse(raw) : null;
  if (saved?.version === 2) {
    state = { version: 2, currentSource: saved.currentSource === "5ch" ? "5ch" : "4chan", sites: {
      "4chan": parseLibrary(JSON.stringify(saved.sites?.["4chan"])),
      "5ch": parseLibrary(JSON.stringify(saved.sites?.["5ch"])),
    } };
  } else state.sites["4chan"] = parseLibrary(localStorage.getItem(KEY));
} catch { /* Corrupt or unavailable storage must not prevent startup. */ }
const listeners = new Set<() => void>();
let clearEpoch = 0;
export const getClearEpoch = () => clearEpoch;
function persist() {
  try { localStorage.setItem(V2_KEY, JSON.stringify(state)); } catch { /* Browsing remains available. */ }
  listeners.forEach(fn => fn());
}
function publish(next: Library, source: BoardSource) {
  state = { ...state, sites: { ...state.sites, [source]: next } };
  persist();
}
export const getSource = () => state.currentSource;
export function selectSource(source: BoardSource) { state = { ...state, currentSource: source }; persist(); }
export const getLibrary = (source: BoardSource = "4chan") => state.sites[source];
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useLibrary = (source: BoardSource = "4chan") => useSyncExternalStore(subscribe, () => getLibrary(source));
export function toggleFavorite(kind: "boards" | "threads", key: string, source: BoardSource = "4chan") {
  if (!(kind === "boards" ? boardPattern : threadPattern).test(key)) return;
  const current = getLibrary(source);
  publish({ ...current, [kind]: current[kind].includes(key) ? current[kind].filter(x => x !== key) : [key, ...current[kind]].slice(0, 200) }, source);
}
export function rememberSelection(board: string, thread: number | null, source: BoardSource = "4chan") {
  publish({ ...getLibrary(source), last: { board, thread } }, source);
}
export function rememberReading(key: string, post: number, scroll: number, source: BoardSource = "4chan") {
  const current = getLibrary(source);
  const entries = Object.entries(current.reads).filter(([id]) => id !== key).slice(-199);
  publish({ ...current, reads: { ...Object.fromEntries(entries), [key]: { post: Math.max(current.reads[key]?.post ?? 0, post), scroll, updated: Date.now() } } }, source);
}
export function setFilters(filters: Library["filters"], source: BoardSource) {
  publish(parseLibrary(JSON.stringify({ ...getLibrary(source), filters })), source);
}
export function clearLibrary() {
  clearEpoch++;
  state = { ...state, sites: { "4chan": empty(), "5ch": empty() } };
  try { localStorage.removeItem(KEY); } catch { /* Legacy key may not exist. */ }
  persist();
}

export function forgetSelection(source: BoardSource) { publish({ ...getLibrary(source), last: null }, source); }
