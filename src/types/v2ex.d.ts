type V2exRequest = { kind: "boards" }
  | { kind: "check"; board?: string }
  | { kind: "verify"; board: string }
  | { kind: "threads"; board: string; cursor?: string }
  | { kind: "posts"; board: string; thread: string; cursor?: string }
  | { kind: "resolve"; url: string };
type V2exResult = { error: string; accessDenied?: boolean }
  | { boards: BoardInfo[] }
  | { threads: ThreadInfo[]; nextCursor: string | null; publicOnly?: boolean }
  | { posts: PostInfo[]; nextCursor: string | null; publicOnly?: boolean }
  | { board: string; thread: string | null }
  | { connected: true }
  | { verification: V2exVerification };
type V2exCheckId = "connection" | "topics" | "topicPages" | "posts" | "replyPages";
interface V2exVerification {
  board: string;
  checkedAt: string;
  accessDenied?: boolean;
  checks: { id: V2exCheckId; status: "passed" | "failed" | "not-tested"; count?: number; detail?: string }[];
}
type V2exMode = "public" | "authenticated";
interface V2exCredentialStatus { configured: boolean; persistent: boolean; canPersist: boolean; mode: V2exMode; error?: string }
type V2exSettingsRequest = { kind: "status" | "clear" } | { kind: "set"; token: string; persist: boolean } | { kind: "mode"; mode: V2exMode };
