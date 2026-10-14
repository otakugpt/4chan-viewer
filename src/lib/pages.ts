export class PageAccessError extends Error {
  constructor(public status: "age-confirmation-required" | "unavailable", message?: string) {
    super(message ?? (status === "age-confirmation-required" ? "年齢確認が必要です。このサイトはまだ閲覧できません。" : "このサイトの閲覧はまだ利用できません。"));
  }
}
export function readyPage<T>(items: T[], nextCursor: string | null = null): PageResult<T> {
  return { status: "ready", items, nextCursor };
}
export function requireReadyPage<T>(page: PageResult<T>): Extract<PageResult<T>, { status: "ready" }> {
  if (page.status !== "ready") throw new PageAccessError(page.status);
  if (!Array.isArray(page.items) || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor.length || page.nextCursor.length > 256 || /[\u0000-\u0020]/.test(page.nextCursor)))) throw new Error("Invalid page response");
  return page;
}
export function mergePage<T>(current: T[], next: T[], identity: (item: T) => string): T[] {
  const result = new Map(current.map(item => [identity(item), item]));
  for (const item of next) result.set(identity(item), item);
  return [...result.values()];
}
