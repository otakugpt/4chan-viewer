export interface Provider {
  source: BoardSource;
  capabilities: { archive: boolean; translation: boolean; remoteImages: boolean; references: boolean };
  boards(signal: AbortSignal): Promise<BoardInfo[]>;
  threads(board: string, signal: AbortSignal): Promise<ThreadInfo[]>;
  posts(board: string, thread: number, signal: AbortSignal): Promise<PostInfo[]>;
  archive?: (board: string, signal: AbortSignal) => Promise<number[]>;
  thumbnail(board: string, thread: ThreadInfo): string | null;
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
export const providers: Record<BoardSource, Provider> = {
  "4chan": {
    source: "4chan", capabilities: { archive: true, translation: true, remoteImages: false, references: false },
    boards: async signal => (await json("/boards.json", signal)).boards,
    threads: async (board, signal) => (await json(`/${board}/catalog.json`, signal)).flatMap((page: { threads: ThreadInfo[] }) => page.threads ?? []),
    posts: async (board, thread, signal) => {
      const data = await json(`/${board}/thread/${thread}.json`, signal);
      if (!Array.isArray(data.posts)) throw new Error("Invalid thread data");
      return data.posts;
    },
    archive: async (board, signal) => json(`/${board}/archive.json`, signal),
    thumbnail: (board, thread) => thread.tim ? `${imageBase()}/${board}/${thread.tim}s.jpg` : null,
  },
  "5ch": {
    source: "5ch", capabilities: { archive: false, translation: false, remoteImages: true, references: true },
    boards: async signal => { const r = await five({ kind: "boards" }, signal); if ("boards" in r) return r.boards; throw new Error("Invalid response"); },
    threads: async (board, signal) => { const r = await five({ kind: "threads", board }, signal); if ("threads" in r) return r.threads; throw new Error("Invalid response"); },
    posts: async (board, thread, signal) => { const r = await five({ kind: "posts", board, thread }, signal); if ("posts" in r) return r.posts; throw new Error("Invalid response"); },
    thumbnail: () => null,
  },
};
