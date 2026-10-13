import React, { useContext, useState } from "react";
import { parseFiveUrl } from "../../electron/five-url";
import { ThreadNavigation } from "./ThreadNavigation";
export function UrlText({ text }: { text: string }) {
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const navigate = useContext(ThreadNavigation);
  const open = async (url: string) => {
    if (opening) return;
    setError('');
    setOpening(true);
    try {
      if (parseFiveUrl(url)) {
        if (!navigate) throw new Error('RIFT内での移動を利用できません。');
        await navigate(url);
        return;
      }
      if (!window.electron?.openExternal) throw new Error();
      const result = await window.electron.openExternal(url);
      if (result.error) setError(result.error);
    } catch (e) { setError(e instanceof Error && e.message ? e.message : 'リンクはElectronアプリで開いてください。'); }
    finally { setOpening(false); }
  };
  return <>{text.split(/(https?:\/\/[^\s<>"'\u3000]+)/gi).map((part, index) => {
    if (!/^https?:\/\//i.test(part)) return <React.Fragment key={index}>{part}</React.Fragment>;
    const url = part.replace(/[.,、。！？）】」』]+$/u, '');
    try { const parsed = new URL(url); if (parsed.username || parsed.password) return <React.Fragment key={index}>{part}</React.Fragment>; }
    catch { return <React.Fragment key={index}>{part}</React.Fragment>; }
    const internal = Boolean(parseFiveUrl(url));
    return <React.Fragment key={index}><a className={`external-link${internal ? ' internal-thread-link' : ''}`} href={url} aria-busy={opening} title={internal ? 'RIFT内で開く（取得できない場合は公式過去ログを確認）' : '外部サイト（開く前に確認）'} onClick={e => { e.preventDefault(); void open(url); }} onAuxClick={e => { e.preventDefault(); if (e.button === 1) void open(url); }}>{url}</a>{part.slice(url.length)}</React.Fragment>;
  })}{error && <span role="alert" className="translate-error">{error}</span>}</>;
}
