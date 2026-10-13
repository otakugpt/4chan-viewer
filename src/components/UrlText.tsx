import React, { useState } from "react";
export function UrlText({ text }: { text: string }) {
  const [error, setError] = useState('');
  const open = async (url: string) => {
    setError('');
    try {
      if (!window.electron?.openExternal) throw new Error();
      const result = await window.electron.openExternal(url);
      if (result.error) setError(result.error);
    } catch { setError('外部リンクはElectronアプリで開いてください。'); }
  };
  return <>{text.split(/(https?:\/\/[^\s<>"'\u3000]+)/gi).map((part, index) => {
    if (!/^https?:\/\//i.test(part)) return <React.Fragment key={index}>{part}</React.Fragment>;
    const url = part.replace(/[.,、。！？）】」』]+$/u, '');
    try { const parsed = new URL(url); if (parsed.username || parsed.password) return <React.Fragment key={index}>{part}</React.Fragment>; }
    catch { return <React.Fragment key={index}>{part}</React.Fragment>; }
    return <React.Fragment key={index}><a className="external-link" href={url} title="外部サイト（開く前に確認）" onClick={e => { e.preventDefault(); void open(url); }} onAuxClick={e => { e.preventDefault(); if (e.button === 1) void open(url); }}>{url}</a>{part.slice(url.length)}</React.Fragment>;
  })}{error && <span role="alert" className="translate-error">{error}</span>}</>;
}
