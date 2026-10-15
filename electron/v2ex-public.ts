import { parseFragment } from "parse5";
import { randomUUID } from "node:crypto";
import { parseV2exUrl, validV2exId, validV2exNode } from "./v2ex-url";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("V2EXの公開データ形式を確認できません。");
  return value as Row;
};
const text = (value: unknown, max = 200_000): string => {
  if (typeof value !== "string" || value.length > max) throw new Error("V2EXの公開テキスト形式を確認できません。");
  return value;
};
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
interface HtmlNode { nodeName: string; value?: string; childNodes?: HtmlNode[]; attrs?: { name: string; value: string }[] }
const excluded = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "form", "button", "input", "img", "video", "audio", "svg", "math"]);

// Parse inertly in main, then send only escaped text, never feed HTML, to the renderer.
export function publicHtmlText(html: string): string {
  const root = parseFragment(text(html)) as HtmlNode;
  let count = 0;
  const visit = (n: HtmlNode, depth: number): string => {
    if (++count > 20_000 || depth > 100) throw new Error("V2EXの公開本文が複雑すぎます。");
    if (excluded.has(n.nodeName)) return "";
    if (n.nodeName === "#text") return n.value ?? "";
    if (n.nodeName === "br") return "\n";
    let value = (n.childNodes ?? []).map(child => visit(child, depth + 1)).join("");
    if (n.nodeName === "a") {
      const href = n.attrs?.find(a => a.name === "href")?.value;
      if (href && href.length <= 2048 && !/[\u0000-\u0020\u007f]/.test(href)) {
        try {
          const url = new URL(href, "https://www.v2ex.com");
          if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && value !== url.href) value += ` (${url.href})`;
        } catch { /* Invalid links remain plain labels. */ }
      }
    }
    return value + (/^(p|div|pre|li|blockquote|h[1-6]|tr)$/.test(n.nodeName) ? "\n" : "");
  };
  return text(visit(root, 0)).trim();
}

export function parsePublicFeed(value: unknown, board: string): { threads: ThreadInfo[]; posts: Map<string, PostInfo> } {
  const feed = row(value);
  if (!["https://jsonfeed.org/version/1", "https://jsonfeed.org/version/1.1"].includes(String(feed.version)) ||
      feed.feed_url !== `https://www.v2ex.com/feed/${board}.json` ||
      parseV2exUrl(feed.home_page_url)?.board !== board || !Array.isArray(feed.items) || feed.items.length > 200) {
    throw new Error("V2EXの公開フィードの形式・ノードが一致しません。");
  }
  const threads: ThreadInfo[] = [], posts = new Map<string, PostInfo>();
  for (const item of feed.items) {
    const entry = row(item), target = parseV2exUrl(entry.url);
    const identifier = typeof entry.id === "number" || typeof entry.id === "string" ? String(entry.id) : "";
    const thread = validV2exId(identifier) ? identifier : parseV2exUrl(identifier)?.thread;
    if (!thread || target?.thread !== thread || posts.has(thread) || entry.deleted === true || entry.deleted === 1) throw new Error("V2EXの公開記事IDを確認できません。");
    const title = escape(text(entry.title, 1000));
    const body = entry.content_text !== undefined ? text(entry.content_text) : entry.content_html !== undefined ? publicHtmlText(text(entry.content_html)) : "";
    const author = entry.author === undefined ? "投稿者不明" : text(row(entry.author).name, 100);
    const date = text(entry.date_published, 100);
    if (!Number.isFinite(Date.parse(date))) throw new Error("V2EXの公開記事の日時を確認できません。");
    threads.push({ threadId: thread, sub: title });
    posts.set(thread, { no: 1, order: 1, postId: "topic:" + thread, sub: title, name: escape(author), date,
      com: escape(body || "（公開フィードに本文が含まれていません）"), media: [] });
  }
  return { threads, posts };
}

