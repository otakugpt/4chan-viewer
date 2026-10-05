export {};
declare global {
  type BoardSource = "4chan" | "5ch";
  interface BoardInfo { board: string; title: string }
  interface ThreadInfo { no: number; sub?: string; com?: string; replies?: number; images?: number; tim?: number }
  interface PostInfo { no: number; com?: string; name?: string; tim?: number; ext?: string; date?: string; id?: string; media?: string[] }
  type FiveRequest = { kind: "boards" } | { kind: "threads"; board: string } | { kind: "posts"; board: string; thread: number } | { kind: "resolve"; url: string };
  type FiveResult = { error: string; code?: string } | { boards: BoardInfo[] } | { threads: ThreadInfo[] } | { posts: PostInfo[] } | { board: string; thread: number | null };
  type RemoteImageResult = { error: string } | { bytes: Uint8Array; mime: string };
}
