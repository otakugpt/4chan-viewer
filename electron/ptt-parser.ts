import { parse } from "parse5";
import { createHash } from "node:crypto";
import { parsePttUrl } from "./ptt-url";
import { extractImages, normalizeFiveImage } from "./five-media";

interface Node { nodeName: string; value?: string; childNodes?: Node[]; attrs?: { name: string; value: string }[] }
const attr = (n: Node, key: string) => n.attrs?.find(a => a.name === key)?.value ?? "";
const has = (n: Node, name: string) => attr(n, "class").split(/\s+/).includes(name);
const excluded = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "form", "button", "input", "img", "video", "audio"]);
function nodes(root: Node): Node[] {
  const result: Node[] = [], stack: [Node, number][] = [[root, 0]];
  while (stack.length) {
    const [n, depth] = stack.pop()!;
    if (depth > 128 || result.length >= 100_000) throw new Error("PTTのHTMLが複雑すぎるため取得を停止しました。");
    result.push(n);
    for (const child of [...(n.childNodes ?? [])].reverse()) stack.push([child, depth + 1]);
  }
  return result;
}
function text(n: Node): string {
  if (n.nodeName === "#text") return n.value ?? "";
  if (excluded.has(n.nodeName)) return "";
  if (n.nodeName === "br") return "\n";
  return (n.childNodes ?? []).map(text).join("");
}
const find = (n: Node, name: string) => nodes(n).find(x => has(x, name));
const field = (n: Node, name: string) => { const child = find(n, name); return child ? text(child).trim() : ""; };
const escaped = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function images(roots: Node[]): string[] {
  const urls = new Set<string>();
  const visit = (n: Node) => {
    if (urls.size >= 100) return;
    if (n.nodeName === "img" || n.nodeName === "a") {
      const url = normalizeFiveImage(attr(n, n.nodeName === "img" ? "src" : "href"));
      if (url) urls.add(url);
    }
    if (excluded.has(n.nodeName)) return;
    if (n.nodeName === "#text") for (const url of extractImages(n.value ?? "")) { if (urls.size >= 100) break; urls.add(url); }
    for (const child of n.childNodes ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return [...urls];
}
const link = (n: Node) => {
  const href = attr(n, "href");
  try { return parsePttUrl(new URL(href, "https://www.ptt.cc").href); } catch { return null; }
};
export class PttGate extends Error {}
export class PttUnsupported extends Error {}
const knownGate = /^\s*\(\(\)\s*=>\s*\{\s*if\s*\(document\.cookie\.indexOf\('over18=1'\)\s*===\s*-1\)\s*\{\s*location\s*=\s*'https:\/\/www\.ptt\.cc\/ask\/over18\?from='\s*\+\s*encodeURIComponent\(location\.pathname\);\s*\}\s*\}\)\(\);\s*$/;
function document(html: string, accepted: boolean) {
  const all = nodes(parse(html) as Node);
  // Inspect gates before looking for usable content: the site can serve both in one HTTP 200.
  if (all.some(n => has(n, "over18-notice") || (n.nodeName === "form" && attr(n, "action").includes("/ask/over18")))) {
    if (!accepted) throw new PttGate();
    throw new PttUnsupported("PTTの年齢確認画面が続いています。自動操作せず取得を停止しました。");
  }
  for (const n of all) {
    const raw = n.nodeName === "script" ? (n.childNodes ?? []).map(c => c.value ?? "").join("") : "";
    const refresh = n.nodeName === "meta" && attr(n, "http-equiv").toLowerCase() === "refresh";
    const externalGate = n.nodeName === "script" && /over18|\/ask\//i.test(attr(n, "src"));
    const unknownNavigation = /\blocation(?:\.href)?\s*=|\blocation\.(?:replace|assign)\s*\(/.test(raw);
    if (/over18|\/ask\//i.test(raw) || unknownNavigation || externalGate || (refresh && /over18/i.test(attr(n, "content")))) {
      if (!knownGate.test(raw)) throw new PttUnsupported("PTTの確認方法が変わったため、安全のため取得を停止しました。");
      if (!accepted) throw new PttGate();
    }
    if (refresh) throw new PttUnsupported("PTTの転送・確認画面には対応していません。");
  }
  return all;
}
export function pttBoards(html: string, accepted: boolean): BoardInfo[] {
  const all = document(html, accepted), entries = all.filter(n => has(n, "b-ent"));
  if (!entries.length || entries.length > 2000) throw new PttUnsupported("PTTの人気板一覧の形式を確認できません。");
  const result = new Map<string, BoardInfo>();
  for (const entry of entries) {
    const destination = nodes(entry).filter(n => n.nodeName === "a").map(link).find(t => t && !t.thread);
    if (!destination) throw new PttUnsupported("PTTの板リンクの形式を確認できません。");
    result.set(destination.board, { board: destination.board, title: (field(entry, "board-title") || destination.board).slice(0, 500) });
  }
  return [...result.values()];
}
export function pttThreads(html: string, board: string, page: string | null, accepted: boolean) {
  const all = document(html, accepted);
  if (!all.some(n => has(n, "r-list-container"))) throw new PttUnsupported("PTTの記事一覧の形式を確認できません。");
  const entries = all.filter(n => has(n, "r-ent"));
  if (entries.length > 200) throw new PttUnsupported("PTTの記事一覧が上限を超えています。");
  const result = new Map<string, ThreadInfo>();
  for (const entry of entries) {
    const title = find(entry, "title");
    if (!title) throw new PttUnsupported("PTTの記事タイトルを確認できません。");
    const anchor = nodes(title).find(n => n.nodeName === "a");
    if (!anchor) continue; // Deleted articles have no retrievable identity.
    const target = link(anchor);
    if (!target?.thread || target.board !== board) throw new PttUnsupported("PTTの記事リンクが不正です。");
    result.set(target.thread, { threadId: target.thread, sub: escaped(text(anchor).trim()).slice(0, 2000), com: escaped([field(entry, "author"), field(entry, "date")].filter(Boolean).join(" / ")) });
  }
  const previous = all.filter(n => n.nodeName === "a" && has(n, "btn") && text(n).includes("上頁") && !has(n, "disabled"));
  if (previous.length > 1) throw new PttUnsupported("PTTのページ送りを確認できません。");
  const target = previous.length ? link(previous[0]) : null;
  if (previous.length && (!target || target.board !== board || target.thread || !target.page || (page && Number(target.page) >= Number(page)))) throw new PttUnsupported("PTTのページ送りが循環または不正です。");
  return { threads: [...result.values()], previous: target?.page ?? null };
}
export function pttPosts(html: string, board: string, thread: string, accepted: boolean, fetchedAt: string): PostInfo[] {
  const all = document(html, accepted), roots = all.filter(n => attr(n, "id") === "main-content");
  if (roots.length !== 1) throw new PttUnsupported("PTTの記事が削除されたか、本文形式が変わった可能性があります。");
  const root = roots[0], meta: Record<string, string> = {};
  for (const n of root.childNodes ?? []) if (has(n, "article-metaline") || has(n, "article-metaline-right")) meta[field(n, "article-meta-tag")] = field(n, "article-meta-value");
  if (!meta["作者"] || !meta["標題"] || meta["看板"] !== board || !meta["時間"]) throw new PttUnsupported("PTTの記事情報を確認できません。旧形式・構造変更の可能性があります。");
  const body: string[] = [], notes: string[] = [], bodyNodes: Node[] = [];
  for (const n of root.childNodes ?? []) {
    if (has(n, "push") || has(n, "article-metaline") || has(n, "article-metaline-right")) continue;
    const value = text(n);
    if (has(n, "f2") && /^\s*※\s*(發信站|文章網址|編輯|轉錄者)/.test(value)) notes.push(value.trim());
    else { body.push(value); bodyNodes.push(n); }
  }
  const parts = body.join("").trim().split(/\n--\s*\n/);
  const content = [parts.shift() ?? "", parts.length ? "【署名】\n" + parts.join("\n--\n") : "", notes.length ? "【発信・編集情報】\n" + notes.join("\n") : "", `【出典】https://www.ptt.cc/bbs/${board}/${thread}.html\n取得日時: ${fetchedAt}`].filter(Boolean).join("\n\n");
  if (content.length > 200_000) throw new PttUnsupported("PTTの本文が大きすぎます。");
  const posts: PostInfo[] = [{ postId: "article:" + thread, order: 1, no: 1, name: escaped(meta["作者"]), date: escaped(meta["時間"]), sub: escaped(meta["標題"]), com: escaped(content), media: images(bodyNodes) }];
  const pushes = nodes(root).filter(n => has(n, "push"));
  if (pushes.length > 9999) throw new PttUnsupported("PTTのコメントが上限を超えています。");
  const occurrences = new Map<string, number>();
  for (const push of pushes) {
    const reaction = field(push, "push-tag"), name = field(push, "push-userid"), value = field(push, "push-content").replace(/^:\s?/, "");
    const date = field(push, "push-ipdatetime").match(/\d{2}\/\d{2}\s+\d{2}:\d{2}(?::\d{2})?$/)?.[0] ?? "";
    if (!["推", "噓", "→"].includes(reaction) || !name || !date || value.length > 20_000) throw new PttUnsupported("PTTのコメント形式を確認できません。");
    const hash = createHash("sha256").update(JSON.stringify([thread, reaction, name, date, value])).digest("hex").slice(0, 32);
    const occurrence = (occurrences.get(hash) ?? 0) + 1; occurrences.set(hash, occurrence);
    const comment = find(push, "push-content");
    posts.push({ postId: `comment:${hash}:${occurrence}`, order: posts.length + 1, no: posts.length + 1, name: escaped(name), date: escaped(date), reaction: reaction as "推" | "噓" | "→", com: escaped(value), media: comment ? images([comment]) : [] });
  }
  return posts;
}
