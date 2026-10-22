import { normalizeThreadId, validBoard } from "./sources";
import { readyPage, PageAccessError } from "./pages";
import { getImageboardAccess, lockImageboardAccess } from "./imageboardAccess";
export interface Provider {
  source: BoardSource;
  capabilities: { archive: boolean; translation: boolean; remoteImages: boolean; references: boolean; threadPages: boolean; postPages: boolean; ageConfirmation: boolean };
  boards(signal: AbortSignal): Promise<PageResult<BoardInfo>>;
  threads(board: string, signal: AbortSignal, cursor?: string): Promise<PageResult<ThreadInfo>>;
  posts(board: string, thread: ThreadId, signal: AbortSignal, cursor?: string): Promise<PageResult<PostInfo>>;
  archive?: (board: string, signal: AbortSignal) => Promise<ThreadId[]>;
  thumbnail(board: string, thread: ThreadInfo): string | null;
}
function validateTarget(source: BoardSource, board: string, thread?: ThreadId, cursor?: string) {
  if (!validBoard(source, board) || (thread !== undefined && normalizeThreadId(source, thread) === null) || cursor !== undefined) throw new Error("Invalid provider destination");
}
export function normalizeThreads(source: BoardSource, items: RawThreadInfo[]): ThreadInfo[] {
  if (!Array.isArray(items)) throw new Error("Invalid thread data");
  return items.map(({ no, ...item }) => {
    const threadId = normalizeThreadId(source, no);
    if (!threadId) throw new Error("Invalid thread ID");
    return { ...item, threadId };
  });
}
export function normalizePosts(items: RawPostInfo[]): PostInfo[] {
  if (!Array.isArray(items)) throw new Error("Invalid post data");
  const seen = new Set<number>();
  return items.map((item, index) => {
    if (!item || !Number.isSafeInteger(item.no) || item.no <= 0 || seen.has(item.no)) throw new Error("Invalid post ID");
    seen.add(item.no);
    return { ...item, postId: String(item.no), order: index + 1 };
  });
}
const api = () => location.protocol === "file:" ? "https://a.4cdn.org" : "/api";
export const imageBase = () => location.protocol === "file:" ? "https://i.4cdn.org" : "/img";
async function json(path: string, signal: AbortSignal) {
  const r = await fetch(api() + path, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function five(request: FiveRequest, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!window.electron?.fiveRequest) throw new Error("5ch閲覧は Electron アプリで利用できます。");
  const result = await window.electron.fiveRequest(request);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if ("error" in result) throw new Error(result.error);
  return result;
}
async function v2ex(request: V2exRequest, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!window.electron?.v2exRequest) throw new Error("V2EX閲覧は Electron アプリで利用できます。");
  const result = await window.electron.v2exRequest(request);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if ("error" in result) throw result.accessDenied ? new PageAccessError("unavailable", result.error) : new Error(result.error);
  return result;
}
async function ptt(request: PttRequest, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (!window.electron?.pttRequest) throw new Error("PTT閲覧はElectronアプリで利用できます。");
  const result = await window.electron.pttRequest(request);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if ("status" in result) throw new PageAccessError("age-confirmation-required", "PTTの年齢確認が必要です。同意前に記事や一覧は表示しません。");
  if ("error" in result) throw result.accessDenied ? new PageAccessError("unavailable", result.error) : new Error(result.error);
  return result;
}
function imageboardProvider(source: ImageboardSource): Provider {
  const request = async (input: ImageboardRequest, signal: AbortSignal) => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const access = getImageboardAccess();
    if (source === "lainchan" && !access.accepted) throw new PageAccessError("age-confirmation-required");
    if (!window.electron?.imageboardRequest) throw new Error("このサイトはElectronアプリで利用できます。");
    const result = await window.electron.imageboardRequest(input);
    if (signal.aborted || (source === "lainchan" && access.revision !== getImageboardAccess().revision)) throw new DOMException("Aborted", "AbortError");
    if ("status" in result) {
      if (source === "lainchan") lockImageboardAccess();
      throw new PageAccessError("age-confirmation-required");
    }
    if ("error" in result) throw result.accessDenied ? new PageAccessError("unavailable", result.error) : new Error(result.error);
    return result;
  };
  const validate = (board: string, thread?: ThreadId, cursor?: string) => {
    if (!validBoard(source, board) || (thread !== undefined && normalizeThreadId(source, thread) === null) ||
      (cursor !== undefined && (typeof cursor !== "string" || !cursor.length || cursor.length > 256 || /[\u0000-\u0020]/.test(cursor)))) throw new Error("Invalid provider destination");
  };
  return {
    source, capabilities: { archive: false, translation: false, remoteImages: true, references: false, threadPages: true, postPages: false, ageConfirmation: source === "lainchan" },
    boards: async signal => { const result = await request({ source, kind: "boards" }, signal); if ("boards" in result) return readyPage(result.boards); throw new Error("Invalid response"); },
    threads: async (board, signal, cursor) => {
      validate(board, undefined, cursor);
      const result = await request({ source, kind: "threads", board, cursor }, signal);
      if ("threads" in result) return readyPage(result.threads, result.nextCursor); throw new Error("Invalid response");
    },
    posts: async (board, thread, signal, cursor) => {
      validate(board, thread, cursor);
      if (cursor !== undefined) throw new Error("Post pagination is not supported");
      const result = await request({ source, kind: "posts", board, thread }, signal);
      if ("posts" in result) return readyPage(result.posts); throw new Error("Invalid response");
    },
    thumbnail: () => null,
  };
}
export const providers: Record<BoardSource, Provider> = {
  "2333chan": imageboardProvider("2333chan"),
  komica: imageboardProvider("komica"),
  lainchan: imageboardProvider("lainchan"),
  "4chan": {
    source: "4chan", capabilities: { archive: true, translation: true, remoteImages: false, references: false, threadPages: false, postPages: false, ageConfirmation: false },
    boards: async signal => readyPage((await json("/boards.json", signal)).boards),
    threads: async (board, signal, cursor) => {
      validateTarget("4chan", board, undefined, cursor);
      return readyPage(normalizeThreads("4chan", (await json(`/${board}/catalog.json`, signal)).flatMap((page: { threads: RawThreadInfo[] }) => page.threads ?? [])));
    },
    posts: async (board, thread, signal, cursor) => {
      validateTarget("4chan", board, thread, cursor);
      const data = await json(`/${board}/thread/${thread}.json`, signal);
      if (!Array.isArray(data.posts)) throw new Error("Invalid thread data");
      return readyPage(normalizePosts(data.posts));
    },
    archive: async (board, signal) => {
      validateTarget("4chan", board);
      const items: unknown = await json(`/${board}/archive.json`, signal);
      if (!Array.isArray(items)) throw new Error("Invalid archive data");
      return items.map(id => normalizeThreadId("4chan", id)).filter((id): id is string => id !== null);
    },
    thumbnail: (board, thread) => thread.tim ? `${imageBase()}/${board}/${thread.tim}s.jpg` : null,
  },
  "5ch": {
    source: "5ch", capabilities: { archive: false, translation: false, remoteImages: true, references: true, threadPages: false, postPages: false, ageConfirmation: false },
    boards: async signal => { const r = await five({ kind: "boards" }, signal); if ("boards" in r) return readyPage(r.boards); throw new Error("Invalid response"); },
    threads: async (board, signal, cursor) => { validateTarget("5ch", board, undefined, cursor); const r = await five({ kind: "threads", board }, signal); if ("threads" in r) return readyPage(normalizeThreads("5ch", r.threads)); throw new Error("Invalid response"); },
    posts: async (board, thread, signal, cursor) => { validateTarget("5ch", board, thread, cursor); const r = await five({ kind: "posts", board, thread: Number(thread) }, signal); if ("posts" in r) return readyPage(normalizePosts(r.posts)); throw new Error("Invalid response"); },
    thumbnail: () => null,
  },
  v2ex: {
    source: "v2ex", capabilities: { archive: false, translation: true, remoteImages: true, references: false, threadPages: true, postPages: true, ageConfirmation: false },
    boards: async signal => { const r = await v2ex({ kind: "boards" }, signal); if ("boards" in r) return readyPage(r.boards); throw new Error("Invalid response"); },
    threads: async (board, signal, cursor) => {
      if (!validBoard("v2ex", board)) throw new Error("Invalid destination");
      const r = await v2ex({ kind: "threads", board, cursor }, signal);
      if ("threads" in r) return { ...readyPage(r.threads, r.nextCursor), publicOnly: r.publicOnly };
      throw new Error("Invalid response");
    },
    posts: async (board, thread, signal, cursor) => {
      if (!validBoard("v2ex", board) || !normalizeThreadId("v2ex", thread)) throw new Error("Invalid destination");
      const r = await v2ex({ kind: "posts", board, thread, cursor }, signal);
      if ("posts" in r) return { ...readyPage(r.posts, r.nextCursor), publicOnly: r.publicOnly };
      throw new Error("Invalid response");
    },
    thumbnail: () => null,
  },
  ptt: {
    source: "ptt", capabilities: { archive: false, translation: true, remoteImages: true, references: false, threadPages: true, postPages: false, ageConfirmation: true },
    boards: async signal => { const r = await ptt({ kind: "boards" }, signal); if ("boards" in r) return readyPage(r.boards); throw new Error("Invalid response"); },
    threads: async (board, signal, cursor) => {
      if (!validBoard("ptt", board)) throw new Error("Invalid destination");
      const r = await ptt({ kind: "threads", board, cursor }, signal);
      if ("threads" in r) return readyPage(r.threads, r.nextCursor); throw new Error("Invalid response");
    },
    posts: async (board, thread, signal, cursor) => {
      validateTarget("ptt", board, thread, cursor);
      const r = await ptt({ kind: "posts", board, thread }, signal);
      if ("posts" in r) return readyPage(r.posts); throw new Error("Invalid response");
    },
    thumbnail: () => null,
  },
};
