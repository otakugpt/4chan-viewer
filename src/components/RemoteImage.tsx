import React, { useEffect, useState } from "react";
import { normalizeImageboardImage } from "../../electron/imageboard-policy";

// Only IPC-validated bytes are displayed; a remote URL is never assigned to img.src.
export function RemoteImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true, objectUrl = "";
    setSrc(""); setError("");
    const imageboardUrl = normalizeImageboardImage(url);
    const id = imageboardUrl ? crypto.randomUUID() : null;
    const request = id ? window.electron.imageboardImage({ id, url: imageboardUrl! }) : window.electron.fiveImage(url);
    request.then(result => {
      if (!active) return;
      if ("error" in result) { setError(result.error); return; }
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: result.mime }));
      setSrc(objectUrl);
    }).catch(() => { if (active) setError("画像の読み込みに失敗しました。"); });
    return () => {
      active = false;
      if (id) {
        try { void window.electron.cancelImageboardImage(id).catch(() => {}); }
        catch { /* IPC may already be unavailable during shutdown. */ }
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, attempt]);
  if (error) return <span className="media-error" role="status">{error}<button className="ui-btn" onClick={e => { e.stopPropagation(); setAttempt(a => a + 1); }}>再試行</button></span>;
  return src ? <img src={src} alt={alt} className={className} onError={() => setError("画像を表示できませんでした。")} /> : <span className="media-placeholder" role="status">画像を読み込み中…</span>;
}
