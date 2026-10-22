import { ByteResponse, getBytes as networkGetBytes, responseTooLarge } from "./network";
import { IMAGEBOARD_BOARDS, ImageboardSource, imageboardBase, imageboardBoard, isImageboardSource,
  normalizeImageboardImage, parseImageboardUrl, sourceForImage, validImageboardCursor, validImageboardId } from "./imageboard-policy";
import { parseKomicaPosts, parseKomicaThreads, parseVichanPosts, parseVichanThreads, PostInfo, ThreadInfo } from "./imageboard-parser";

export type { ImageboardSource, PostInfo, ThreadInfo };
export { IMAGEBOARD_BOARDS, imageboardBoards } from "./imageboard-policy";
export interface ImageboardRequest {
  source: ImageboardSource; kind: "boards" | "threads" | "posts" | "resolve";
  board?: string; thread?: string; cursor?: string; url?: string;
}
export type ImageboardResult = { boards: { board: string; title: string }[] }
  | { threads: ThreadInfo[]; nextCursor: string | null } | { posts: PostInfo[] }
  | { source: ImageboardSource; board: string; thread: string | null }
  | { status: "age-confirmation-required" } | { error: string; accessDenied: true };
export type ImageboardTransport = (url: string, limit: number, headers?: Record<string, string>, cancel?: AbortSignal) => Promise<ByteResponse>;
export interface ImageboardServiceOptions {
  request?: ImageboardTransport; getBytes?: ImageboardTransport;
  spacing?: number | Partial<Record<ImageboardSource, number>>; now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}
