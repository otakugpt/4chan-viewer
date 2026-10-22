import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { isImageboardSource } from "../lib/sources";
import { IMAGEBOARD_SAVE_LIMIT } from "../lib/imageboardMedia";
import { getImageboardAccess, useImageboardAccess } from "../lib/imageboardAccess";
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
  const access = useImageboardAccess();
  const savingLain = useRef(false);
  useEffect(() => {
    if (!access.accepted) {
      setFailed(items => items.filter(item => item.source !== "lainchan"));
      if (savingLain.current) { setStatus(""); setProgress(0); }
    }
  }, [access.accepted, access.revision]);
  useEffect(() => window.electron?.onProgress(data => {
    if (savingLain.current && !getImageboardAccess().accepted) return;
    setProgress(data.percent);
    setStatus(`保存中 ${data.current}/${data.total}: ${data.filename}`);
  }), []);
  const save = async (items: ImageTarget[]) => {
    if (lock.current || !items.length) return;
    if (items.some(item => isImageboardSource(item.source)) && items.length > IMAGEBOARD_SAVE_LIMIT) { setStatus("画像保存は1回100件までです。"); return; }
    if (items.some(item => item.source === "lainchan") && !getImageboardAccess().accepted) { setStatus("Lainchanの年齢・利用条件の確認が必要です。"); return; }
    if (!window.electron?.saveImages) { setStatus("画像保存は Electron アプリで利用できます。"); return; }
    lock.current = true;
    savingLain.current = items.some(item => item.source === "lainchan");
    const revision = getImageboardAccess().revision;
    setBusy(true); setProgress(0); setStatus("保存先フォルダを選択してください。");
    try {
      const result = await window.electron.saveImages(items);
      if (savingLain.current && revision !== getImageboardAccess().revision) return;
      if (result.status === "cancelled") setStatus("保存をキャンセルしました。");
      else if (result.status === "busy") setStatus("別の保存処理が進行中です。");
      else {
        setFailed(result.failedTargets);
        setProgress(result.status === "complete" ? 100 : 0);
        setStatus(result.error ?? `保存完了: ${result.saved}/${result.total} 件成功、${result.failedTargets.length} 件失敗`);
      }
    } catch { if (!savingLain.current || revision === getImageboardAccess().revision) { setFailed(items); setStatus("保存処理に失敗しました。アプリを再起動して再試行してください。"); } }
    finally { lock.current = false; setBusy(false); }
  };
  return <SaveContext.Provider value={{ busy, progress, status, failed, save }}>{children}</SaveContext.Provider>;
}
export function useSave() {
  const value = useContext(SaveContext);
  if (!value) throw new Error("SaveProvider is required");
  return value;
}
