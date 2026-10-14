import { isSource, normalizeThreadId, validBoard } from "./sources";
export interface ReaderTab { source: BoardSource; board: string; thread: ThreadId | null }
export const TAB_KEY = "rift.tabs.v2";
export const LEGACY_TAB_KEY = "rift.tabs.v1";
export const MAX_TABS = 20;
export const tabId = (tab: ReaderTab) => `${tab.source}/${tab.board}/${tab.thread ?? "board"}`;
export function parseTabs(raw: string | null): ReaderTab[] {
  try {
    const data = JSON.parse(raw ?? "null");
    if (![1, 2].includes(data?.version) || !Array.isArray(data.tabs)) return [];
    const result: ReaderTab[] = [];
    for (const tab of data.tabs) {
      if (!tab || !isSource(tab.source) || !validBoard(tab.source, tab.board)) continue;
      const thread = tab.thread === null ? null : normalizeThreadId(tab.source, tab.thread);
      if (tab.thread !== null && thread === null) continue;
      const clean = { source: tab.source, board: tab.board, thread };
      if (!result.some(item => tabId(item) === tabId(clean))) result.push(clean);
      if (result.length === MAX_TABS) break;
    }
    return result;
  } catch { return []; }
}
let protectedStorage = false;
export function loadTabs(): ReaderTab[] {
  try {
    const raw = localStorage.getItem(TAB_KEY) ?? localStorage.getItem(LEGACY_TAB_KEY);
    if (raw !== null) {
      const data = JSON.parse(raw);
      if (![1, 2].includes(data?.version) || !Array.isArray(data.tabs)) throw new Error("Invalid tabs");
    }
    return parseTabs(raw);
  } catch { protectedStorage = true; return []; }
}
export function saveTabs(tabs: ReaderTab[]) {
  try {
    if (protectedStorage) return false;
    const raw = JSON.stringify({ version: 2, tabs: parseTabs(JSON.stringify({ version: 2, tabs })) });
    localStorage.setItem(TAB_KEY, raw);
    if (localStorage.getItem(TAB_KEY) !== raw) return false;
    // Only an explicit empty state removes the legacy copy; migration keeps it intact.
    if (!tabs.length) localStorage.removeItem(LEGACY_TAB_KEY);
    return true;
  } catch { return false; }
}
export function clearTabs() {
  protectedStorage = false;
  return saveTabs([]);
}
