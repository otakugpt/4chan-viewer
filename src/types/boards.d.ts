export {};
declare global {
  type BoardSource = "4chan" | "5ch" | "v2ex" | "ptt" | "2333chan" | "komica" | "lainchan";
  type ThreadId = string;
  type PostId = string;
  interface BoardInfo { board: string; title: string }
  interface RawThreadInfo { no: number; sub?: string; com?: string; replies?: number; images?: number; tim?: number }
  interface ThreadInfo extends Omit<RawThreadInfo, "no"> { threadId: ThreadId }
  interface RawPostInfo { archived?: boolean; no: number; sub?: string; com?: string; name?: string; tim?: number; ext?: string; date?: string; id?: string; media?: string[]; mediaThumbs?: Record<string, string>; spoiler?: boolean }
  // no is a display/reference number; id remains the author's ID, not a post ID.
  interface PostInfo extends RawPostInfo { postId: PostId; order: number; reaction?: "推" | "噓" | "→" }
  type PageResult<T> = { status: "ready"; items: T[]; nextCursor: string | null; publicOnly?: boolean }
    | { status: "age-confirmation-required" }
    | { status: "unavailable" };
  type FiveRequest = { kind: "boards" } | { kind: "threads"; board: string } | { kind: "posts"; board: string; thread: number } | { kind: "resolve"; url: string };
  type FiveResult = { error: string; code?: string } | { boards: BoardInfo[] } | { threads: RawThreadInfo[] } | { posts: RawPostInfo[] } | { board: string; thread: number | null };
  type RemoteImageResult = { error: string } | { bytes: Uint8Array; mime: string };
}
