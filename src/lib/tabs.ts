export interface ReaderTab { source: BoardSource; board: string; thread: number | null }
export const TAB_KEY = "rift.tabs.v1";
export const MAX_TABS = 20;
export const tabId = (tab: ReaderTab) => `${tab.source}/${tab.board}/${tab.thread ?? "board"}`;
export function parseTabs(raw: string | null): ReaderTab[] {
  try {
    const data = JSON.parse(raw ?? "null");
    if (data?.version !== 1 || !Array.isArray(data.tabs)) return [];
    const result: ReaderTab[] = [];
    for (const tab of data.tabs) {
      if (!tab || !["4chan", "5ch"].includes(tab.source) || typeof tab.board !== "string" || !/^[a-zA-Z0-9_]{1,32}$/.test(tab.board)) continue;
      if (tab.thread !== null && (!Number.isSafeInteger(tab.thread) || tab.thread <= 0 || (tab.source === "5ch" && !/^\d{9,13}$/.test(String(tab.thread))))) continue;
      const clean = { source: tab.source, board: tab.board, thread: tab.thread };
      if (!result.some(item => tabId(item) === tabId(clean))) result.push(clean);
      if (result.length === MAX_TABS) break;
    }
    return result;
  } catch { return []; }
}
export function loadTabs(): ReaderTab[] {
  try { return parseTabs(localStorage.getItem(TAB_KEY)); } catch { return []; }
}
export function saveTabs(tabs: ReaderTab[]) {
  try { localStorage.setItem(TAB_KEY, JSON.stringify({ version: 1, tabs })); } catch { /* Browsing remains available without storage. */ }
}
