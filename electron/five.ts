import { getBytes, serialQueue } from "./network";
import { extractImages } from "./five-media";

const MENU = "https://menu.5ch.io/bbsmenu.html";
const MAX = 4 * 1024 * 1024;
const boardPattern = /^[a-zA-Z0-9_]{1,32}$/;
const hostPattern = /^[a-z0-9-]+\.5ch\.io$/;
type Board = BoardInfo & { host: string };
export function parseMenu(html: string): Board[] {
  const boards = new Map<string, Board>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']?(https?:\/\/[^\s"'<>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1]);
      const board = url.pathname.replace(/^\/|\/$/g, "");
      if (hostPattern.test(url.hostname) && boardPattern.test(board) && !url.username && !url.password && !url.port && !url.search && !url.hash) {
        boards.set(board, { board, host: url.hostname, title: match[2].replace(/<[^>]*>/g, "").slice(0, 200) });
      }
    } catch { /* Ignore unrelated menu links. */ }
  }
  return [...boards.values()];
}
export function parseSubjects(text: string): ThreadInfo[] {
  return text.split(/\r?\n/).flatMap(line => {
    const m = /^(\d{9,13})\.dat<>(.*)\s+\((\d+)\)\s*$/.exec(line);
    return m ? [{ no: Number(m[1]), sub: m[2].trim(), replies: Number(m[3]) }] : [];
  }).slice(0, 5000);
}
export function parseDat(text: string): PostInfo[] {
  const lines = text.replace(/\r/g, "").split("\n");
  if (!lines[lines.length - 1]) lines.pop();
  if (!lines.some(line => line.split("<>").length >= 5)) throw new Error("Invalid DAT");
  return lines.slice(0, 10000).map((line, index) => {
    const fields = line.split("<>");
    if (fields.length < 5) return { no: index + 1, com: "（取得できないレス）" };
    return { no: index + 1, name: fields[0], date: fields[2], id: /\bID:([^\s<>]+)/.exec(fields[2])?.[1], com: fields[3], media: extractImages(fields[3]) };
  });
}
export function parseFiveUrl(raw: unknown): { board: string; thread: number | null } | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol) || !/^[a-z0-9-]+\.5ch\.(io|net)$/.test(u.hostname) || u.username || u.password || u.port || u.search || u.hash) return null;
    const thread = /^\/test\/read\.cgi\/([a-zA-Z0-9_]{1,32})\/(\d{9,13})(?:\/(?:l\d+|\d+(?:-\d*)?)?)?\/?$/.exec(u.pathname);
    if (thread) return { board: thread[1], thread: Number(thread[2]) };
    const board = /^\/([a-zA-Z0-9_]{1,32})\/?$/.exec(u.pathname);
    return board ? { board: board[1], thread: null } : null;
  } catch { return null; }
}
const queue = serialQueue(1000, 12);
let menu: Board[] = [], menuAt = 0, recheckedAt = 0;
class FiveError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
async function recheckMenu() {
  if (Date.now() - recheckedAt < 60_000) return menu;
  recheckedAt = Date.now();
  return getMenu(true);
}
const cache = new Map<string, { body: Buffer; at: number; fullAt: number }>();
function store(url: string, body: Buffer, fullAt: number) {
  cache.delete(url); cache.set(url, { body, at: Date.now(), fullAt });
  while (cache.size > 24 || [...cache.values()].reduce((sum, item) => sum + item.body.length, 0) > 32 * 1024 * 1024) cache.delete(cache.keys().next().value!);
}
const decode = (b: Buffer) => new TextDecoder("shift_jis").decode(b);
async function getMenu(force = false) {
  if (force || !menu.length || Date.now() - menuAt > 3600_000) {
    const r = await getBytes(MENU, MAX);
    if (r.status !== 200) throw new Error("板一覧を取得できませんでした。");
    const result = parseMenu(decode(r.body));
    if (!result.length) throw new Error("板一覧の形式が変わった可能性があります。");
    menu = result; menuAt = Date.now();
  }
  return menu;
}
async function getDocument(url: string, dat: boolean) {
  const old = cache.get(url);
  if (old && Date.now() - old.at < (dat ? 10_000 : 30_000)) return old.body;
  const range = dat && old && old.body.length > 0 && Date.now() - old.fullAt < 300_000;
  let fullAt = Date.now();
  let r = await getBytes(url, MAX, range ? { Range: `bytes=${old.body.length - 1}-` } : {});
  if (range && r.status === 206) {
    const header = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(r.headers["content-range"]));
    if (header && Number(header[1]) === old.body.length - 1 && Number(header[2]) - Number(header[1]) + 1 === r.body.length &&
        Number(header[3]) === Number(header[2]) + 1 && Number(header[3]) <= MAX && r.body[0] === old.body[old.body.length - 1]) {
      r = { ...r, status: 200, body: Buffer.concat([old.body, r.body.subarray(1)]) };
      fullAt = old.fullAt;
    } else r = await getBytes(url, MAX);
  } else if (r.status === 416) r = await getBytes(url, MAX);
  if (r.status === 404 || r.status === 410) throw new FiveError(dat ? "THREAD_UNAVAILABLE" : "BOARD_UNAVAILABLE", dat ? "スレッドを取得できません（削除・DAT落ち等）。原因は確定できません。板一覧から別のスレッドを確認してください。" : "板を取得できません。公式一覧の再確認後も移転先が見つからない場合は、時間を置いて再試行してください。");
  if (r.status === 403) throw new FiveError("FORBIDDEN", "5ch側でアクセスが拒否されました。ログイン回避などは行いません。時間を置いて再試行してください。");
  if (r.status === 429) throw new FiveError("RATE_LIMITED", "5ch側のアクセス頻度制限です。しばらく待ってから更新してください。");
  if (r.status >= 500) throw new FiveError("SERVER_ERROR", "5chサーバーが応答できません。時間を置いて再試行してください。");
  if (r.status !== 200 || /<html|<!doctype/i.test(r.body.subarray(0, 256).toString())) throw new FiveError("INVALID_RESPONSE", "5chの応答形式が想定と異なります。時間を置いて再試行してください。");
  if (dat) parseDat(decode(r.body));
  store(url, r.body, fullAt);
  return r.body;
}
export function fiveRequest(input: unknown): Promise<FiveResult> {
  if (!input || typeof input !== "object") return Promise.resolve({ error: "不正な要求です。" });
  const r = input as FiveRequest;
  if (!["boards", "threads", "posts", "resolve"].includes(r.kind)) return Promise.resolve({ error: "不正な要求です。" });
  if ((r.kind === "threads" || r.kind === "posts") && (typeof r.board !== "string" || !boardPattern.test(r.board))) return Promise.resolve({ error: "不正な板名です。" });
  if (r.kind === "posts" && (!Number.isSafeInteger(r.thread) || !/^\d{9,13}$/.test(String(r.thread)))) return Promise.resolve({ error: "不正なスレッドです。" });
  const resolved = r.kind === "resolve" ? parseFiveUrl(r.url) : null;
  if (r.kind === "resolve" && !resolved) return Promise.resolve({ error: "5chの板・スレッドURLを指定してください。" });
  return queue(async (): Promise<FiveResult> => {
    const boards = await getMenu();
    if (r.kind === "boards") return { boards: boards.map(({ board, title }) => ({ board, title })) };
    let board = boards.find(b => b.board === (resolved?.board ?? (r as { board: string }).board));
    if (!board) board = (await recheckMenu()).find(b => b.board === (resolved?.board ?? (r as { board: string }).board));
    if (!board) return { error: "公式板一覧にない板です。URLや板名を確認してください。", code: "BOARD_UNKNOWN" };
    if (resolved) return resolved;
    if (r.kind === "threads" || r.kind === "posts") {
      const read = async (target: Board): Promise<FiveResult> => r.kind === "threads"
        ? { threads: parseSubjects(decode(await getDocument(`https://${target.host}/${target.board}/subject.txt`, false))) }
        : { posts: parseDat(decode(await getDocument(`https://${target.host}/${target.board}/dat/${r.thread}.dat`, true))) };
      try { return await read(board); }
      catch (error) {
        const code = (error as { code?: string }).code;
        if (error instanceof FiveError && !["THREAD_UNAVAILABLE", "BOARD_UNAVAILABLE", "INVALID_RESPONSE"].includes(code ?? "")) throw error;
        // Never follow an upstream Location header; resolve migration from the official menu only.
        let updated: Board | undefined;
        try { updated = (await recheckMenu()).find(b => b.board === board!.board); }
        catch { throw new FiveError("MENU_UNAVAILABLE", "取得に失敗し、公式板一覧の再確認もできませんでした。移転の有無は不明です。時間を置いて再試行してください。"); }
        if (updated && updated.host !== board.host) return read(updated);
        if (code === "REDIRECT") throw new FiveError("MOVE_UNCONFIRMED", "転送を検出しましたが、公式板一覧では移転先を確認できません。安全のため転送先には接続していません。");
        throw error;
      }
    }
    return { error: "不正な要求です。" };
  }).catch(error => ({ code: error instanceof FiveError ? error.code : "NETWORK_ERROR", error: error instanceof Error && /[ぁ-んァ-ヶ一-龯]/.test(error.message) ? error.message : "5chへの接続に失敗しました。しばらく待って再試行してください。" }));
}
