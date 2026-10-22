export type ImageboardSource = "2333chan" | "komica" | "lainchan";
export interface ImageboardBoard { board: string; title: string; path: string }

const boards = (entries: [string, string, string?][]): readonly ImageboardBoard[] =>
  Object.freeze(entries.map(([board, title, path]) => Object.freeze({ board, title, path: path ?? board })));

// Deliberately static: unknown boards, mirrors and user-supplied hosts are never discovered.
export const IMAGEBOARD_BOARDS: Readonly<Record<ImageboardSource, readonly ImageboardBoard[]>> = Object.freeze({
  "2333chan": boards([
    ["ayu", "\u516c\u544a\u30fb\u30d8\u30eb\u30d7"], ["mizuka", "mizuka"], ["kotori", "\u7d9c\u54082.1"],
    ["news", "\u901f\u5831"], ["pic", "\u651d\u5f71"], ["saya", "\u4e09\u6b21\u5143\u6b61\u6a02"],
    ["TK", "\u539f\u5275"], ["int", "International"], ["kyousuke", "\u539f\u5275\u30fb\u4e8c\u5275"],
    ["makoto", "\u54f2\u5b78"], ["yumemi", "\u63a8\u6b4c"], ["komari", "\u4e8c\u6b21\u5143\u7d9c\u5408"],
    ["pani", "\u897f\u65b9\u52d5\u756b"], ["kud", "VTuber"], ["akane", "\u5f48\u5e55\u7db2\u7ad9"],
    ["shiori", "\u904a\u6232\u7d9c\u5408"], ["haruka", "STG"], ["mio", "\u5361\u724c\u904a\u6232"], ["kagari", "\u503c\u73ed\u5ba4"],
  ]),
  komica: boards([["00b", "\u7d9c\u5408"]]),
  lainchan: boards([
    ["lambda", "Programming", "\u03bb"], ["delta", "Do it yourself", "\u0394"],
    ["omega", "Technology", "\u03a9"], ["sec", "Security"],
    ["inter", "Games and interactive media"], ["lit", "Literature"],
    ["music", "Music"], ["vis", "Visual media"], ["hum", "Humanity"], ["drug", "Drugs"],
    ["zzz", "Dreams"], ["layer", "Layer"], ["q", "Questions and complaints"], ["r", "Random"],
  ]),
});
export const imageboardBoards = IMAGEBOARD_BOARDS;
export const IMAGEBOARD_ORIGINS: Readonly<Record<ImageboardSource, string>> = Object.freeze({
  "2333chan": "https://x.1145141919810.org", komica: "https://gaia.komica1.org", lainchan: "https://www.lainchan.org",
});
export function isImageboardSource(value: unknown): value is ImageboardSource {
  return value === "2333chan" || value === "komica" || value === "lainchan";
}
export function imageboardBoard(source: ImageboardSource, board: unknown): ImageboardBoard | null {
  return typeof board === "string" && isImageboardSource(source)
    ? IMAGEBOARD_BOARDS[source].find(entry => entry.board === board) ?? null : null;
}
export function validImageboardId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
}
export function validImageboardCursor(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d{0,2})$/.test(value) && Number(value) <= 199;
}
function strictUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 2048 || /[\s\\\x00-\x1f\x7f]/.test(raw) ||
    !/^https:\/\/[a-z0-9.-]+\//.test(raw) || /%(?:2f|5c|2e|25|3f|23|00)/i.test(raw) || /\/\.{1,2}(?:\/|$)/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}
function sourceForHost(host: string): ImageboardSource | null {
  if (host === "gaia.komica1.org") return "komica";
  if (host === "lainchan.org" || host === "www.lainchan.org") return "lainchan";
  if (host === "x.1145141919810.org") return "2333chan";
  return null;
}
export interface ImageboardTarget { source: ImageboardSource; board: string; thread: string | null }
export function parseImageboardUrl(raw: unknown): ImageboardTarget | null {
  const url = strictUrl(raw);
  if (!url) return null;
  const hasFragment = typeof raw === "string" && raw.includes("#");
  const anchor = /^#r?([1-9]\d{0,15})$/.exec(url.hash);
  if (hasFragment && (!anchor || !validImageboardId(anchor[1]))) return null;
  const source = sourceForHost(url.hostname);
  if (!source) return null;
  if (source === "komica") {
    if (url.pathname === "/00b/pixmicat.php" && /^\?res=[1-9]\d{0,15}$/.test(url.search)) {
      const thread = url.search.slice(5);
      return validImageboardId(thread) ? { source, board: "00b", thread } : null;
    }
    return !hasFragment && !url.search && !(typeof raw === "string" && raw.includes("?")) && /^(?:\/00b\/|\/00b\/index\.htm)$/.test(url.pathname)
      ? { source, board: "00b", thread: null } : null;
  }
  if (url.search || (typeof raw === "string" && raw.includes("?"))) return null;
  for (const board of IMAGEBOARD_BOARDS[source]) {
    const base = `/${encodeURIComponent(board.path)}/`;
    if (!hasFragment && (url.pathname === base || url.pathname === base + "index.html" || url.pathname === base + "catalog.html"))
      return { source, board: board.board, thread: null };
    if (url.pathname.startsWith(base + "res/")) {
      const match = url.pathname.slice(base.length).match(/^res\/([1-9]\d{0,15})\.html$/);
      if (match && validImageboardId(match[1])) return { source, board: board.board, thread: match[1] };
    }
  }
  return null;
}
export function imageboardBase(source: ImageboardSource, board: string): string {
  const entry = imageboardBoard(source, board);
  if (!entry) throw new Error("Unsupported imageboard board");
  return `${IMAGEBOARD_ORIGINS[source]}/${encodeURIComponent(entry.path)}/`;
}
function mediaTarget(raw: unknown): { url: string; source: ImageboardSource; board: string } | null {
  const url = strictUrl(raw);
  if (!url || url.search || url.hash || (typeof raw === "string" && /[?#]/.test(raw))) return null;
  const file = "[1-9][0-9]{8,19}(?:-[0-9]{1,8})?";
  const extension = "\\.(?:jpg|jpeg|png|gif|webp)";
  if (url.hostname === "gita-pix.komica1.org" &&
    new RegExp(`^/(?:src/${file}|thumb/${file}s?)${extension}$`).test(url.pathname))
    return { url: url.href, source: "komica", board: "00b" };
  const source = sourceForHost(url.hostname);
  if (!source || source === "komica") return null;
  for (const board of IMAGEBOARD_BOARDS[source]) {
    const base = `/${encodeURIComponent(board.path)}/`;
    if (url.pathname.startsWith(base) && new RegExp(`^(?:src/${file}|thumb/${file}s?)${extension}$`).test(url.pathname.slice(base.length))) {
      url.hostname = new URL(IMAGEBOARD_ORIGINS[source]).hostname;
      return { url: url.href, source, board: board.board };
    }
  }
  return null;
}
export const normalizeImageboardImage = (raw: unknown): string | null => mediaTarget(raw)?.url ?? null;
export const sourceForImage = (raw: unknown): ImageboardSource | null => mediaTarget(raw)?.source ?? null;
export const boardForImage = (raw: unknown): string | null => mediaTarget(raw)?.board ?? null;
