import React, { useEffect, useRef, useState } from "react";
import { validBoard } from "../lib/sources";

const checkLabels: Record<V2exCheckId, string> = { connection: "認証・ノード取得", topics: "記事一覧", topicPages: "一覧の2ページ目", posts: "本文と返信", replyPages: "返信の2ページ目" };

export function V2exSettings({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<V2exCredentialStatus | null>(null);
  const [token, setToken] = useState("");
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [board, setBoard] = useState("python");
  const [verification, setVerification] = useState<V2exVerification | null>(null);
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
    setBusy(true); setMessage(""); setToken(""); setVerification(null);
    try {
      const value = await window.electron.v2exSettings(request);
      setStatus(value);
      if (value.error) setMessage(value.error);
      else { setMessage(request.kind === "mode" ? "閲覧モードを保存しました。取得済みの画面を更新します。" : request.kind === "clear" ? "このPCのトークンを削除しました。公式サイトでの失効操作は別途必要です。" : "トークンを設定しました。認証モードを選ぶと「接続を確認」で認証を確認できます。"); onChanged(); }
    } catch { setMessage("設定を変更できませんでした。"); }
    finally { setBusy(false); }
  };
  const check = async () => {
    setBusy(true); setMessage(""); setVerification(null);
    try {
      const result = await window.electron.v2exRequest({ kind: "check" });
      setMessage("connected" in result ? "V2EXへの接続を確認しました。" : "error" in result ? result.error : "応答を確認できません。");
      if ("error" in result && result.accessDenied) { setVerification(null); onChanged(); }
    } catch { setMessage("接続を確認できませんでした。"); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    if (!validBoard("v2ex", board) || !window.confirm(`V2EXの /${board}/ で一覧2ページ、返信が最も多い記事1件と返信2ページを読み取って確認します（最大6要求、通常約40秒、通信状況により数分）。トークンをV2EXに送りますが、投稿・画像取得・DeepL送信・本文の保存は行いません。実行しますか？`)) return;
    setBusy(true); setMessage("一覧・本文・ページ送りを確認中です。終了までお待ちください。"); setVerification(null);
    try {
      const result = await window.electron.v2exRequest({ kind: "verify", board });
      if ("verification" in result) {
        setVerification(result.verification); setMessage("");
        if (result.verification.accessDenied) onChanged();
      } else { setMessage("error" in result ? result.error : "確認結果を読み取れません。"); if ("error" in result && result.accessDenied) onChanged(); }
    } catch { setMessage("動作確認を完了できませんでした。"); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="connection-dialog" aria-labelledby="v2ex-settings-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="flex items-center justify-between gap-3"><h2 id="v2ex-settings-title">V2EX接続設定</h2><button className="ui-btn" disabled={busy} onClick={onClose}>閉じる</button></div>
    <fieldset disabled={busy || !status} className="connection-verification">
      <legend>閲覧モード（このPCに保存）</legend>
      <label className="connection-remember"><input type="radio" name="v2ex-mode" checked={status?.mode === "public"} onChange={() => void update({ kind: "mode", mode: "public" })} /> 公開モード（トークン不要・標準）</label>
      <label className="connection-remember"><input type="radio" name="v2ex-mode" checked={status?.mode === "authenticated"} onChange={() => void update({ kind: "mode", mode: "authenticated" })} /> 認証モード（個人トークンを使用）</label>
    </fieldset>
    <p>公開モードは公式フィード内の最新記事だけを読みます。招待コード・アカウントの有効化は不要です。返信は手動の試験取得で、全件取得は保証しません。過去ページ・限定記事には対応しません。</p>
    <p>公開モードでは保存済みトークンも送信しません。認証失敗時にモードを自動変更せず、閲覧制限を回避しません。公開一覧・本文・返信は最大10分のキャッシュを使用します。</p>
    <h3>認証モード用の設定</h3>
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
      <div className="flex flex-wrap gap-2"><button className="ui-btn ui-btn--primary" disabled={busy || !token || !status}>設定する</button><button type="button" className="ui-btn" disabled={busy || !status?.configured || status.mode !== "authenticated"} onClick={check}>接続を確認</button><button type="button" className="ui-btn" disabled={busy || !status} onClick={() => { if (window.confirm("このPCのV2EXトークンを削除しますか？公式サイトでのトークン失効は別途必要です。")) void update({ kind: "clear" }); }}>トークンを削除</button></div>
    </form>
    <section className="connection-verification" aria-labelledby="v2ex-verification-title">
      <h3 id="v2ex-verification-title">認証モードの動作確認</h3>
      <p>「接続を確認」は認証のみです。下の確認では実際の記事取得とページ送りも試します。結果はこの画面だけに表示し、記事本文・トークン・履歴を記録しません。</p>
      <label htmlFor="v2ex-check-board">確認するノード名</label>
      <div className="flex flex-wrap gap-2"><input id="v2ex-check-board" value={board} onChange={e => { setBoard(e.target.value); setVerification(null); }} maxLength={64} disabled={busy} className="panel-search" autoComplete="off" spellCheck={false} /><button className="ui-btn" disabled={busy || !status?.configured || status.mode !== "authenticated" || !validBoard("v2ex", board)} onClick={verify}>読み取り動作を確認</button></div>
      {!status?.configured && <p className="library-hint">先に上の欄で個人トークンを設定してください。</p>}
      {verification && <div className="verification-report" role="status">
        <p>/{verification.board}/ · {new Date(verification.checkedAt).toLocaleString()}</p>
        <ul>{verification.checks.map(check => <li key={check.id} data-check={check.id}><strong>{checkLabels[check.id]}</strong>: {check.status === "passed" ? "確認済み" : check.status === "failed" ? "確認失敗" : "未確認"}{check.count === undefined ? "" : ` (${check.count}件)`}{check.detail && <p>{check.detail}</p>}</li>)}</ul>
        <p className="library-hint">このノード・時点の確認結果です。他の記事や画像・翻訳の動作、正式対応を保証するものではありません。未確認項目は成功として扱いません。</p>
      </div>}
    </section>
    {busy && <p role="status">処理中…</p>}
    {message && <p role="status" className="connection-message">{message}</p>}
    <p className="library-hint">閲覧履歴・保存本文は従来どおりPC内に保存されます（暗号化対象はトークンのみ）。同じOSアカウントで動く悪意あるソフトから完全に保護するものではありません。</p>
  </dialog>;
}
