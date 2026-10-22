import React, { useState } from "react";
import { changeImageboardConsent, useImageboardAccess } from "../lib/imageboardAccess";
import { UrlText } from "./UrlText";

export function LainAgeNotice() {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  return <div className="ptt-age-notice"><p>Lainchanは18歳以上の方が対象です。年齢・利用条件に同意するまで、本文・一覧・保存済み本文やタイトルは表示しません。</p>
    <p><UrlText text="公式ルール: https://www.lainchan.org/rules.html" externalOnly /></p>
    <p><UrlText text="robots.txt: https://www.lainchan.org/robots.txt" externalOnly /></p>
    <button className="ui-btn" disabled={busy} onClick={async () => {
      setBusy(true); setMessage("");
      try { if (!await changeImageboardConsent("accept")) setMessage("同意していません。他のサイトは引き続き閲覧できます。"); }
      catch (error) { setMessage(error instanceof Error ? error.message : "年齢確認を利用できません。"); }
      finally { setBusy(false); }
    }}>18歳以上・利用条件の確認を開く</button>{message && <p role="status">{message}</p>}</div>;
}

export function ImageboardGate({ source, children }: { source: BoardSource; children: React.ReactNode }) {
  const { accepted } = useImageboardAccess();
  return source === "lainchan" && !accepted ? <div className="panel-surface pane-flex"><LainAgeNotice /></div> : <>{children}</>;
}
