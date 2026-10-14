import { useSyncExternalStore } from "react";
import { SOURCE_IDS, enabledSources, isSource, sources, normalizeThreadId, validBoard, validThreadKey, validPostId } from "./sources";
export type Reading = { post: number; postId: PostId | null; order: number | null; scroll: number; updated: number };
export type ThreadMeta = { title: string; added: number };
type Library = {
  version: 3; boards: string[]; threads: string[]; reads: Record<string, Reading>;
  history: Record<string, number>; metadata: Record<string, ThreadMeta>; boardNames: Record<string, string>;
  filters: { ids: string[]; words: string[] };
  last: { board: string; thread: ThreadId | null } | null;
};
const KEY = "4chan-viewer.library.v1";
const V2_KEY = "rift.library.v2";
export const LIBRARY_KEY = "rift.library.v3";
const cleanTitle = (value: unknown) => typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300) : "";
const time = (value: unknown): number => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const empty = (): Library => ({ version: 3, boards: [], threads: [], reads: {}, history: {}, metadata: {}, boardNames: {}, filters: { ids: [], words: [] }, last: null });
export function parseLibrary(raw: string | null, source: BoardSource = "4chan"): Library {
  try {
    const data = JSON.parse(raw ?? "null");
    if (![1, 2, 3].includes(data?.version)) return empty();
    const strings = (value: unknown, valid: (v: string) => boolean): string[] => Array.isArray(value)
      ? [...new Set(value.filter((v): v is string => typeof v === "string" && valid(v)))].slice(0, 200) : [];
    const threads = strings(data.threads, v => validThreadKey(source, v));
    const history: Record<string, number> = {};
    const legacyHistory = Object.fromEntries(Object.entries(data.reads ?? {}).map(([key, r]) => [key, (r as Reading)?.updated]));
    for (const [key, value] of Object.entries(data.version === 1 ? legacyHistory : data.history ?? {}).reverse().filter(([key, value]) => validThreadKey(source, key) && time(value) > 0).sort((a, b) => time(b[1]) - time(a[1])).slice(0, 500)) history[key] = time(value);
    const reads: Record<string, Reading> = {};
    for (const [key, value] of Object.entries(data.reads ?? {}).slice(-700)) {
      const r = value as Reading;
      if (validThreadKey(source, key) && (history[key] || threads.includes(key)) && r && Number.isSafeInteger(r.post) && r.post >= 0 && Number.isFinite(r.scroll) && r.scroll >= 0 && Number.isFinite(r.updated)) reads[key] = { post: r.post, postId: validPostId(r.postId) ? r.postId : null, order: Number.isSafeInteger(r.order) && r.order > 0 ? r.order : null, scroll: r.scroll, updated: r.updated };
    }
    const metadata: Record<string, ThreadMeta> = {};
    for (const key of new Set([...threads, ...Object.keys(history)])) {
      metadata[key] = { title: cleanTitle(data.metadata?.[key]?.title), added: time(data.metadata?.[key]?.added) };
    }
    const boardNames: Record<string, string> = {};
    for (const [key, value] of Object.entries(data.boardNames ?? {}).slice(0, 2000)) if (validBoard(source, key)) boardNames[key] = cleanTitle(value);
    const last = data.last;
    return { version: 3, boards: strings(data.boards, v => validBoard(source, v)), threads, reads, history, metadata, boardNames,
      filters: { ids: strings(data.filters?.ids, v => /^.{1,128}$/.test(v)).slice(0, 50), words: strings(data.filters?.words, v => /^.{1,128}$/.test(v)).slice(0, 50) },
      last: last && validBoard(source, last.board) && (last.thread === null || normalizeThreadId(source, last.thread) !== null) ? { board: last.board, thread: last.thread === null ? null : normalizeThreadId(source, last.thread) } : null };
  } catch { return empty(); }
}
type Libraries = { version: 3; currentSource: BoardSource; sites: Record<BoardSource, Library>; historyEnabled: boolean; boardOrder: string[]; storageError: string };
const emptySites = () => Object.fromEntries(SOURCE_IDS.map(site => [site, empty()])) as Record<BoardSource, Library>;
let state: Libraries = { version: 3, currentSource: "4chan", sites: emptySites(), historyEnabled: true, boardOrder: [], storageError: "" };
let storageLocked = false;
try {
  const modern = localStorage.getItem(LIBRARY_KEY);
  const raw = modern ?? localStorage.getItem(V2_KEY);
  const saved = raw ? JSON.parse(raw) : null;
  if (raw !== null && (![2, 3].includes(saved?.version) || !saved.sites || (modern !== null && saved.version !== 3))) throw new Error("Unsupported library");
  if (saved) {
    if (typeof saved.sites !== "object" || Array.isArray(saved.sites) || SOURCE_IDS.some(site => saved.sites[site] !== undefined && ![1, 2, 3].includes(saved.sites[site]?.version))) throw new Error("Unsupported site library");
    state = { ...state, currentSource: isSource(saved.currentSource) && sources[saved.currentSource].enabled ? saved.currentSource : "4chan", historyEnabled: saved.historyEnabled !== false,
      boardOrder: Array.isArray(saved.boardOrder) ? [...new Set<string>(saved.boardOrder.filter((v: unknown) => {
        if (typeof v !== "string") return false;
        const [site, board, extra] = v.split("/");
        return extra === undefined && isSource(site) && validBoard(site, board);
      }))].slice(0, SOURCE_IDS.length * 200) : [],
      sites: Object.fromEntries(SOURCE_IDS.map(site => [site, parseLibrary(JSON.stringify(saved.sites[site]), site)])) as Record<BoardSource, Library> };
  } else {
    const legacy = localStorage.getItem(KEY);
    if (legacy !== null && ![1, 2].includes(JSON.parse(legacy)?.version)) throw new Error("Unsupported legacy library");
    state.sites["4chan"] = parseLibrary(legacy);
  }
} catch {
  storageLocked = true;
  state.storageError = "閲覧データを読み込めません。元データを保護するため、保存を停止しています。";
}
const listeners = new Set<() => void>();
let clearEpoch = 0, historyEpoch = 0, generation = 0;
const deletedEpochs = new Map<string, number>();
export const getClearEpoch = () => clearEpoch;
export const getHistoryEpoch = (source?: BoardSource, key?: string) => Math.max(historyEpoch, deletedEpochs.get(source + "/" + key) ?? 0);
function persist() {
  let success = false;
  try {
    if (storageLocked) throw new Error("Storage is protected");
    const { storageError: _error, ...data } = state;
    const raw = JSON.stringify(data);
    localStorage.setItem(LIBRARY_KEY, raw);
    if (localStorage.getItem(LIBRARY_KEY) !== raw) throw new Error("Storage verification failed");
    state = { ...state, storageError: "" }; success = true;
  } catch { state = { ...state, storageError: "閲覧データを保存できません。旧データは削除していません。空き容量や保存領域を確認してください。" }; }
  listeners.forEach(fn => fn());
  return success;
}
function publish(next: Library, source: BoardSource) {
  state = { ...state, sites: { ...state.sites, [source]: next } }; persist();
}
export const getSource = () => state.currentSource;
export function selectSource(source: BoardSource) { if (isSource(source) && sources[source].enabled) { state = { ...state, currentSource: source }; persist(); } }
export const getLibrary = (source: BoardSource = "4chan") => state.sites[source];
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useLibrary = (source: BoardSource = "4chan") => useSyncExternalStore(subscribe, () => getLibrary(source));
export const useLibraries = () => useSyncExternalStore(subscribe, () => state);
export function toggleFavorite(kind: "boards" | "threads", key: string, source: BoardSource = "4chan", title = "") {
  if (!(kind === "boards" ? validBoard(source, key) : validThreadKey(source, key))) return;
  const current = getLibrary(source);
  const removing = current[kind].includes(key);
  const next = { ...current, [kind]: removing ? current[kind].filter(x => x !== key) : [key, ...current[kind]].slice(0, 200) };
  if (kind === "threads" && !removing) next.metadata = { ...current.metadata, [key]: { title: cleanTitle(title) || current.metadata[key]?.title || "", added: Date.now() } };
  publish(parseLibrary(JSON.stringify(next), source), source);
}
export function rememberSelection(board: string, thread: ThreadId | number | null, source: BoardSource = "4chan") {
  const id = thread === null ? null : normalizeThreadId(source, thread);
  if (!validBoard(source, board) || (thread !== null && id === null)) return;
  publish({ ...getLibrary(source), last: { board, thread: id } }, source);
}
export function rememberBoards(boards: BoardInfo[], source: BoardSource) {
  const current = getLibrary(source), names = { ...current.boardNames };
  for (const b of boards.slice(0, 2000)) if (validBoard(source, b.board)) names[b.board] = cleanTitle(b.title);
  publish({ ...current, boardNames: Object.fromEntries(Object.entries(names).slice(-2000)) }, source);
}
export function rememberTitles(threads: { threadId: ThreadId; sub?: string }[], board: string, source: BoardSource) {
  const current = getLibrary(source), metadata = { ...current.metadata };
  let changed = false;
  for (const t of threads) {
    const key = board + "/" + t.threadId, title = cleanTitle(t.sub);
    if (title && (current.threads.includes(key) || current.history[key]) && metadata[key]?.title !== title) {
      metadata[key] = { title, added: metadata[key]?.added ?? 0 }; changed = true;
    }
  }
  if (changed) publish({ ...current, metadata }, source);
}
export function recordVisit(key: string, source: BoardSource, title = "", epoch = getHistoryEpoch(source, key)) {
  if (!validThreadKey(source, key) || epoch !== getHistoryEpoch(source, key)) return;
  const current = getLibrary(source);
  const metadata = { ...current.metadata, [key]: { title: cleanTitle(title) || current.metadata[key]?.title || "", added: current.metadata[key]?.added ?? 0 } };
  const history = { ...current.history };
  if (state.historyEnabled) { delete history[key]; history[key] = Date.now(); }
  publish(parseLibrary(JSON.stringify({ ...current, metadata, history }), source), source);
}
export function rememberReading(key: string, post: number, scroll: number, source: BoardSource = "4chan", anchor?: { postId: PostId; order: number }) {
  const current = getLibrary(source);
  if (!state.historyEnabled || !current.history[key] || !Number.isSafeInteger(post) || post < 0 || !Number.isFinite(scroll) || scroll < 0) return;
  const previous = current.reads[key];
  const valid = anchor && validPostId(anchor.postId) && Number.isSafeInteger(anchor.order) && anchor.order > 0;
  const position = valid && anchor.order >= (previous?.order ?? 0) ? anchor : { postId: previous?.postId ?? null, order: previous?.order ?? null };
  publish({ ...current, reads: { ...current.reads, [key]: { post: Math.max(previous?.post ?? 0, post), ...position, scroll, updated: Date.now() } } }, source);
}
export function deleteHistory(source?: BoardSource, key?: string) {
  if (source && key) deletedEpochs.set(source + "/" + key, ++generation);
  else { historyEpoch = ++generation; deletedEpochs.clear(); }
  for (const site of SOURCE_IDS) {
    if (source && site !== source) continue;
    const current = getLibrary(site), history = { ...current.history }, reads = { ...current.reads };
    for (const id of key ? [key] : Object.keys(history)) { delete history[id]; delete reads[id]; }
    state = { ...state, sites: { ...state.sites, [site]: parseLibrary(JSON.stringify({ ...current, history, reads }), site) } };
  }
  persist();
}
export function setHistoryEnabled(enabled: boolean) { historyEpoch = ++generation; deletedEpochs.clear(); state = { ...state, historyEnabled: enabled }; persist(); }
export function favoriteBoards() {
  const keys = enabledSources.flatMap(site => state.sites[site].boards.map(board => site + "/" + board));
  return [...state.boardOrder.filter(key => keys.includes(key)), ...keys.filter(key => !state.boardOrder.includes(key))];
}
export function moveBoard(key: string, direction: number) {
  const order = favoriteBoards(), index = order.indexOf(key), next = index + direction;
  if (index < 0 || next < 0 || next >= order.length) return;
  [order[index], order[next]] = [order[next], order[index]];
  state = { ...state, boardOrder: order }; persist();
}
export function setFilters(filters: Library["filters"], source: BoardSource) { publish(parseLibrary(JSON.stringify({ ...getLibrary(source), filters }), source), source); }
export function clearLibrary() {
  clearEpoch++; historyEpoch = ++generation; deletedEpochs.clear();
  storageLocked = false;
  state = { ...state, boardOrder: [], sites: emptySites() };
  if (persist()) {
    try { localStorage.removeItem(KEY); localStorage.removeItem(V2_KEY); } catch { /* The current empty snapshot prevents legacy resurrection. */ }
  }
}
export function forgetSelection(source: BoardSource) { publish({ ...getLibrary(source), last: null }, source); }

export function boardName(source: BoardSource, board: string) {
  const name = getLibrary(source).boardNames[board];
  return typeof name === "string" && name ? name : board;
}
