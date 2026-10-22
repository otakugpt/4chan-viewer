import { parseImageboardUrl } from "../../electron/imageboard-policy";

// Share the pure fixed-host parser; only main performs resolution and network access.
export function imageboardUrlSource(raw: string): ImageboardSource | null {
  return parseImageboardUrl(raw)?.source ?? null;
}
