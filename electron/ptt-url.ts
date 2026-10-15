export const validPttBoard = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value) && !["constructor", "prototype", "__proto__"].includes(value);
export const validPttId = (value: unknown): value is string => typeof value === "string" && /^[MG]\.\d{1,16}\.A\.[A-Fa-f0-9]{3}$/.test(value);
export function parsePttUrl(value: unknown): { board: string; thread: string | null; page: string | null } | null {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.hostname !== "www.ptt.cc" || u.username || u.password || u.port || u.search || u.hash) return null;
    const m = /^\/bbs\/([^/]+)\/(index([1-9]\d{0,7})?|[MG]\.\d{1,16}\.A\.[A-Fa-f0-9]{3})\.html$/.exec(u.pathname);
    if (!m || !validPttBoard(m[1])) return null;
    return { board: m[1], thread: m[2].startsWith("index") ? null : m[2], page: m[3] ?? null };
  } catch { return null; }
}
