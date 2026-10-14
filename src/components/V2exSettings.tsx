import React, { useEffect, useRef, useState } from "react";

export function V2exSettings({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<V2exCredentialStatus | null>(null);
  const [token, setToken] = useState("");
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const element = dialog.current!; element.showModal();
    let active = true;
    void window.electron?.v2exSettings({ kind: "status" }).then(value => {
      if (!active) return;
      setStatus(value); setPersist(value.canPersist); setMessage(value.error ?? "");
    }).catch(() => { if (active) setMessage("接続設定を取得できません。"); }).finally(() => { if (active) setBusy(false); });
    if (!window.electron?.v2exSettings) { setMessage("Electronアプリで設定してください。"); setBusy(false); }
    return () => { active = false; element.close(); };
  }, []);
  const update = async (request: V2exSettingsRequest) => {
    setBusy(true); setMessage(""); setToken("");
    try {
      const value = await window.electron.v2exSettings(request);
      setStatus(value);
      if (value.error) setMessage(value.error);
      else { setMessage(request.kind === "clear" ? "このPCのトークンを削除しました。公式サイトでの失効操作は別途必要です。" : "設定しました。「接続を確認」で認証を確認できます。"); onChanged(); }
    } catch { setMessage("設定を変更できませんでした。"); }
    finally { setBusy(false); }
  };
  const check = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await window.electron.v2exRequest({ kind: "check" });
      setMessage("connected" in result ? "V2EXへの接続を確認しました。" : "error" in result ? result.error : "応答を確認できません。");
    } catch { setMessage("接続を確認できませんでした。"); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="connection-dialog" aria-labelledby="v2ex-settings-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="flex items-center justify-between gap-3"><h2 id="v2ex-settings-title">V2EX接続設定</h2><button className="ui-btn" disabled={busy} onClick={onClose}>閉じる</button></div>
    <p>個人の Personal Access Token を設定します。RIFTは閲覧用の取得だけを行い、投稿・投票は行いません。</p>
    <p>トークンはチャットやGitへ貼らないでください。公式サイトで最小限の権限・有効期間を選び、不要になったら失効させてください。</p>
    <button className="ui-btn" onClick={async () => {
      try { const result = await window.electron.openExternal("https://www.v2ex.com/help/personal-access-token"); if (result.error) setMessage(result.error); }
      catch { setMessage("公式案内を開けませんでした。"); }
    }}>トークン作成の公式案内を開く</button>
    <p className="connection-state">{!status ? "設定を確認中…" : status.configured ? status.persistent ? "設定済み / OSによる暗号化保存" : "設定済み / この起動中のみ" : "未設定"}</p>
    <form onSubmit={e => { e.preventDefault(); if (!busy && token) void update({ kind: "set", token, persist }); }}>
      <label htmlFor="v2ex-token">新しいトークン</label>
      <input id="v2ex-token" type="password" autoComplete="off" spellCheck={false} maxLength={512} value={token} onChange={e => setToken(e.target.value)} disabled={busy} className="panel-search" />
      <label className="connection-remember"><input type="checkbox" checked={persist} disabled={busy || !status?.canPersist} onChange={e => setPersist(e.target.checked)} /> このPCに保存（OSの暗号化機能を使用）</label>
      {status && !status.canPersist && <p>この環境では安全な永続保存を利用できません。設定はアプリ終了時に消えます。</p>}
      <div className="flex flex-wrap gap-2"><button className="ui-btn ui-btn--primary" disabled={busy || !token || !status}>設定する</button><button type="button" className="ui-btn" disabled={busy || !status?.configured} onClick={check}>接続を確認</button><button type="button" className="ui-btn" disabled={busy || !status} onClick={() => { if (window.confirm("このPCのV2EXトークンを削除しますか？公式サイトでのトークン失効は別途必要です。")) void update({ kind: "clear" }); }}>トークンを削除</button></div>
    </form>
    {busy && <p role="status">処理中…</p>}
    {message && <p role="status" className="connection-message">{message}</p>}
    <p className="library-hint">閲覧履歴・保存本文は従来どおりPC内に保存されます（暗号化対象はトークンのみ）。同じOSアカウントで動く悪意あるソフトから完全に保護するものではありません。</p>
  </dialog>;
}
