import { useSyncExternalStore } from "react";
export type Reading = { post: number; scroll: number; updated: number };
export type ThreadMeta = { title: string; added: number };
type Library = {
  version: 2; boards: string[]; threads: string[]; reads: Record<string, Reading>;
  history: Record<string, number>; metadata: Record<string, ThreadMeta>; boardNames: Record<string, string>;
  filters: { ids: string[]; words: string[] };
  last: { board: string; thread: number | null } | null;
};
const KEY = "4chan-viewer.library.v1";
const V2_KEY = "rift.library.v2";
const boardPattern = /^[a-zA-Z0-9_]{1,32}$/;
const threadPattern = /^[a-zA-Z0-9_]{1,32}\/\d+$/;
const cleanTitle = (value: unknown) => typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300) : "";
const time = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const empty = (): Library => ({ version: 2, boards: [], threads: [], reads: {}, history: {}, metadata: {}, boardNames: {}, filters: { ids: [], words: [] }, last: null });
export function parseLibrary(raw: string | null): Library {
  try {
    const data = JSON.parse(raw ?? "null");
    if (![1, 2].includes(data?.version)) return empty();
    const strings = (value: unknown, pattern: RegExp): string[] => Array.isArray(value)
      ? [...new Set(value.filter((v): v is string => typeof v === "string" && pattern.test(v)))].slice(0, 200) : [];
    const threads = strings(data.threads, threadPattern);
    const history: Record<string, number> = {};
    const legacyHistory = Object.fromEntries(Object.entries(data.reads ?? {}).map(([key, r]) => [key, (r as Reading)?.updated]));
    for (const [key, value] of Object.entries(data.version === 1 ? legacyHistory : data.history ?? {}).reverse().filter(([key, value]) => threadPattern.test(key) && time(value) > 0).sort((a, b) => time(b[1]) - time(a[1])).slice(0, 500)) history[key] = time(value);
    const reads: Record<string, Reading> = {};
    for (const [key, value] of Object.entries(data.reads ?? {}).slice(-700)) {
      const r = value as Reading;
      if (threadPattern.test(key) && (history[key] || threads.includes(key)) && r && Number.isSafeInteger(r.post) && r.post >= 0 && Number.isFinite(r.scroll) && r.scroll >= 0 && Number.isFinite(r.updated)) reads[key] = { post: r.post, scroll: r.scroll, updated: r.updated };
    }
    const metadata: Record<string, ThreadMeta> = {};
    for (const key of new Set([...threads, ...Object.keys(history)])) {
      metadata[key] = { title: cleanTitle(data.metadata?.[key]?.title), added: time(data.metadata?.[key]?.added) };
    }
    const boardNames: Record<string, string> = {};
    for (const [key, value] of Object.entries(data.boardNames ?? {}).slice(0, 2000)) if (boardPattern.test(key)) boardNames[key] = cleanTitle(value);
    const last = data.last;
    return { version: 2, boards: strings(data.boards, boardPattern), threads, reads, history, metadata, boardNames,
      filters: { ids: strings(data.filters?.ids, /^.{1,128}$/).slice(0, 50), words: strings(data.filters?.words, /^.{1,128}$/).slice(0, 50) },
      last: last && typeof last.board === "string" && boardPattern.test(last.board) && (last.thread === null || (Number.isSafeInteger(last.thread) && last.thread > 0)) ? { board: last.board, thread: last.thread } : null };
  } catch { return empty(); }
}
type Libraries = { version: 2; currentSource: BoardSource; sites: Record<BoardSource, Library>; historyEnabled: boolean; boardOrder: string[] };
let state: Libraries = { version: 2, currentSource: "4chan", sites: { "4chan": empty(), "5ch": empty() }, historyEnabled: true, boardOrder: [] };
try {
  const raw = localStorage.getItem(V2_KEY);
  const saved = raw ? JSON.parse(raw) : null;
  if (saved?.version === 2) {
    state = { ...state, currentSource: saved.currentSource === "5ch" ? "5ch" : "4chan", historyEnabled: saved.historyEnabled !== false,
      boardOrder: Array.isArray(saved.boardOrder) ? [...new Set<string>(saved.boardOrder.filter((v: unknown) => typeof v === "string" && /^(4chan|5ch)\/[a-zA-Z0-9_]{1,32}$/.test(v)))].slice(0, 400) : [],
      sites: { "4chan": parseLibrary(JSON.stringify(saved.sites?.["4chan"])), "5ch": parseLibrary(JSON.stringify(saved.sites?.["5ch"])) } };
  } else state.sites["4chan"] = parseLibrary(localStorage.getItem(KEY));
} catch { /* Corrupt or unavailable storage must not prevent startup. */ }
const listeners = new Set<() => void>();
let clearEpoch = 0, historyEpoch = 0, generation = 0;
const deletedEpochs = new Map<string, number>();
export const getClearEpoch = () => clearEpoch;
export const getHistoryEpoch = (source?: BoardSource, key?: string) => Math.max(historyEpoch, deletedEpochs.get(source + "/" + key) ?? 0);
function persist() {
  try { localStorage.setItem(V2_KEY, JSON.stringify(state)); } catch { /* Browsing remains available. */ }
  listeners.forEach(fn => fn());
}
function publish(next: Library, source: BoardSource) {
  state = { ...state, sites: { ...state.sites, [source]: next } }; persist();
}
export const getSource = () => state.currentSource;
export function selectSource(source: BoardSource) { state = { ...state, currentSource: source }; persist(); }
export const getLibrary = (source: BoardSource = "4chan") => state.sites[source];
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useLibrary = (source: BoardSource = "4chan") => useSyncExternalStore(subscribe, () => getLibrary(source));
export const useLibraries = () => useSyncExternalStore(subscribe, () => state);
export function toggleFavorite(kind: "boards" | "threads", key: string, source: BoardSource = "4chan", title = "") {
  if (!(kind === "boards" ? boardPattern : threadPattern).test(key)) return;
  const current = getLibrary(source);
  const removing = current[kind].includes(key);
  const next = { ...current, [kind]: removing ? current[kind].filter(x => x !== key) : [key, ...current[kind]].slice(0, 200) };
  if (kind === "threads" && !removing) next.metadata = { ...current.metadata, [key]: { title: cleanTitle(title) || current.metadata[key]?.title || "", added: Date.now() } };
  publish(parseLibrary(JSON.stringify(next)), source);
}
export function rememberSelection(board: string, thread: number | null, source: BoardSource = "4chan") { publish({ ...getLibrary(source), last: { board, thread } }, source); }
export function rememberBoards(boards: BoardInfo[], source: BoardSource) {
  const current = getLibrary(source), names = { ...current.boardNames };
  for (const b of boards.slice(0, 2000)) if (boardPattern.test(b.board)) names[b.board] = cleanTitle(b.title);
  publish({ ...current, boardNames: Object.fromEntries(Object.entries(names).slice(-2000)) }, source);
}
export function rememberTitles(threads: { no: number; sub?: string }[], board: string, source: BoardSource) {
  const current = getLibrary(source), metadata = { ...current.metadata };
  let changed = false;
  for (const t of threads) {
    const key = board + "/" + t.no, title = cleanTitle(t.sub);
    if (title && (current.threads.includes(key) || current.history[key]) && metadata[key]?.title !== title) {
      metadata[key] = { title, added: metadata[key]?.added ?? 0 }; changed = true;
    }
  }
  if (changed) publish({ ...current, metadata }, source);
}
export function recordVisit(key: string, source: BoardSource, title = "", epoch = getHistoryEpoch(source, key)) {
  if (!threadPattern.test(key) || epoch !== getHistoryEpoch(source, key)) return;
  const current = getLibrary(source);
  const metadata = { ...current.metadata, [key]: { title: cleanTitle(title) || current.metadata[key]?.title || "", added: current.metadata[key]?.added ?? 0 } };
  const history = { ...current.history };
  if (state.historyEnabled) { delete history[key]; history[key] = Date.now(); }
  publish(parseLibrary(JSON.stringify({ ...current, metadata, history })), source);
}
export function rememberReading(key: string, post: number, scroll: number, source: BoardSource = "4chan") {
  const current = getLibrary(source);
  if (!state.historyEnabled || !current.history[key] || !Number.isSafeInteger(post) || post < 0 || !Number.isFinite(scroll) || scroll < 0) return;
  publish({ ...current, reads: { ...current.reads, [key]: { post: Math.max(current.reads[key]?.post ?? 0, post), scroll, updated: Date.now() } } }, source);
}
export function deleteHistory(source?: BoardSource, key?: string) {
  if (source && key) deletedEpochs.set(source + "/" + key, ++generation);
  else { historyEpoch = ++generation; deletedEpochs.clear(); }
  for (const site of ["4chan", "5ch"] as BoardSource[]) {
    if (source && site !== source) continue;
    const current = getLibrary(site), history = { ...current.history }, reads = { ...current.reads };
    for (const id of key ? [key] : Object.keys(history)) { delete history[id]; delete reads[id]; }
    state = { ...state, sites: { ...state.sites, [site]: parseLibrary(JSON.stringify({ ...current, history, reads })) } };
  }
  persist();
}
export function setHistoryEnabled(enabled: boolean) { historyEpoch = ++generation; deletedEpochs.clear(); state = { ...state, historyEnabled: enabled }; persist(); }
export function favoriteBoards() {
  const keys = (["4chan", "5ch"] as BoardSource[]).flatMap(site => state.sites[site].boards.map(board => site + "/" + board));
  return [...state.boardOrder.filter(key => keys.includes(key)), ...keys.filter(key => !state.boardOrder.includes(key))];
}
export function moveBoard(key: string, direction: number) {
  const order = favoriteBoards(), index = order.indexOf(key), next = index + direction;
  if (index < 0 || next < 0 || next >= order.length) return;
  [order[index], order[next]] = [order[next], order[index]];
  state = { ...state, boardOrder: order }; persist();
}
export function setFilters(filters: Library["filters"], source: BoardSource) { publish(parseLibrary(JSON.stringify({ ...getLibrary(source), filters })), source); }
export function clearLibrary() {
  clearEpoch++; historyEpoch = ++generation; deletedEpochs.clear();
  state = { ...state, boardOrder: [], sites: { "4chan": empty(), "5ch": empty() } };
  try { localStorage.removeItem(KEY); } catch { /* Legacy key may not exist. */ }
  persist();
}
export function forgetSelection(source: BoardSource) { publish({ ...getLibrary(source), last: null }, source); }

export function boardName(source: BoardSource, board: string) {
  const name = getLibrary(source).boardNames[board];
  return typeof name === "string" && name ? name : board;
}