export function publicReplies(value: unknown, thread: string): PostInfo[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error("V2EXの公開返信の件数・形式を確認できません。");
  const seen = new Set<string>();
  return value.map((item, index) => {
    const r = row(item), id = String(r.id);
    if (!validV2exId(id) || String(r.topic_id) !== thread || seen.has(id) || r.deleted === true || r.deleted === 1) throw new Error("V2EXの公開返信IDが一致しません。");
    seen.add(id);
    const seconds = r.created;
    if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds >= 10_000_000_000) throw new Error("V2EXの公開返信の日時を確認できません。");
    return { no: index + 2, order: index + 2, postId: "reply:" + id, name: escape(text(row(r.member).username, 100)),
      date: new Date(seconds * 1000).toISOString(), com: escape(text(r.content)), media: [] };
  });
}

export function createPublicV2ex(fetch: (path: string, revision: number) => Promise<unknown>, now: () => number) {
  const known = new Map<string, { revision: number; until: number; board: string }>();
  const cursors = new Map<string, { revision: number; until: number; board: string; thread: string }>();
  let generation = -1;
  const feed = async (board: string, revision: number) => {
    const result = parsePublicFeed(await fetch(`/feed/${board}.json`, revision), board);
    for (const t of result.threads) {
      if (known.size >= 1000) known.delete(known.keys().next().value!);
      known.set(t.threadId, { revision, until: now() + 600_000, board });
    }
    return result;
  };
  return async (r: Row, revision: number): Promise<V2exResult> => {
    if (generation !== revision) { known.clear(); cursors.clear(); generation = revision; }
    if (r.kind === "check" || r.kind === "verify") throw new Error("V2EXの認証確認は認証モードでのみ実行できます。公開モードではトークンを送信しません。");
    if (r.kind === "resolve") {
      const target = parseV2exUrl(r.url);
      if (!target) throw new Error("V2EXのノード・トピックURLを確認してください。");
      const saved = target.thread ? known.get(target.thread) : undefined;
      const board = target.board ?? (saved?.revision === revision && saved.until > now() ? saved.board : null);
      if (!board) throw new Error("V2EX公開モードでは、先に対象ノードを開いてください。公開フィード内の記事だけを開けます。");
      const result = await feed(board, revision);
      if (target.thread && !result.posts.has(target.thread)) throw new Error("V2EX公開フィードにこの記事はありません。別経路での取得は行いません。");
      return { board, thread: target.thread };
    }
    if (!validV2exNode(r.board) || (r.kind === "posts" && !validV2exId(r.thread))) throw new Error("V2EXの移動先が不正です。");
    if (r.cursor !== undefined) {
      const c = typeof r.cursor === "string" ? cursors.get(r.cursor) : undefined;
      if (r.kind !== "posts" || !c || c.revision !== revision || c.board !== r.board || c.thread !== r.thread || c.until <= now()) throw new Error("V2EXの公開返信の指定が無効です。本文を更新してください。");
      // Revalidate membership before the one optional reply request. No paging or fallback.
      const current = await feed(c.board, revision);
      if (!current.posts.has(c.thread)) throw new Error("V2EX公開フィードにこの記事はありません。返信の取得を停止しました。");
      const posts = publicReplies(await fetch(`/api/replies/show.json?topic_id=${c.thread}`, revision), c.thread);
      return { posts, nextCursor: null, publicOnly: true };
    }
    const result = await feed(r.board, revision);
    if (r.kind === "threads") return { threads: result.threads, nextCursor: null, publicOnly: true };
    const root = result.posts.get(String(r.thread));
    if (!root) throw new Error("V2EX公開フィードにこの記事はありません。過去記事・限定記事の別経路での取得は行いません。");
    if (cursors.size >= 256) cursors.delete(cursors.keys().next().value!);
    const cursor = randomUUID();
    cursors.set(cursor, { revision, until: now() + 600_000, board: r.board, thread: String(r.thread) });
    return { posts: [root], nextCursor: cursor, publicOnly: true };
  };
}
