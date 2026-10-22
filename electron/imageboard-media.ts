import fs from "node:fs/promises";
import { ByteResponse, responseTooLarge } from "./network";
import { IMAGE_NORMAL_LIMIT, IMAGE_HARD_LIMIT, ImagePolicyError, ConfirmLargeImage, validateImage } from "./five-media";
import { normalizeImageboardImage } from "./imageboard-policy";

interface Transport {
  generation(): number;
  assertMediaAccess(url: string, generation?: number): void;
  readMedia(url: string, limit: number, cancel?: AbortSignal): Promise<ByteResponse>;
}
interface Image { bytes: Buffer; mime: string }
interface PendingImage { promise: Promise<Image>; controller: AbortController; consumers: number }

function checkCancelled(cancel?: AbortSignal) {
  if (cancel?.aborted) throw new DOMException("Image request cancelled", "AbortError");
}
function cancellable<T>(promise: Promise<T>, ...signals: (AbortSignal | undefined)[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const active = [...new Set(signals.filter((signal): signal is AbortSignal => Boolean(signal)))];
    const cleanup = () => active.forEach(signal => signal.removeEventListener("abort", abort));
    const abort = () => { cleanup(); reject(new DOMException("Image request cancelled", "AbortError")); };
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (active.some(signal => signal.aborted)) { abort(); return; }
    active.forEach(signal => signal.addEventListener("abort", abort, { once: true }));
  });
}

export function createImageboardMedia(service: Transport, now = Date.now) {
  const cache = new Map<string, { image: Image; until: number }>();
  const pending = new Map<string, PendingImage>();
  let cacheBytes = 0;
  function stop(key: string, task: PendingImage) {
    if (pending.get(key) === task) pending.delete(key);
    task.controller.abort();
  }
  function clear() {
    cache.clear(); cacheBytes = 0;
    for (const [key, task] of pending) stop(key, task);
  }
  async function consume(key: string, task: PendingImage, cancel?: AbortSignal): Promise<Image> {
    task.consumers++;
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      task.consumers--;
      if (!task.consumers && pending.get(key) === task) stop(key, task);
    };
    // Release synchronously on abort so an immediate replacement cannot join a dead fetch.
    cancel?.addEventListener("abort", leave, { once: true });
    if (cancel?.aborted) leave();
    try { return await cancellable(task.promise, cancel, task.controller.signal); }
    finally {
      cancel?.removeEventListener("abort", leave);
      leave();
    }
  }
  function oversized(error: unknown, limit: number): { size: number; exact: boolean } | null {
    const e = error as { code?: unknown; status?: unknown; limit?: unknown; size?: unknown; exact?: unknown } | null;
    return e?.code === "RESPONSE_TOO_LARGE" && e.status === 200 && e.limit === limit &&
      typeof e.size === "number" && Number.isSafeInteger(e.size) && e.size > limit && typeof e.exact === "boolean"
      ? { size: e.size, exact: e.exact } : null;
  }
  async function read(raw: unknown, confirm?: ConfirmLargeImage, cancel?: AbortSignal): Promise<Image> {
    checkCancelled(cancel);
    const url = normalizeImageboardImage(raw);
    if (!url) throw new ImagePolicyError("Unsupported imageboard image URL");
    const generation = service.generation();
    const check = () => { checkCancelled(cancel); service.assertMediaAccess(url, generation); };
    check();
    const key = `${generation}:${url}`;
    const cached = cache.get(key);
    if (cached && cached.until > now()) return cached.image;
    if (cached) { cacheBytes -= cached.image.bytes.length; cache.delete(key); }
    // Only the normal-size attempt is shared. Large-file approval never carries to another caller.
    let task = pending.get(key);
    if (!task) {
      const controller = new AbortController();
      const promise = (async () => {
        service.assertMediaAccess(url, generation);
        const r = await service.readMedia(url, IMAGE_NORMAL_LIMIT, controller.signal);
        checkCancelled(controller.signal);
        service.assertMediaAccess(url, generation);
        if (r.body.length > IMAGE_NORMAL_LIMIT) throw responseTooLarge(IMAGE_NORMAL_LIMIT, r.body.length, true, r.status);
        const image = validate(r, url);
        if (image.bytes.length <= 4 * 1024 * 1024) {
          while (cache.size && (cache.size >= 48 || cacheBytes + image.bytes.length > 24 * 1024 * 1024)) {
            const oldest = cache.keys().next().value!;
            cacheBytes -= cache.get(oldest)!.image.bytes.length; cache.delete(oldest);
          }
          cache.set(key, { image, until: now() + 300_000 }); cacheBytes += image.bytes.length;
        }
        return image;
      })();
      task = { promise, controller, consumers: 0 };
      pending.set(key, task);
      void promise.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => {});
    }
    try { const result = await consume(key, task, cancel); check(); return result; }
    catch (error) {
      check();
      const size = oversized(error, IMAGE_NORMAL_LIMIT);
      if (!size) throw error;
      if (size.size > IMAGE_HARD_LIMIT) throw new ImagePolicyError("画像が100MBを超えるため取得を停止しました。");
      if (!confirm) throw new ImagePolicyError("20MBを超える画像の取得をキャンセルしました。");
      check();
      const approved = await cancellable(confirm({ url, ...size }), cancel);
      check();
      if (!approved) throw new ImagePolicyError("20MBを超える画像の取得をキャンセルしました。");
      let r: ByteResponse;
      try { r = await cancellable(service.readMedia(url, IMAGE_HARD_LIMIT, cancel), cancel); }
      catch (error) { check(); if (oversized(error, IMAGE_HARD_LIMIT)) throw new ImagePolicyError("画像が100MBを超えるため取得を停止しました。"); throw error; }
      check();
      if (r.body.length > IMAGE_HARD_LIMIT) throw new ImagePolicyError("画像が100MBを超えるため取得を停止しました。");
      return validate(r, url);
    }
  }
  function validate(r: ByteResponse, url: string): Image {
    if (r.status !== 200) throw new ImagePolicyError("画像を取得できません。時間をおいて再試行してください。");
    const mime = String(r.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    validateImage(r.body, mime, url);
    return { bytes: r.body, mime };
  }
  async function download(url: string, filePath: string, confirm?: ConfirmLargeImage) {
    const generation = service.generation();
    const image = await read(url, confirm);
    service.assertMediaAccess(url, generation);
    const file = await fs.open(filePath, "wx");
    try { service.assertMediaAccess(url, generation); await file.writeFile(image.bytes); service.assertMediaAccess(url, generation); }
    catch (error) { await file.close(); await fs.unlink(filePath).catch(() => {}); throw error; }
    finally { await file.close().catch(() => {}); }
  }
  return { read, download, clear };
}
