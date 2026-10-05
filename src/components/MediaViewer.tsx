import React, { useEffect, useRef, useState } from "react";
import { RemoteImage } from "./RemoteImage";
export interface MediaItem { postNo: number; full: string; thumb: string; filename: string; remote?: boolean }
export function MediaViewer({ items, initialIndex, onClose, onJump }: { items: MediaItem[]; initialIndex: number; onClose: () => void; onJump?: (no: number) => void }) {
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
      <button className="ui-btn" onClick={onClose} autoFocus>閉じる (Esc)</button>
    </div>
    <div className="viewer-content">
      {item.remote ? <RemoteImage url={item.full} alt={`投稿 ${item.postNo}`} /> : failed ? <p role="alert">読み込めませんでした。<button className="ui-btn" onClick={() => setFailed(false)}>再試行</button></p> : /\.webm$/i.test(item.filename)
        ? <video key={item.full} src={item.full} controls onError={() => setFailed(true)} />
        : <img key={item.full} src={item.full} alt={`投稿 ${item.postNo}`} onError={() => setFailed(true)} />}
    </div>
    <div className="viewer-toolbar">
      <button className="ui-btn" disabled={index === 0} onClick={() => move(-1)}>前へ (←)</button>
      <a className="ui-btn" href={item.full} target="_blank" rel="noopener noreferrer">外部で開く</a>
      {onJump && <button className="ui-btn" onClick={() => onJump(item.postNo)}>元のレスへ</button>}
      <button className="ui-btn" disabled={index === items.length - 1} onClick={() => move(1)}>次へ (→)</button>
    </div>
  </dialog>;
}
