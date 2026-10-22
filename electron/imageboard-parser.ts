import { parse, parseFragment } from "parse5";
import { boardForImage, imageboardBase, ImageboardSource, normalizeImageboardImage, parseImageboardUrl,
  sourceForImage, validImageboardId } from "./imageboard-policy";

export interface ThreadInfo {
  threadId: string; sub?: string; com?: string; replies?: number; images?: number;
  media?: string[]; mediaThumbs?: Record<string, string>; spoiler?: boolean; categories?: string[];
}
export interface PostInfo {
  no: number; postId: string; order: number; sub?: string; com?: string; name?: string; date?: string;
  id?: string; media: string[]; mediaThumbs?: Record<string, string>; spoiler?: boolean;
}
interface Node { nodeName: string; value?: string; childNodes?: Node[]; attrs?: { name: string; value: string }[] }
type Row = Record<string, unknown>;
const attr = (n: Node, key: string) => n.attrs?.find(a => a.name === key)?.value ?? "";
const has = (n: Node, name: string) => attr(n, "class").split(/\s+/).includes(name);
const excluded = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "form", "button", "input", "img", "video", "audio", "svg", "math"]);
const block = new Set(["p", "div", "blockquote", "li", "pre"]);
function nodes(root: Node): Node[] {
  const result: Node[] = [], stack: [Node, number][] = [[root, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (depth > 128 || result.length >= 100_000) throw new Error("Imageboard HTML exceeds complexity limits");
    result.push(node);
    for (const child of [...(node.childNodes ?? [])].reverse()) stack.push([child, depth + 1]);
  }
  return result;
}
interface TextContext { base: string; links: number }
function text(node: Node, context?: TextContext): string {
  if (node.nodeName === "#text") return node.value ?? "";
  if (excluded.has(node.nodeName) || has(node, "postvote-slot")) return "";
  if (node.nodeName === "br") return "\n";
  const label = (node.childNodes ?? []).map(child => text(child, context)).join("");
  if (context && node.nodeName === "a" && context.links < 100) {
    const raw = attr(node, "href");
    if (raw && raw.length <= 2048 && !/[\s\\\x00-\x1f\x7f]/.test(raw) && !/%(?:00|0a|0d)/i.test(raw)) {
      try {
        const url = new URL(raw, context.base);
        if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && url.href.length <= 2048) {
          context.links++;
          return label.trim() === url.href ? label : `${label}${label ? " " : ""}${url.href}`;
        }
      } catch { /* Invalid links retain only their visible label. */ }
    }
  }
  return label + (block.has(node.nodeName) ? "\n" : "");
}
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const clean = (s: string) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim().slice(0, 100_000);
export function imageboardPlainText(raw: unknown, base?: string): string {
  if (typeof raw !== "string") return "";
  if (raw.length > 1_000_000) throw new Error("Imageboard field exceeds limits");
  const root = parseFragment(raw) as Node;
  nodes(root);
  return clean(text(root, base ? { base, links: 0 } : undefined));
}
export const safeImageboardComment = (raw: unknown, base?: string) => escape(imageboardPlainText(raw, base));
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid imageboard record");
  return value as Row;
}
function id(value: unknown): string {
  const result = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (!validImageboardId(result)) throw new Error("Invalid imageboard post ID");
  return result;
}
const flag = (value: unknown) => value !== undefined && value !== null && value !== false && value !== 0 && value !== "0" && value !== "";
const count = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
function attachmentMedia(row: Row, source: ImageboardSource, board: string) {
  const media = new Set<string>(), mediaThumbs: Record<string, string> = {};
  let spoiler = false;
  if (row.extra_files !== undefined && (!Array.isArray(row.extra_files) || row.extra_files.length > 100)) throw new Error("Invalid imageboard attachments");
  for (const file of [row, ...(row.extra_files as unknown[] ?? [])].map(object)) {
    if (flag(file.spoiler) || /spoiler/i.test(String(file.thumb ?? ""))) { spoiler = true; continue; }
    if (flag(file.filedeleted)) continue;
    const timestamp = typeof file.tim === "number" && Number.isSafeInteger(file.tim) ? String(file.tim) : file.tim;
    if (typeof timestamp !== "string" || !/^[1-9]\d{8,19}(?:-\d{1,8})?$/.test(timestamp) ||
      typeof file.ext !== "string" || !/^\.(jpg|jpeg|png|gif|webp)$/.test(file.ext)) continue;
    const base = imageboardBase(source, board), url = normalizeImageboardImage(base + "src/" + timestamp + file.ext);
    if (!url) continue;
    media.add(url);
    // Vichan JSON reports thumbnail dimensions; do not guess a thumbnail when they are absent.
    if (count(file.tn_w) && count(file.tn_h)) {
      const extension = typeof file.thumb_ext === "string" && /^\.(jpg|jpeg|png|gif|webp)$/.test(file.thumb_ext) ? file.thumb_ext : ".png";
      const thumb = normalizeImageboardImage(base + "thumb/" + timestamp + extension);
      if (thumb) mediaThumbs[url] = thumb;
    }
  }
  return { media: [...media], ...(Object.keys(mediaThumbs).length ? { mediaThumbs } : {}), ...(spoiler ? { spoiler: true } : {}) };
}
function vichanPost(row: Row, source: ImageboardSource, board: string, order: number): PostInfo {
  const postId = id(row.no);
  const date = typeof row.time === "number" && Number.isFinite(row.time) && row.time > 0 && row.time < 253402300800
    ? new Date(row.time * 1000).toISOString() : imageboardPlainText(row.now).slice(0, 100);
  return { no: Number(postId), postId, order, sub: safeImageboardComment(row.sub), com: safeImageboardComment(row.com, imageboardBase(source, board)),
    name: imageboardPlainText(row.name).slice(0, 500), date, id: imageboardPlainText(row.id).slice(0, 100),
    ...attachmentMedia(row, source, board) };
}
export function parseVichanThreads(value: unknown, source: ImageboardSource, board: string): ThreadInfo[] {
  imageboardBase(source, board);
  if (!Array.isArray(value) || value.length > 200) throw new Error("Invalid imageboard catalog");
  const result = new Map<string, ThreadInfo>();
  let total = 0;
  for (const page of value) {
    const rows = object(page).threads;
    if (!Array.isArray(rows) || (total += rows.length) > 5000) throw new Error("Invalid imageboard catalog threads");
    for (const value of rows) {
      const row = object(value), threadId = id(row.no);
      if (row.resto !== undefined && row.resto !== 0 && row.resto !== "0") throw new Error("Catalog contains a reply");
      if (result.has(threadId)) continue;
      result.set(threadId, { threadId, sub: safeImageboardComment(row.sub), com: safeImageboardComment(row.com, imageboardBase(source, board)),
        replies: count(row.replies), images: count(row.images), ...attachmentMedia(row, source, board) });
    }
  }
  return [...result.values()];
}
export function parseVichanPosts(value: unknown, source: ImageboardSource, board: string, thread: string): PostInfo[] {
  imageboardBase(source, board);
  if (!validImageboardId(thread)) throw new Error("Invalid requested thread");
  const rows = object(value).posts;
  if (!Array.isArray(rows) || !rows.length || rows.length > 10000) throw new Error("Invalid imageboard thread");
  const result = new Map<string, PostInfo>();
  for (const [index, value] of rows.entries()) {
    const row = object(value), postId = id(row.no);
    if (index === 0 && (postId !== thread || (row.resto !== undefined && row.resto !== 0 && row.resto !== "0"))) throw new Error("Thread identity mismatch");
    if (index > 0 && postId !== thread && row.resto !== undefined && id(row.resto) !== thread) throw new Error("Reply identity mismatch");
    if (!result.has(postId)) result.set(postId, vichanPost(row, source, board, result.size + 1));
  }
  return [...result.values()];
}
function document(html: string) {
  if (Buffer.byteLength(html) > 8 * 1024 * 1024) throw new Error("Imageboard HTML exceeds size limit");
  const all = nodes(parse(html) as Node);
  if (all.some(n => (n.nodeName === "meta" && attr(n, "http-equiv").toLowerCase() === "refresh") ||
    /^(?:challenge-form|cf-chl-widget|age-confirmation|over18-notice)$/.test(attr(n, "id")) ||
    (n.nodeName === "title" && /just a moment|access denied|age verification|verify you are human/i.test(text(n))) ||
    (n.nodeName === "form" && /(?:\/|\b)(?:login|over18|agecheck|challenge)(?:[/?._-]|$)/i.test(attr(n, "action")))))
    throw new Error("Imageboard access gate; automatic interaction is disabled");
  return all;
}
const field = (all: Node[], name: string, base?: string) => {
  const found = all.find(n => has(n, name));
  return found ? clean(text(found, base ? { base, links: 0 } : undefined)) : "";
};
function komicaId(node: Node, all: Node[]): string {
  const candidates = [attr(node, "data-no"), /^r(\d+)$/.exec(attr(node, "id"))?.[1] ?? ""];
  for (const n of all) {
    if (n.nodeName === "input" && attr(n, "type") === "checkbox" && /^\d+$/.test(attr(n, "name"))) candidates.push(attr(n, "name"));
    if (has(n, "qlink") && attr(n, "data-no")) candidates.push(attr(n, "data-no"));
  }
  const ids = [...new Set(candidates.filter(Boolean).map(id))];
  if (ids.length > 1) throw new Error("Conflicting Komica post IDs");
  if (ids.length) return ids[0];
  const linked = komicaThreadLinks(all);
  if (has(node, "threadpost") && linked.length === 1) return linked[0];
  throw new Error("Missing Komica post ID");
}
function komicaThreadLinks(all: Node[]): string[] {
  const ids = new Set<string>();
  for (const n of all) {
    if (n.nodeName !== "a") continue;
    try {
      const url = new URL(attr(n, "href"), imageboardBase("komica", "00b"));
      // Reply anchors are harmless, but do not accept arbitrary fragments in public URL resolution.
      if (url.hash && !/^#r?[1-9]\d*$/.test(url.hash)) continue;
      url.hash = "";
      const target = parseImageboardUrl(url.href);
      if (target?.source === "komica" && target.board === "00b" && target.thread) ids.add(target.thread);
    } catch { /* A malformed external link is not a thread identity. */ }
  }
  return [...ids];
}
function komicaMedia(root: Node) {
  const media = new Set<string>(), mediaThumbs: Record<string, string> = {};
  let spoiler = false;
  const walk = (node: Node) => {
    if (has(node, "spoiler") || has(node, "file-spoiler") || attr(node, "data-spoiler") === "1") { spoiler = true; return; }
    if (has(node, "quote") || excluded.has(node.nodeName)) return;
    if (node.nodeName === "a") {
      const children = nodes(node);
      if (children.some(n => /spoiler/i.test(attr(n, "src")) || has(n, "spoiler"))) { spoiler = true; return; }
      const candidate = attr(node, "data-expanded-image-url") || attr(node, "href");
      let full: string | null = null;
      try { full = normalizeImageboardImage(new URL(candidate, imageboardBase("komica", "00b")).href); } catch { /* Ignore foreign links. */ }
      if (full && sourceForImage(full) === "komica" && boardForImage(full) === "00b" && new URL(full).pathname.startsWith("/src/")) {
        media.add(full);
        for (const child of children.filter(n => n.nodeName === "img")) {
          try {
            const thumb = normalizeImageboardImage(new URL(attr(child, "src"), imageboardBase("komica", "00b")).href);
            if (thumb && sourceForImage(thumb) === "komica" && new URL(thumb).pathname.startsWith("/thumb/")) mediaThumbs[full] = thumb;
          } catch { /* No thumbnail is safer than an unverified fallback. */ }
        }
      }
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(root);
  // An explicit spoiler marker can be separate from the file link; suppress all files in that post.
  if (spoiler) return { media: [] as string[], spoiler: true };
  return { media: [...media].slice(0, 100), ...(Object.keys(mediaThumbs).length ? { mediaThumbs } : {}) };
}
function komicaPost(root: Node, order: number): PostInfo {
  const all = nodes(root), postId = komicaId(root, all);
  if (!all.some(n => has(n, "quote"))) throw new Error("Unsupported Komica post body");
  return { no: Number(postId), postId, order, sub: escape(field(all, "title")), com: escape(field(all, "quote", imageboardBase("komica", "00b"))),
    name: field(all, "name").slice(0, 500), date: field(all, "now").slice(0, 200), ...komicaMedia(root) };
}
function categories(all: Node[]): string[] {
  const result = new Set<string>();
  for (const root of all.filter(n => has(n, "category"))) for (const n of nodes(root)) {
    if (n.nodeName !== "a") continue;
    try {
      const url = new URL(attr(n, "href"), imageboardBase("komica", "00b"));
      if (url.origin === "https://gaia.komica1.org" && url.pathname === "/00b/pixmicat.php" && url.searchParams.get("mode") === "category")
        result.add(clean(text(n)).slice(0, 100));
    } catch { /* Category labels are display-only, never fetch targets. */ }
  }
  return [...result].filter(Boolean).slice(0, 20);
}
export function parseKomicaThreads(html: string, cursor = "0"): { threads: ThreadInfo[]; nextCursor: string | null } {
  const all = document(html), roots = all.filter(n => has(n, "post") && has(n, "threadpost"));
  if (!all.some(n => attr(n, "id") === "threads") || roots.length > 200) throw new Error("Unsupported Komica listing");
  const result = new Map<string, ThreadInfo>();
  for (const root of roots) {
    const children = nodes(root), post = komicaPost(root, 1);
    if (!komicaThreadLinks(children).includes(post.postId)) throw new Error("Komica thread link missing or mismatched");
    if (!result.has(post.postId)) result.set(post.postId, { threadId: post.postId, sub: post.sub, com: post.com,
      media: post.media, mediaThumbs: post.mediaThumbs, spoiler: post.spoiler, categories: categories(children) });
  }
  const next = Number(cursor) + 1;
  const nextCursor = next <= 199 && all.some(n => {
    const raw = n.nodeName === "a" ? attr(n, "href") : n.nodeName === "form" ? attr(n, "action") : "";
    if (!raw) return false;
    try {
      const url = new URL(raw, imageboardBase("komica", "00b"));
      return url.origin === "https://gaia.komica1.org" && !url.username && !url.password && !url.search && !url.hash && url.pathname === `/00b/${next}.htm`;
    } catch { return false; }
  }) ? String(next) : null;
  return { threads: [...result.values()], nextCursor };
}
export function parseKomicaPosts(html: string, thread: string): PostInfo[] {
  if (!validImageboardId(thread)) throw new Error("Invalid requested thread");
  const all = document(html), roots = all.filter(n => has(n, "post") && (has(n, "threadpost") || has(n, "reply")));
  if (!roots.length || roots.length > 10000 || roots.filter(n => has(n, "threadpost")).length !== 1 || !has(roots[0], "threadpost"))
    throw new Error("Unsupported Komica thread");
  const result = new Map<string, PostInfo>();
  for (const root of roots) {
    const post = komicaPost(root, result.size + 1);
    if (!result.size && post.postId !== thread) throw new Error("Komica thread identity mismatch");
    if (!result.has(post.postId)) result.set(post.postId, post);
  }
  return [...result.values()];
}
