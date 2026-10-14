import React, { useEffect, useRef, useState } from "react";
import { RemoteImage } from "./RemoteImage";
import { useSave } from "./SaveProvider";
export interface MediaItem { postId: PostId; postNo: number; full: string; thumb: string; filename: string; remote?: boolean; target: ImageTarget }
export function MediaViewer({ items, initialIndex, onClose, onJump }: { items: MediaItem[]; initialIndex: number; onClose: () => void; onJump?: (postId: PostId) => void }) {
  const { busy, status, save } = useSave();
  const [index, setIndex] = useState(initialIndex);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  useEffect(() => setFailed(false), [index]);
  const item = items[index];
  const move = (offset: number) => setIndex(i => Math.max(0, Math.min(items.length - 1, i + offset)));
  return <dialog ref={dialog} className="media-viewer" aria-label="画像・動画ビューア" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => {
    if ((e.target as HTMLElement).tagName === "VIDEO") return;
    if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
  }}>
    <div className="viewer-toolbar">
      <span className="meta">{index + 1} / {items.length} · No.{item.postNo}</span>
      <div className="viewer-actions">
        <button className="ui-btn ui-btn--primary viewer-save" disabled={busy} onClick={() => void save([item.target])}>{busy ? "保存中…" : /\.webm$/i.test(item.filename) ? "この動画を保存" : "この画像を保存"}</button>
        <button className="ui-btn" onClick={onClose} autoFocus>閉じる (Esc)</button>
      </div>
    </div>
    {status && <p className="viewer-save-status" role="status"><span className="meta">保存状況（アプリ全体）: </span>{status}</p>}
    <div className="viewer-content">
      {item.remote ? <RemoteImage url={item.full} alt={`投稿 ${item.postNo}`} /> : failed ? <p role="alert">読み込めませんでした。<button className="ui-btn" onClick={() => setFailed(false)}>再試行</button></p> : /\.webm$/i.test(item.filename)
        ? <video key={item.full} src={item.full} controls onError={() => setFailed(true)} />
        : <img key={item.full} src={item.full} alt={`投稿 ${item.postNo}`} onError={() => setFailed(true)} />}
    </div>
    <div className="viewer-toolbar">
      <button className="ui-btn" disabled={index === 0} onClick={() => move(-1)}>前へ (←)</button>
      <a className="ui-btn" href={item.full} target="_blank" rel="noopener noreferrer">外部で開く</a>
      {onJump && <button className="ui-btn" onClick={() => onJump(item.postId)}>元のレスへ</button>}
      <button className="ui-btn" disabled={index === items.length - 1} onClick={() => move(1)}>次へ (→)</button>
    </div>
  </dialog>;
}
