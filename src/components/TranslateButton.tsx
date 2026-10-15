import React, { useEffect, useRef, useState } from "react";
import { translateCached } from "../lib/translation";
export const TranslateButton: React.FC<{ text: string; confirmSend?: boolean; stopPropagation?: boolean; className?: string }> = ({ text, confirmSend = false, stopPropagation = false, className = "" }) => {
  const [translated, setTranslated] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++; setTranslated(null); setError(null); setLoading(false); setVisible(true);
    return () => { generation.current++; };
  }, [text]);
  const translate = async () => {
    if (translated !== null) { setVisible(v => !v); return; }
    if (loading || text.trim().length > 4000) return;
    if (confirmSend && !window.confirm("このボタンの対象テキストをDeepLへ送信して日本語に翻訳します。個人情報や第三者の文章を送信してよいか確認してください。API利用枠を消費する場合があります。原文は残し、訳文はPCへ自動保存しません。送信しますか？")) return;
    const id = generation.current;
    setLoading(true); setError(null);
    try { const result = await translateCached(text); if (id === generation.current) setTranslated(result); }
    catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : "翻訳に失敗しました。"); }
    finally { if (id === generation.current) setLoading(false); }
  };
  return <div className={`translate-block ${className}`} onClick={e => { if (stopPropagation) e.stopPropagation(); }} onKeyDown={e => { if (stopPropagation) e.stopPropagation(); }}>
    <button type="button" onClick={translate} disabled={loading || !text.trim() || text.trim().length > 4000} className="ui-btn ui-btn--ghost" aria-expanded={translated !== null && visible}>
      {loading ? "翻訳中…" : translated !== null ? visible ? "原文のみ表示" : "訳文を表示" : "日本語に翻訳"}
    </button>
    {text.trim().length > 4000 && <p className="reader-notice">翻訳は1件4,000文字までです。この長文は送信しません。</p>}
    {error && <div className="translate-error" role="alert">{error}</div>}
    {translated !== null && visible && <div className="translate-result animate-enter"><span className="meta">日本語訳（DeepL・機械翻訳）</span><div>{translated}</div></div>}
  </div>;
};