const CONTENT_LIMIT = 8 * 1024 * 1024;
const CACHE_LIMIT = 16 * 1024 * 1024;
const MEDIA_LIMIT = 100 * 1024 * 1024;
const MIN_COOLDOWN = 5 * 60_000;
const MAX_COOLDOWN = Number.MAX_SAFE_INTEGER;
class ImageboardDenied extends Error {}
interface SourceState { tail: Promise<void>; pending: number; started: number; cooldown: number }
function header(headers: ByteResponse["headers"] | undefined, name: string): string {
  if (!headers) return "";
  const key = Object.keys(headers).find(key => key.toLowerCase() === name);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function createImageboardService(options: ImageboardServiceOptions = {}) {
  const transport: ImageboardTransport = options.request ?? options.getBytes ?? networkGetBytes;
  const now = options.now ?? Date.now;
  let accepted = false, revision = 0;
  let consentAbort = new AbortController();
  const state = Object.fromEntries(["2333chan", "komica", "lainchan"].map(source =>
    [source, { tail: Promise.resolve(), pending: 0, started: -Infinity, cooldown: 0 }])) as Record<ImageboardSource, SourceState>;
  const cache = new Map<string, { text: string; until: number; bytes: number }>();
  let cacheBytes = 0;
  const pending = new Map<string, Promise<string>>();
  const mediaPending = new Map<string, Promise<ByteResponse>>();

  function checkCancelled(signal?: AbortSignal) {
    if (signal?.aborted) throw new ImageboardDenied("Imageboard request was cancelled.");
  }
  function requestSignal(source: ImageboardSource, cancel?: AbortSignal): AbortSignal | undefined {
    if (source !== "lainchan") return cancel;
    return cancel ? AbortSignal.any([consentAbort.signal, cancel]) : consentAbort.signal;
  }
  function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    checkCancelled(signal);
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined, settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error !== undefined) reject(error); else resolve();
      };
      const abort = () => finish(new ImageboardDenied("Imageboard request was cancelled."));
      signal?.addEventListener("abort", abort, { once: true });
      if (options.sleep) {
        try { options.sleep(milliseconds).then(() => finish(), finish); }
        catch (error) { finish(error); }
      } else timer = setTimeout(() => finish(), milliseconds);
    });
  }
  function check(source: ImageboardSource, generation?: number) {
    if (generation !== undefined && generation !== revision) throw new ImageboardDenied("閲覧の同意状態が変わりました。画面を更新してください。");
    if (source === "lainchan" && !accepted) throw new ImageboardDenied("Lainchanの年齢・利用上の注意の確認が必要です。");
    if (now() < state[source].cooldown) throw new ImageboardDenied("このサイトはアクセス制限中です。最低5分、またはサイト指定の待機時間をおいて再試行してください。");
  }
  function spacing(source: ImageboardSource) {
    const value = typeof options.spacing === "number" ? options.spacing : options.spacing?.[source];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : source === "lainchan" ? 10_000 : 5_000;
  }
  function queue<T>(source: ImageboardSource, generation: number, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    checkCancelled(signal);
    const s = state[source];
    if (s.pending >= 16) return Promise.reject(new ImageboardDenied("このサイトの取得処理が混み合っています。読み込みが終わるまでお待ちください。"));
    s.pending++;
    const task = s.tail.then(async () => {
      checkCancelled(signal);
      check(source, generation);
      const delay = spacing(source) - (now() - s.started);
      if (delay > 0) await sleep(delay, signal);
      checkCancelled(signal);
      check(source, generation);
      s.started = now();
      return work();
    }).finally(() => { s.pending--; });
    s.tail = task.then(() => {}, () => {});
    return task;
  }
  function deleteCached(key: string) {
    const value = cache.get(key);
    if (value) { cacheBytes -= value.bytes; cache.delete(key); }
  }
  function restrict(source: ImageboardSource, status: unknown, headers?: ByteResponse["headers"]) {
    if (status !== 403 && status !== 429 && status !== 503) return false;
    const time = now(), raw = header(headers, "retry-after").trim();
    let retry = 0;
    if (/^\d+$/.test(raw)) {
      const seconds = Number(raw);
      retry = Number.isFinite(seconds * 1000) ? seconds * 1000 : MAX_COOLDOWN;
    } else if (raw) {
      const date = Date.parse(raw);
      if (Number.isFinite(date)) retry = Math.max(0, date - time);
    }
    state[source].cooldown = Math.min(MAX_COOLDOWN, Math.max(state[source].cooldown, time + Math.max(MIN_COOLDOWN, retry)));
    for (const key of cache.keys()) if (key.startsWith(source + ":")) deleteCached(key);
    return true;
  }
  async function fetchChecked(source: ImageboardSource, url: string, limit: number, generation: number, signal?: AbortSignal): Promise<ByteResponse> {
    checkCancelled(signal);
    check(source, generation);
    let response: ByteResponse;
    try { response = await transport(url, limit, {}, signal); }
    catch (error) {
      const e = error as { status?: unknown; headers?: ByteResponse["headers"]; code?: unknown; limit?: unknown; size?: unknown; exact?: unknown } | null;
      // The transport can reject an oversized 403 before returning a response. Never lose that restriction.
      const denied = restrict(source, e?.status, e?.headers);
      checkCancelled(signal);
      check(source, generation);
      if (denied) throw new ImageboardDenied("アクセスが制限されています。時間をおいて再試行してください。");
      if (e?.code === "RESPONSE_TOO_LARGE" && e.status === 200 && e.limit === limit &&
        typeof e.size === "number" && Number.isSafeInteger(e.size) && e.size > limit && typeof e.exact === "boolean")
        throw responseTooLarge(limit, e.size, e.exact, 200);
      throw new ImageboardDenied("取得できません。通信環境やサイトの制限を確認してください。転送・認証・自動再試行は行いません。");
    }
    restrict(source, response.status, response.headers);
    checkCancelled(signal);
    check(source, generation);
    if (response.status !== 200) throw new ImageboardDenied("指定の内容を取得できません。削除・移転・制限の可能性があります。転送先やミラーは取得しません。");
    if (header(response.headers, "content-encoding") && header(response.headers, "content-encoding").toLowerCase() !== "identity")
      throw new ImageboardDenied("Unsupported response encoding.");
    if (!Buffer.isBuffer(response.body)) throw new ImageboardDenied("Unsupported response body.");
    if (response.body.length > limit) throw responseTooLarge(limit, response.body.length, true, 200);
    return response;
  }
  async function read(source: ImageboardSource, url: string, generation: number): Promise<string> {
    check(source, generation);
    const key = `${source}:${generation}:${url}`, hit = cache.get(key);
    if (hit && hit.until > now()) {
      cache.delete(key); cache.set(key, hit);
      return hit.text;
    }
    if (hit) deleteCached(key);
    if (pending.has(key)) return pending.get(key)!;
    const signal = requestSignal(source);
    const task = queue(source, generation, async () => {
      const response = await fetchChecked(source, url, CONTENT_LIMIT, generation, signal);
      const mime = header(response.headers, "content-type");
      if (!(source === "komica" ? /^text\/html(?:\s*;|$)/i : /^application\/json(?:\s*;|$)/i).test(mime))
        throw new ImageboardDenied("サイトから未対応の形式が返されました。確認画面の自動操作は行いません。");
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(response.body); }
      catch { throw new ImageboardDenied("応答の文字コードを確認できません。"); }
      check(source, generation);
      const bytes = text.length * 2;
      if (bytes <= CACHE_LIMIT) {
        while (cache.size && (cache.size >= 16 || cacheBytes + bytes > CACHE_LIMIT)) deleteCached(cache.keys().next().value!);
        cache.set(key, { text, bytes, until: now() + (source === "lainchan" ? 120_000 : 60_000) });
        cacheBytes += bytes;
      }
      return text;
    }, signal);
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  function assertMediaAccess(raw: string, generation?: number): void {
    const url = normalizeImageboardImage(raw), source = sourceForImage(raw);
    if (!url || !source) throw new ImageboardDenied("Unsupported imageboard image URL.");
    check(source, generation);
  }
  async function readMedia(raw: string, limit: number, cancel?: AbortSignal): Promise<ByteResponse> {
    checkCancelled(cancel);
    const generation = revision;
    assertMediaAccess(raw, generation);
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MEDIA_LIMIT) throw new ImageboardDenied("Unsupported image size limit.");
    const url = normalizeImageboardImage(raw)!, source = sourceForImage(url)!;
    const key = `${generation}:${limit}:${url}`;
    // A caller-owned signal must never cancel another caller's transfer.
    if (!cancel && mediaPending.has(key)) return mediaPending.get(key)!;
    const signal = requestSignal(source, cancel);
    const task = queue(source, generation, async () => {
      assertMediaAccess(url, generation);
      const response = await fetchChecked(source, url, limit, generation, signal);
      assertMediaAccess(url, generation);
      return response;
    }, signal);
    if (cancel) return task;
    mediaPending.set(key, task);
    try { return await task; } finally { mediaPending.delete(key); }
  }
  async function request(input: unknown): Promise<ImageboardResult> {
    let cacheKey: string | undefined;
    try {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new ImageboardDenied("Invalid imageboard request.");
      const r = input as ImageboardRequest, generation = revision;
      if (!isImageboardSource(r.source)) throw new ImageboardDenied("Unsupported imageboard source.");
      if (r.source === "lainchan" && !accepted) return { status: "age-confirmation-required" };
      if (r.kind === "boards") return { boards: IMAGEBOARD_BOARDS[r.source].map(({ board, title }) => ({ board, title })) };
      if (r.kind === "resolve") {
        const target = parseImageboardUrl(r.url);
        if (!target || target.source !== r.source) throw new ImageboardDenied("このサイトで対応している板・スレッドのURLを入力してください。");
        return target;
      }
      if ((r.kind !== "threads" && r.kind !== "posts") || !imageboardBoard(r.source, r.board)) throw new ImageboardDenied("この板は未対応です。登録済みの板一覧から選択してください。");
      if (r.kind === "posts" && (!validImageboardId(r.thread) || r.cursor !== undefined)) throw new ImageboardDenied("Invalid thread request.");
      if (r.kind === "threads" && r.cursor !== undefined && (r.source !== "komica" || !validImageboardCursor(r.cursor)))
        throw new ImageboardDenied("Invalid imageboard cursor.");
      const base = imageboardBase(r.source, r.board!);
      const url = r.source === "komica"
        ? base + (r.kind === "posts" ? `pixmicat.php?res=${r.thread}` : !r.cursor || r.cursor === "0" ? "index.htm" : `${r.cursor}.htm`)
        : base + (r.kind === "posts" ? `res/${r.thread}.json` : "catalog.json");
      cacheKey = `${r.source}:${generation}:${url}`;
      const body = await read(r.source, url, generation);
      check(r.source, generation);
      if (r.source === "komica") return r.kind === "posts" ? { posts: parseKomicaPosts(body, r.thread!) } : parseKomicaThreads(body, r.cursor);
      const value: unknown = JSON.parse(body);
      return r.kind === "posts" ? { posts: parseVichanPosts(value, r.source, r.board!, r.thread!) }
        : { threads: parseVichanThreads(value, r.source, r.board!), nextCursor: null };
    } catch (error) {
      if (cacheKey) deleteCached(cacheKey);
      return { error: error instanceof ImageboardDenied ? error.message : "応答の構造を安全に確認できません。サイト変更・確認画面・削除等の可能性があるため取得を停止しました。", accessDenied: true };
    }
  }
  return {
    request, readMedia, assertMediaAccess, status: () => ({ accepted }), generation: () => revision,
    setConsent(value: boolean) {
      if (typeof value !== "boolean") throw new ImageboardDenied("Invalid consent value.");
      accepted = value; revision++; cache.clear(); cacheBytes = 0;
      const previous = consentAbort;
      consentAbort = new AbortController();
      previous.abort();
    },
  };
}
