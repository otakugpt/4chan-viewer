import { randomUUID } from "node:crypto";
import { getBytes, serialQueue } from "./network";
import { parseV2exUrl, validV2exId, validV2exNode } from "./v2ex-url";
import { extractImages } from "./five-media";
import { verifyV2ex } from "./v2ex-verification";
import { createPublicV2ex } from "./v2ex-public";

type Row = Record<string, unknown>;
class AccessError extends Error {}
const row = (v: unknown): Row => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("V2EXの応答形式を確認できません。"); return v as Row; };
const str = (v: unknown, max = 200_000): string => { if (typeof v !== "string" || v.length > max) throw new Error("V2EXのテキスト形式を確認できません。"); return v; };
const id = (v: unknown): string => { const s = typeof v === "number" || typeof v === "string" ? String(v) : ""; if (!validV2exId(s)) throw new Error("V2EXのIDが不正です。"); return s; };
const list = (v: unknown, max = 200): unknown[] => { if (!Array.isArray(v) || v.length > max) throw new Error("V2EXの一覧形式を確認できません。"); return v; };
// Existing views decode one HTML layer. Escape plain API content first, preserving code and Markdown.
const escaped = (v: unknown, max?: number) => str(v, max).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function node(v: unknown): BoardInfo {
  const n = row(v); if (!validV2exNode(n.name)) throw new Error("V2EXのノードが不正です。");
  return { board: n.name, title: str(n.title, 500) };
}
function topic(v: unknown): ThreadInfo {
  const t = row(v);
  return { threadId: id(t.id), sub: escaped(t.title, 1000), replies: Number.isSafeInteger(t.replies) && Number(t.replies) >= 0 ? Number(t.replies) : 0 };
}
function post(v: unknown, order: number, root: boolean): PostInfo {
  const p = row(v);
  let content = str(p.content);
  if (root && p.supplements !== undefined) {
    for (const supplement of list(p.supplements, 100)) content += "\n\n[追記]\n" + str(row(supplement).content);
  }
  if (content.length > 200_000) throw new Error("V2EXの本文が大きすぎます。");
  const seconds = Number(p.created);
  return { no: order, order, postId: (root ? "topic:" : "reply:") + id(p.id),
    name: escaped(row(p.member).username, 100), com: escaped(content), media: extractImages(content), ...(root ? { sub: escaped(p.title, 1000) } : {}),
    date: Number.isSafeInteger(seconds) && seconds > 0 && seconds < 10_000_000_000 ? new Date(seconds * 1000).toISOString() : undefined };
}
interface Cursor { key: string; page: number; offset: number; seen: string[]; until: number; revision: number }
export function createV2exService(snapshot: () => { token: string; revision: number; mode?: V2exMode }, options: { request?: typeof getBytes; spacing?: number; now?: () => number } = {}) {
  const request = options.request ?? getBytes, now = options.now ?? Date.now;
  const queue = serialQueue(options.spacing ?? 6100, 24);
  const cache = new Map<string, { until: number; value: unknown }>();
  const pending = new Map<string, Promise<unknown>>(), cursors = new Map<string, Cursor>();
  let cooldown = 0, verifying = false, publicBlocked = false, generation = -1;
  const publicMode = () => snapshot().mode !== "authenticated";
  const publicReader = createPublicV2ex((endpoint, revision) => fetchJson(endpoint, false, revision), now);
  function assertRevision(revision: number) {
    if (revision !== snapshot().revision) throw new Error("接続設定が変更されました。再読み込みしてください。");
  }
  async function fetchJson(endpoint: string, auth: boolean, revision: number, fresh = false): Promise<unknown> {
    assertRevision(revision);
    const assertAccess = () => {
      if (!auth && publicBlocked) throw new AccessError("V2EXの公開取得を停止しています。閲覧拒否・転送・応答形式を確認できませんでした。別経路では取得しません。");
      if (cooldown > now()) throw new AccessError("V2EXの利用制限中です。しばらく待って再試行してください。");
    };
    assertAccess();
    const cacheKey = revision + ":" + endpoint;
    const hit = cache.get(cacheKey);
    if (!fresh && hit && hit.until > now()) return hit.value;
    const existing = pending.get(cacheKey); if (existing) return existing;
    const task = queue(async () => {
      assertRevision(revision);
      assertAccess();
      const token = snapshot().token;
      if (auth && !token) throw new AccessError("「V2EX接続設定」で個人トークンを設定してください。");
      let response;
      try { response = await request("https://www.v2ex.com" + endpoint, 2 * 1024 * 1024, auth ? { Authorization: "Bearer " + token } : {}); }
      catch (e) {
        if (!auth && (e as NodeJS.ErrnoException)?.code === "REDIRECT") { publicBlocked = true; cache.clear(); }
        throw new Error("V2EXに接続できません。通信環境を確認してください（転送先への認証送信は行いません）。");
      }
      assertRevision(revision);
      const reset = Number(response.headers["x-rate-limit-reset"]);
      if (response.status === 429 || response.headers["x-rate-limit-remaining"] === "0") {
        const header = response.headers["retry-after"];
        const retry = typeof header === "string" && /^\d+$/.test(header) ? Number(header) * 1000 : typeof header === "string" ? Date.parse(header) - now() : 0;
        cooldown = now() + Math.max(60_000, Number.isFinite(retry) ? retry : 0, Number.isFinite(reset) ? reset * 1000 - now() : 0);
      }
      if (response.status === 401 || response.status === 403) cache.clear();
      if (!auth && ([401, 403].includes(response.status) || (response.status >= 300 && response.status < 400))) { publicBlocked = true; cache.clear(); }
      if (response.status === 401) throw new AccessError(auth ? "V2EXの認証に失敗しました。トークンの期限・失効を確認して再設定してください。" : "V2EXの公開取得が拒否されました。認証への自動切替は行いません。");
      if (response.status === 403) throw new AccessError("このV2EXコンテンツの閲覧は許可されていません。");
      if (response.status === 404) throw new Error("V2EXのノードまたはトピックが見つかりません。");
      if (response.status === 429) throw new Error("V2EXの利用制限中です。しばらく待って再試行してください。");
      if (response.status !== 200) throw new Error("V2EXで通信エラーが発生しました。時間をおいて再試行してください。");
      if (!auth && !/^application\/(?:json|feed\+json)(?:\s*;|$)/i.test(String(response.headers["content-type"] ?? ""))) {
        publicBlocked = true; cache.clear(); throw new AccessError("V2EXの公開応答がJSONではありません。確認画面の可能性があるため取得を停止しました。");
      }
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)); } catch {
        if (!auth) { publicBlocked = true; cache.clear(); }
        throw new Error("V2EXの応答を読み取れません。");
      }
      const value = auth ? (() => {
        const envelope = row(parsed);
        if (envelope.success !== true) { cache.clear(); throw new AccessError("V2EX APIが取得を拒否しました。トークンと閲覧権限を確認してください。"); }
        return envelope.result;
      })() : parsed;
      // A bounded cache, scoped to the credential generation; no disk response cache.
      if (cache.size >= 16) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { until: now() + (auth ? 30_000 : endpoint === "/api/nodes/all.json" ? 86_400_000 : 600_000), value });
      return value;
    });
    pending.set(cacheKey, task);
    try { return await task; } finally { pending.delete(cacheKey); }
  }
  function pageFor(value: unknown, key: string, revision: number): Cursor {
    if (value === undefined) return { key, page: 1, offset: 0, seen: [], until: now() + 1_800_000, revision };
    if (typeof value !== "string") throw new Error("ページ指定が不正です。");
    const cursor = cursors.get(value);
    if (!cursor || cursor.key !== key || cursor.revision !== revision || cursor.until < now()) throw new Error("ページ指定の期限が切れました。一覧またはスレッドを更新してください。");
    return cursor;
  }
  function nextPage(current: Cursor, ids: string[]): string | null {
    if (!ids.length) return null;
    const added = [...new Set(ids)].filter(value => !current.seen.includes(value));
    if (!added.length) throw new Error("V2EXが同じページを返しました。続きの取得を停止しました。");
    if (current.page >= 200 || current.seen.length + added.length > 10_000) throw new Error("取得上限に達しました。公式サイトで続きを確認してください。");
    if (cursors.size >= 256) cursors.delete(cursors.keys().next().value!);
    const key = randomUUID();
    cursors.set(key, { ...current, page: current.page + 1, offset: current.offset + added.length, seen: [...current.seen, ...added] });
    return key;
  }
  const execute = async (input: unknown, fresh = false): Promise<V2exResult> => {
    try {
      const r = row(input), { revision, token } = snapshot();
      if (generation !== revision) { cache.clear(); cursors.clear(); generation = revision; }
      if (r.kind === "boards") return { boards: list(await fetchJson("/api/nodes/all.json", false, revision), 10_000).map(node) };
      if (!["check", "verify", "threads", "posts", "resolve"].includes(String(r.kind))) throw new Error("V2EXへの要求が不正です。");
      if (publicMode()) {
        const result = await publicReader(r, revision);
        assertRevision(revision);
        return result;
      }
      if (!token) throw new AccessError("「V2EX接続設定」で個人トークンを設定してください。");
      if (r.kind === "verify") {
        if (!validV2exNode(r.board)) throw new Error("V2EXのノード指定が不正です。");
        if (verifying) throw new Error("V2EXの動作確認はすでに実行中です。");
        verifying = true;
        try {
          const verification = await verifyV2ex(r.board, async request => { assertRevision(revision); return execute(request, true); }, new Date(now()).toISOString());
          assertRevision(revision);
          return { verification };
        } finally { verifying = false; }
      }
      const api = (endpoint: string) => fetchJson("/api/v2/" + endpoint, true, revision, fresh);
      if (r.kind === "check") {
        const board = r.board === undefined ? "python" : r.board;
        if (!validV2exNode(board)) throw new Error("V2EXのノード指定が不正です。");
        if (node(await fetchJson("/api/v2/nodes/" + board, true, revision, true)).board !== board) throw new Error("V2EXのノードの応答が一致しません。");
        return { connected: true };
      }
      if (r.kind === "resolve") {
        const target = parseV2exUrl(r.url);
        if (!target) throw new Error("対応するV2EXのノード・トピックURLを入力してください。");
        if (target.thread) {
          const data = row(await api("topics/" + target.thread));
          if (id(data.id) !== target.thread) throw new Error("トピックの応答が一致しません。");
          return { board: node(data.node).board, thread: target.thread };
        }
        const board = node(await api("nodes/" + target.board)).board;
        if (board !== target.board) throw new Error("ノードの応答が一致しません。");
        return { board, thread: null };
      }
      if (!validV2exNode(r.board) || (r.kind === "posts" && !validV2exId(r.thread))) throw new Error("V2EXの移動先が不正です。");
      const current = pageFor(r.cursor, r.kind + ":" + r.board + ":" + (r.thread ?? ""), revision);
      if (r.kind === "threads") {
        const threads = [...new Map(list(await api("nodes/" + r.board + "/topics?p=" + current.page)).map(topic).map(t => [t.threadId, t])).values()];
        const nextCursor = nextPage(current, threads.map(t => t.threadId));
        return { threads: threads.filter(t => !current.seen.includes(t.threadId)), nextCursor };
      }
      const posts: PostInfo[] = [];
      if (current.page === 1) {
        const data = row(await api("topics/" + r.thread));
        if (id(data.id) !== r.thread || node(data.node).board !== r.board) throw new Error("トピックのノードが一致しません。URLから開き直してください。");
        posts.push(post(data, 1, true));
      }
      const replies = list(await api("topics/" + r.thread + "/replies?p=" + current.page));
      const ids = replies.map(v => id(row(v).id));
      const seen = new Set(current.seen);
      for (const reply of replies) {
        const key = id(row(reply).id);
        if (seen.has(key)) continue;
        posts.push(post(reply, 2 + current.offset + seen.size - current.seen.length, false)); seen.add(key);
      }
      return { posts, nextCursor: nextPage(current, ids) };
    } catch (e) {
      // No request, token, raw HTTP body, or networking error is exposed to the renderer.
      const message = e instanceof Error ? e.message : "";
      return { error: /^(V2EX|このV2EX|「V2EX|接続設定|ページ指定|取得上限|対応するV2EX|トピック|ノード)/.test(message) ? message : "V2EXの取得に失敗しました。しばらく待って再試行してください。", ...(e instanceof AccessError || publicMode() ? { accessDenied: true } : {}) };
    }
  };
  return execute;
}
