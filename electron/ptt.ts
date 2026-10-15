import { randomUUID } from "node:crypto";
import { getBytes, serialQueue } from "./network";
import { parsePttUrl, validPttBoard, validPttId } from "./ptt-url";
import { pttBoards, pttThreads, pttPosts, PttGate, PttUnsupported } from "./ptt-parser";

export function createPttService(options: { request?: typeof getBytes; spacing?: number; now?: () => number } = {}) {
  const request = options.request ?? getBytes, now = options.now ?? Date.now, queue = serialQueue(options.spacing ?? 3100, 20);
  let accepted = false, revision = 0, prompted = false, cooldown = 0;
  const cache = new Map<string, { html: string; until: number; at: string }>(), pending = new Map<string, Promise<{ html: string; at: string }>>();
  const cursors = new Map<string, { board: string; page: string; revision: number; until: number; count: number }>();
  const check = (v: number) => { if (v !== revision) throw new PttUnsupported("PTTの年齢確認状態が変更されました。再読み込みしてください。"); };
  async function read(path: string, generation: number) {
    check(generation);
    const key = generation + ":" + path, hit = cache.get(key);
    if (hit && hit.until > now()) return hit;
    if (pending.has(key)) return pending.get(key)!;
    const task = queue(async () => {
      check(generation);
      if (now() < cooldown) throw new PttUnsupported("PTTの利用制限中です。時間をおいて再試行してください。");
      let r;
      try { r = await request("https://www.ptt.cc" + path, 4 * 1024 * 1024, accepted ? { Cookie: "over18=1" } : {}); }
      catch (error) {
        check(generation);
        const e = error as { code?: string; location?: string };
        if (e.code === "REDIRECT" && typeof e.location === "string") {
          try { const u = new URL(e.location, "https://www.ptt.cc"); if (u.origin === "https://www.ptt.cc" && u.pathname === "/ask/over18" && !u.username && !u.password) throw new PttGate(); }
          catch (gate) { if (gate instanceof PttGate) throw gate; }
        }
        throw new PttUnsupported("PTTに接続できません。通信環境・サイトの制限を確認してください。転送先は自動取得しません。");
      }
      check(generation);
      if (r.status === 403 || r.status === 429) {
        const seconds = Number(r.headers["retry-after"]), date = Date.parse(String(r.headers["retry-after"] ?? ""));
        cooldown = now() + Math.max(60_000, Number.isFinite(seconds) ? Math.min(seconds * 1000, 86_400_000) : Number.isFinite(date) ? Math.min(date - now(), 86_400_000) : 0);
        cache.clear();
        throw new PttUnsupported("PTTでアクセスが制限されています。連続再試行せず時間をおいてください。");
      }
      if (r.status === 404 || r.status === 410) throw new PttUnsupported("PTTの板・記事が見つかりません。削除済み記事を外部ミラーから取得することはありません。");
      if (r.status !== 200) throw new PttUnsupported("PTTで通信エラーが発生しました。");
      const mime = String(r.headers["content-type"] ?? "");
      if (!/^text\/html(?:;|$)/i.test(mime)) throw new PttUnsupported("PTTの応答形式がHTMLではありません。");
      let html: string;
      try { html = new TextDecoder("utf-8", { fatal: true }).decode(r.body); } catch { throw new PttUnsupported("PTTの文字コードを確認できません。"); }
      const value = { html, at: new Date(now()).toISOString(), until: now() + (path === "/bbs/index.html" ? 300_000 : 30_000) };
      if (cache.size >= 8) cache.delete(cache.keys().next().value!);
      cache.set(key, value); return value;
    });
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  async function handle(input: unknown): Promise<PttResult> {
    try {
      if (!input || typeof input !== "object") throw new PttUnsupported("PTTへの要求が不正です。");
      const r = input as PttRequest, generation = revision;
      if (r.kind === "boards") { const data = await read("/bbs/index.html", generation); check(generation); return { boards: pttBoards(data.html, accepted) }; }
      if (r.kind === "resolve") {
        const target = parsePttUrl(r.url);
        if (!target) throw new PttUnsupported("PTTの正規の板・記事URLを入力してください。");
        // No fetch here: the destination view performs gate checks before exposing any title or body.
        return { board: target.board, thread: target.thread };
      }
      if ((r.kind !== "threads" && r.kind !== "posts") || !validPttBoard(r.board)) throw new PttUnsupported("PTTの板指定が不正です。");
      if (r.kind === "posts") {
        if (!validPttId(r.thread)) throw new PttUnsupported("PTTの記事指定が不正です。");
        const data = await read(`/bbs/${r.board}/${r.thread}.html`, generation); check(generation);
        return { posts: pttPosts(data.html, r.board, r.thread, accepted, data.at) };
      }
      const cursor = r.cursor === undefined ? undefined : typeof r.cursor === "string" ? cursors.get(r.cursor) : null;
      if (r.cursor !== undefined && (!cursor || cursor.board !== r.board || cursor.revision !== revision || cursor.until < now())) throw new PttUnsupported("PTTのページ指定が無効または期限切れです。一覧を更新してください。");
      const data = await read(`/bbs/${r.board}/index${cursor?.page ?? ""}.html`, generation); check(generation);
      const result = pttThreads(data.html, r.board, cursor?.page ?? null, accepted);
      let nextCursor: string | null = null;
      if (result.previous) {
        if ((cursor?.count ?? 0) >= 199) throw new PttUnsupported("PTTの連続取得上限200ページに達しました。");
        nextCursor = randomUUID();
        if (cursors.size >= 256) cursors.delete(cursors.keys().next().value!);
        cursors.set(nextCursor, { board: r.board, page: result.previous, revision, until: now() + 1_800_000, count: (cursor?.count ?? 0) + 1 });
      }
      return { threads: result.threads, nextCursor };
    } catch (e) {
      if (e instanceof PttGate) { cache.clear(); prompted = true; return accepted ? { error: "PTTの確認画面が続いています。取得を停止しました。", accessDenied: true } : { status: "age-confirmation-required" }; }
      cache.clear();
      return { error: e instanceof PttUnsupported || (e instanceof Error && e.message.startsWith("PTTのHTML")) ? e.message : "PTTを取得できませんでした。時間をおいて再試行してください。", accessDenied: true };
    }
  }
  return { request: handle, status: () => ({ accepted }), needsConsent: () => prompted && !accepted, generation: () => revision,
    setConsent(value: boolean) { accepted = value; revision++; prompted = false; cache.clear(); cursors.clear(); } };
}
