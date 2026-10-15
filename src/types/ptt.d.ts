type PttRequest = { kind: "boards" } | { kind: "threads"; board: string; cursor?: string }
  | { kind: "posts"; board: string; thread: string } | { kind: "resolve"; url: string };
type PttResult = { error: string; accessDenied?: boolean } | { status: "age-confirmation-required" }
  | { boards: BoardInfo[] } | { threads: ThreadInfo[]; nextCursor: string | null }
  | { posts: PostInfo[] } | { board: string; thread: string | null };
type PttConsentRequest = { kind: "status" | "confirm" | "revoke" };
interface PttConsentStatus { accepted: boolean; error?: string }
