type ImageboardSource = "2333chan" | "komica" | "lainchan";
type ImageboardRequest = { source: ImageboardSource } & (
  | { kind: "boards" }
  | { kind: "threads"; board: string; cursor?: string }
  | { kind: "posts"; board: string; thread: string; cursor?: string }
  | { kind: "resolve"; url: string }
);
type ImageboardResult = { error: string; accessDenied?: boolean }
  | { status: "age-confirmation-required" }
  | { boards: BoardInfo[] }
  | { threads: ThreadInfo[]; nextCursor: string | null }
  | { posts: PostInfo[]; nextCursor?: string | null }
  | { board: string; thread: string | null };
type ImageboardConsentRequest = { action: "status" | "accept" | "revoke" };
type ImageboardConsentStatus = { accepted: boolean } | { error: string };
