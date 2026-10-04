import React, { createContext, useContext, useEffect, useRef, useState } from "react";
const SaveContext = createContext<{
  busy: boolean; progress: number; status: string; failed: ImageTarget[];
  save: (items: ImageTarget[]) => Promise<void>;
} | null>(null);
export function SaveProvider({ children }: { children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState<ImageTarget[]>([]);
  useEffect(() => window.electron?.onProgress(data => {
    setProgress(data.percent);
    setStatus(`保存中 ${data.current}/${data.total}: ${data.filename}`);
  }), []);
  const save = async (items: ImageTarget[]) => {
    if (lock.current || !items.length) return;
    if (!window.electron?.saveImages) { setStatus("画像保存は Electron アプリで利用できます。"); return; }
    lock.current = true;
    setBusy(true); setProgress(0); setStatus("保存先フォルダを選択してください。");
    try {
      const result = await window.electron.saveImages(items);
      if (result.status === "cancelled") setStatus("保存をキャンセルしました。");
      else if (result.status === "busy") setStatus("別の保存処理が進行中です。");
      else {
        setFailed(result.failedTargets);
        setProgress(result.status === "complete" ? 100 : 0);
        setStatus(result.error ?? `保存完了: ${result.saved}/${result.total} 件成功、${result.failedTargets.length} 件失敗`);
      }
    } catch { setFailed(items); setStatus("保存処理に失敗しました。アプリを再起動して再試行してください。"); }
    finally { lock.current = false; setBusy(false); }
  };
  return <SaveContext.Provider value={{ busy, progress, status, failed, save }}>{children}</SaveContext.Provider>;
}
export function useSave() {
  const value = useContext(SaveContext);
  if (!value) throw new Error("SaveProvider is required");
  return value;
}
