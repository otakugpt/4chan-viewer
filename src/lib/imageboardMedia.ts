import { normalizeImageboardImage, sourceForImage } from "../../electron/imageboard-policy";

export function imageboardThumbnail(source: ImageboardSource, full: string, thumbs?: Record<string, string>): string {
  const thumbnail = thumbs?.[full];
  if (!thumbnail || sourceForImage(thumbnail) !== source) return "";
  const safe = normalizeImageboardImage(thumbnail);
  // Never silently turn a thumbnail grid into full-size image downloads.
  return safe && safe !== normalizeImageboardImage(full) && new URL(safe).pathname.includes("/thumb/") ? safe : "";
}

export const IMAGEBOARD_SAVE_LIMIT = 100;
