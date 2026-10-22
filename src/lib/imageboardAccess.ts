import { useSyncExternalStore } from "react";

let state = { accepted: false, revision: 0 };
let generation = 0;
const listeners = new Set<() => void>();
export const getImageboardAccess = () => state;
function publish(accepted: boolean) {
  state = { accepted, revision: state.revision + 1 };
  listeners.forEach(listener => listener());
}
export function lockImageboardAccess() {
  generation++;
  publish(false);
}
export const useImageboardAccess = () => useSyncExternalStore(listener => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}, getImageboardAccess);

export async function changeImageboardConsent(action: ImageboardConsentRequest["action"]) {
  const current = ++generation;
  // Hide mounted and saved content immediately, including when native revoke fails.
  if (action === "revoke") publish(false);
  if (!window.electron?.imageboardConsent) throw new Error("年齢確認はElectronアプリで利用できます。");
  let result: ImageboardConsentStatus;
  try { result = await window.electron.imageboardConsent({ action }); }
  catch (error) { if (current === generation) publish(false); throw error; }
  if (current !== generation) return false;
  if ("error" in result) { publish(false); throw new Error(result.error); }
  publish(result.accepted === true);
  return result.accepted === true;
}
