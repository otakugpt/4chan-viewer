import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { getBytes, serialQueue } from "./network";

export function normalizeFiveImage(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return null;
    const valid = (u.hostname === "i.imgur.com" && /^\/[a-zA-Z0-9]{5,16}\.(jpg|jpeg|png|gif|webp)$/i.test(u.pathname)) ||
      (["i.postimg.cc", "i.ibb.co"].includes(u.hostname) && /^\/[a-zA-Z0-9]{6,16}\/[a-zA-Z0-9_-]{1,100}\.(jpg|jpeg|png|gif|webp)$/i.test(u.pathname));
    return valid ? u.href : null;
  } catch { return null; }
}
export function imageFilename(url: string) {
  return createHash("sha256").update(url).digest("hex").slice(0, 24) + "." + new URL(url).pathname.split(".").pop()!.toLowerCase();
}
export function extractImages(html: string): string[] {
  const urls = html.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return [...new Set(urls.map(url => normalizeFiveImage(url.replace(/&amp;/g, "&"))).filter((url): url is string => Boolean(url)))].slice(0, 100);
}
export function validateImage(body: Buffer, mime: string, url: string): void {
  const ext = new URL(url).pathname.split(".").pop()!.toLowerCase();
  const format = ext === "jpg" ? "jpeg" : ext;
  const magic = format === "jpeg" ? body[0] === 255 && body[1] === 216 && body[2] === 255 :
    format === "png" ? body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
    format === "gif" ? /^(GIF87a|GIF89a)$/.test(body.subarray(0, 6).toString("ascii")) :
    format === "webp" ? body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP" : false;
  if (!magic || mime !== `image/${format}`) throw new Error("Not a supported image");
  let width = 0, height = 0;
  if (format === "png" && body.length >= 24 && body.subarray(12, 16).toString() === "IHDR") { width = body.readUInt32BE(16); height = body.readUInt32BE(20); }
  else if (format === "gif" && body.length >= 10) { width = body.readUInt16LE(6); height = body.readUInt16LE(8); }
  else if (format === "webp" && body.length >= 30) {
    const chunk = body.subarray(12, 16).toString();
    if (chunk === "VP8X") { width = body.readUIntLE(24, 3) + 1; height = body.readUIntLE(27, 3) + 1; }
    else if (chunk === "VP8L" && body[20] === 47) {
      const bits = body.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (chunk === "VP8 " && body.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) { width = body.readUInt16LE(26) & 0x3fff; height = body.readUInt16LE(28) & 0x3fff; }
  } else if (format === "jpeg") {
    for (let offset = 2; offset + 9 < body.length;) {
      if (body[offset] !== 255) break;
      if (body[offset + 1] === 255) { offset++; continue; }
      const marker = body[offset + 1], size = body.readUInt16BE(offset + 2);
      if (size < 2 || offset + 2 + size > body.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (size < 8) break;
        height = body.readUInt16BE(offset + 5); width = body.readUInt16BE(offset + 7); break;
      }
      offset += size + 2;
    }
  }
  if (!width || !height || width > 16384 || height > 16384 || width * height > 16_000_000) throw new Error("Image dimensions exceed limits");
}
const queue = serialQueue(750);
export function readFiveImage(raw: unknown) {
  const url = normalizeFiveImage(raw);
  if (!url) return Promise.reject(new Error("Unsupported image URL"));
  return queue(async () => {
    const r = await getBytes(url, 8 * 1024 * 1024);
    if (r.status !== 200) throw new Error("Image unavailable");
    const mime = String(r.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    validateImage(r.body, mime, url);
    return { bytes: r.body, mime };
  });
}
export async function downloadFiveImage(url: string, filePath: string) {
  const image = await readFiveImage(url);
  const file = await fs.open(filePath, "wx");
  try { await file.writeFile(image.bytes); }
  catch (error) { await file.close(); await fs.unlink(filePath).catch(() => {}); throw error; }
  finally { await file.close().catch(() => {}); }
}
