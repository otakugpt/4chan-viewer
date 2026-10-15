import React, { createContext, useContext, useState } from "react";
export const PttAccess = createContext<() => void>(() => {});
export function PttAgeNotice() {
  const changed = useContext(PttAccess), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  return <div className="ptt-age-notice"><p>PTTの年齢確認が必要です。確認するまでは本文・記事一覧を取得結果として表示しません。</p>
    <button className="ui-btn" disabled={busy} onClick={async () => {
      setBusy(true); setMessage("");
      try {
        const result = await window.electron.pttConsent({ kind: "confirm" });
        if (result.error) setMessage(result.error);
        else if (result.accepted) changed();
        else setMessage("同意していません。別の板を選んで閲覧できます。");
      } catch { setMessage("年齢確認を利用できません。"); }
      finally { setBusy(false); }
    }}>年齢確認を開く</button>{message && <p role="status">{message}</p>}</div>;
}
