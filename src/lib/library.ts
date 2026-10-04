import { useSyncExternalStore } from "react";
export type Reading = { post: number; scroll: number; updated: number };
type Library = {
  version: 1; boards: string[]; threads: string[]; reads: Record<string, Reading>;
  last: { board: string; thread: number | null } | null;
};
const KEY = "4chan-viewer.library.v1";
const boardPattern = /^[a-z0-9]{1,16}$/;
const threadPattern = /^[a-z0-9]{1,16}\/\d+$/;
const empty = (): Library => ({ version: 1, boards: [], threads: [], reads: {}, last: null });
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
      last: last && typeof last.board === "string" && boardPattern.test(last.board) &&
        (last.thread === null || (Number.isSafeInteger(last.thread) && last.thread > 0)) ? last : null };
  } catch { return empty(); }
}
let state: Library;
try { state = parseLibrary(localStorage.getItem(KEY)); } catch { state = empty(); }
const listeners = new Set<() => void>();
let clearEpoch = 0;
export const getClearEpoch = () => clearEpoch;
function publish(next: Library) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Browsing works when storage is unavailable. */ }
  listeners.forEach(fn => fn());
}
export const getLibrary = () => state;
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useLibrary = () => useSyncExternalStore(subscribe, getLibrary);
export function toggleFavorite(kind: "boards" | "threads", key: string) {
  if (!(kind === "boards" ? boardPattern : threadPattern).test(key)) return;
  publish({ ...state, [kind]: state[kind].includes(key) ? state[kind].filter(x => x !== key) : [key, ...state[kind]].slice(0, 200) });
}
export function rememberSelection(board: string, thread: number | null) { publish({ ...state, last: { board, thread } }); }
export function rememberReading(key: string, post: number, scroll: number) {
  const entries = Object.entries(state.reads).filter(([id]) => id !== key).slice(-199);
  publish({ ...state, reads: { ...Object.fromEntries(entries), [key]: { post: Math.max(state.reads[key]?.post ?? 0, post), scroll, updated: Date.now() } } });
}
export function clearLibrary() { clearEpoch++; publish(empty()); }
