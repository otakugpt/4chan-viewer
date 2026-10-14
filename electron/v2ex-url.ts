export function validV2exNode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) && !["constructor", "prototype", "__proto__"].includes(value);
}
export function validV2exId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
}
export function parseV2exUrl(raw: unknown): { board: string | null; thread: string | null } | null {
  if (typeof raw !== "string" || raw.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port ||
        !["v2ex.com", "www.v2ex.com", "edge.v2ex.com", "hk.v2ex.com", "us.v2ex.com"].includes(url.hostname)) return null;
    if (url.search && !/^\?p=[1-9]\d{0,3}$/.test(url.search)) return null;
    if (url.hash && !/^#reply\d{0,8}$/.test(url.hash)) return null;
    const topic = /^\/t\/([1-9]\d*)\/?$/.exec(url.pathname);
    if (topic && validV2exId(topic[1])) return { board: null, thread: topic[1] };
    const node = /^\/go\/([^/]+)\/?$/.exec(url.pathname);
    return node && validV2exNode(node[1]) ? { board: node[1], thread: null } : null;
  } catch { return null; }
}
