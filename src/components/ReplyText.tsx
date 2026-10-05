import React, { useState } from "react";
import { plainText } from "../lib/text";
export function ReplyText({ text, posts, onJump }: { text: string; posts: PostInfo[]; onJump: (no: number) => void }) {
  const [preview, setPreview] = useState<number | null>(null);
  const target = preview === null ? null : posts.find(p => p.no === preview);
  return <div className="reply-text">
    {text.split(/(>>\d{1,5}(?:-\d{1,5})?)/g).map((part, i) => /^>>\d/.test(part)
      ? <button key={i} className="reply-anchor" onMouseEnter={() => setPreview(Number(part.match(/\d+/)![0]))} onFocus={() => setPreview(Number(part.match(/\d+/)![0]))} onClick={() => setPreview(Number(part.match(/\d+/)![0]))}>{part}</button>
      : <React.Fragment key={i}>{part}</React.Fragment>)}
    {preview !== null && <aside className="reply-preview" aria-label="参照レス">
      <div className="flex gap-2"><strong>No.{preview}</strong><button className="ui-btn" onClick={() => setPreview(null)}>閉じる</button>{target && <button className="ui-btn" onClick={() => { onJump(preview); setPreview(null); }}>レスへ移動</button>}</div>
      <p>{target ? plainText(target.com ?? "") : "このレスはまだ取得されていません。"}</p>
    </aside>}
  </div>;
}
