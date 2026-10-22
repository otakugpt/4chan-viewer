import React, { useContext, useState } from "react";
import { parseFiveUrl } from "../../electron/five-url";
import { parseV2exUrl } from "../../electron/v2ex-url";
import { parsePttUrl } from "../../electron/ptt-url";
import { ThreadNavigation } from "./ThreadNavigation";
import { imageboardUrlSource } from "../lib/imageboardUrls";
export function UrlText({ text, externalOnly = false }: { text: string; externalOnly?: boolean }) {
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const navigate = useContext(ThreadNavigation);
  const open = async (url: string) => {
    if (opening) return;
    setError('');
    setOpening(true);
    try {
      if (!externalOnly && (parseFiveUrl(url) || parseV2exUrl(url) || parsePttUrl(url) || imageboardUrlSource(url))) {
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
    let url = part.replace(/[.,、。！？）】」』]+$/u, '');
    // Markdown closing delimiters are not part of the target URL.
    while (url.endsWith(')') && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) url = url.slice(0, -1);
    try { const parsed = new URL(url); if (parsed.username || parsed.password) return <React.Fragment key={index}>{part}</React.Fragment>; }
    catch { return <React.Fragment key={index}>{part}</React.Fragment>; }
    const internal = !externalOnly && Boolean(parseFiveUrl(url) || parseV2exUrl(url) || parsePttUrl(url) || imageboardUrlSource(url));
    return <React.Fragment key={index}><a className={`external-link${internal ? ' internal-thread-link' : ''}`} href={url} aria-busy={opening} title={internal ? 'RIFT内で開く（5chは公式過去ログも確認）' : '外部サイト（開く前に確認）'} onClick={e => { e.preventDefault(); void open(url); }} onAuxClick={e => { e.preventDefault(); if (e.button === 1) void open(url); }}>{url}</a>{part.slice(url.length)}</React.Fragment>;
  })}{error && <span role="alert" className="translate-error">{error}</span>}</>;
}
