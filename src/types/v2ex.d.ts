type V2exRequest = { kind: "boards" | "check" }
  | { kind: "threads"; board: string; cursor?: string }
  | { kind: "posts"; board: string; thread: string; cursor?: string }
  | { kind: "resolve"; url: string };
type V2exResult = { error: string; accessDenied?: boolean }
  | { boards: BoardInfo[] }
  | { threads: ThreadInfo[]; nextCursor: string | null }
  | { posts: PostInfo[]; nextCursor: string | null }
  | { board: string; thread: string | null }
  | { connected: true };
interface V2exCredentialStatus { configured: boolean; persistent: boolean; canPersist: boolean; error?: string }
type V2exSettingsRequest = { kind: "status" | "clear" } | { kind: "set"; token: string; persist: boolean };
