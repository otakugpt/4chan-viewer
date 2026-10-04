import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

export type TranslationResult = { translatedText: string } | { error: string };

export function isTrustedDocument(actual: string, expected: string): boolean {
  try {
    const url = new URL(actual);
    const trusted = new URL(expected);
    url.hash = trusted.hash = "";
    return url.href === trusted.href;
  } catch {
    return false;
  }
}

export function normalizeDownloadUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "i.4cdn.org" ||
        url.port || url.username || url.password || url.search || url.hash ||
        !/^\/[a-z0-9]+\/\d+\.(jpg|jpeg|png|gif|webm)$/i.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function translateText(
  input: unknown,
  apiKey: string | undefined,
  request: typeof fetch = fetch,
): Promise<TranslationResult> {
  if (typeof input !== "string" || !input.trim()) return { error: "Missing text" };
  if (input.length > 4000) return { error: "Text too long (maximum 4000 characters)" };
  if (!apiKey?.trim()) return { error: "Translation unavailable: DEEPL_API_KEY is not set" };
  try {
    const response = await request("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `DeepL-Auth-Key ${apiKey.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: [input.trim()], target_lang: "JA" }),
    });
    if (!response.ok) return { error: `Translation failed (HTTP ${response.status})` };
    const data = await response.json() as { translations?: { text?: unknown }[] };
    const text = data?.translations?.[0]?.text;
    if (typeof text !== "string" || !text) return { error: "Invalid translation response" };
    return { translatedText: text };
  } catch {
    // Never forward upstream exceptions or request headers containing credentials.
    return { error: "Translation failed or timed out. Please retry." };
  }
}

let downloadQueue: Promise<void> = Promise.resolve();
let lastFetch = 0;

export function downloadImage(url: string, filePath: string): Promise<void> {
  const task = downloadQueue.then(async () => {
    if (!normalizeDownloadUrl(url)) throw new Error("Unsupported image URL");
    const wait = 1200 - (Date.now() - lastFetch);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastFetch = Date.now();
    const signal = AbortSignal.timeout(60_000);
    const response = await fetch(url, {
      redirect: "error",
      signal,
      headers: { Referer: "https://boards.4chan.org/" },
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    let file: Awaited<ReturnType<typeof fs.promises.open>>;
    try {
      file = await fs.promises.open(filePath, "wx");
    } catch (error) {
      await response.body.cancel();
      throw error;
    }
    try {
      await pipeline(
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
        file.createWriteStream(),
        { signal },
      );
    } catch (error) {
      await file.close().catch(() => {});
      await fs.promises.unlink(filePath).catch(() => {});
      throw error;
    }
  });
  downloadQueue = task.catch(() => {});
  return task;
}
