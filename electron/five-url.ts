export function parseFiveUrl(raw: unknown): { board: string; thread: number | null } | null {
  if (typeof raw !== "string" || raw.length > 2048 || /[\s\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol) || !/^[a-z0-9-]+\.5ch\.(io|net)$/.test(u.hostname) || u.username || u.password || u.port || u.search || u.hash) return null;
    const thread = /^\/test\/read\.cgi\/([a-zA-Z0-9_]{1,32})\/(\d{9,13})(?:\/(?:l\d+|\d+(?:-\d*)?)?)?\/?$/.exec(u.pathname);
    if (thread) return { board: thread[1], thread: Number(thread[2]) };
    const board = /^\/([a-zA-Z0-9_]{1,32})\/?$/.exec(u.pathname);
    return board ? { board: board[1], thread: null } : null;
  } catch { return null; }
}
