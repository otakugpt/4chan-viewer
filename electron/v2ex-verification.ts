type Request = (request: V2exRequest) => Promise<V2exResult>;

// Exercise the same adapters as the reader. Only counts and fixed messages leave this check.
export async function verifyV2ex(board: string, request: Request, checkedAt: string): Promise<V2exVerification> {
  const checks: V2exVerification["checks"] = [];
  let accessDenied = false;
  let stage: V2exCheckId = "connection";
  const steps: V2exCheckId[] = ["connection", "topics", "topicPages", "posts", "replyPages"];
  const passed = (count?: number) => checks.push({ id: stage, status: "passed", ...(count === undefined ? {} : { count }) });
  const call = async (input: V2exRequest) => {
    const result = await request(input);
    if ("error" in result) { accessDenied ||= result.accessDenied === true; throw new Error(); }
    return result;
  };
  try {
    const connection = await call({ kind: "check", board });
    if (!("connected" in connection)) throw new Error();
    passed(); stage = "topics";
    const topics = await call({ kind: "threads", board });
    if (!("threads" in topics)) throw new Error();
    passed(topics.threads.length); stage = "topicPages";
    if (topics.nextCursor) {
      const more = await call({ kind: "threads", board, cursor: topics.nextCursor });
      if (!("threads" in more)) throw new Error();
      if (more.threads.length) passed(more.threads.length);
      else checks.push({ id: stage, status: "not-tested", count: 0, detail: "空ページの応答を確認。記事のある2ページ目は未確認です。" });
    } else checks.push({ id: stage, status: "not-tested", detail: "続きのページがないため未確認です。" });
    stage = "posts";
    const thread = [...topics.threads].sort((a, b) => (b.replies ?? 0) - (a.replies ?? 0))[0]?.threadId;
    if (thread) {
      const posts = await call({ kind: "posts", board, thread });
      if (!("posts" in posts) || !posts.posts.length) throw new Error();
      passed(posts.posts.length); stage = "replyPages";
      if (posts.nextCursor) {
        const more = await call({ kind: "posts", board, thread, cursor: posts.nextCursor });
        if (!("posts" in more)) throw new Error();
        if (more.posts.length) passed(more.posts.length);
        else checks.push({ id: stage, status: "not-tested", count: 0, detail: "空ページの応答を確認。返信のある2ページ目は未確認です。" });
      } else checks.push({ id: stage, status: "not-tested", detail: "続きの返信がないため未確認です。" });
    }
  } catch {
    // The service's error may be useful during ordinary reading, but never persist upstream details in a report.
    checks.push({ id: stage, status: "failed", detail: "確認を完了できませんでした。通常の閲覧画面で認証・通信・取得制限の案内を確認してください。" });
  }
  for (const id of steps) if (!checks.some(check => check.id === id)) checks.push({ id, status: "not-tested", detail: "前の項目が未完了、または対象の記事がありません。" });
  return { board, checkedAt, checks, ...(accessDenied ? { accessDenied: true } : {}) };
}
