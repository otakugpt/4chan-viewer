const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
export function translateCached(text: string): Promise<string> {
  const key = text.trim();
  const cached = cache.get(key);
  if (cached !== undefined) { cache.delete(key); cache.set(key, cached); return Promise.resolve(cached); }
  const current = pending.get(key);
  if (current) return current;
  const request = (async () => {
    if (!window.electron?.translate) throw new Error("翻訳は Electron アプリで利用できます。");
    const data = await window.electron.translate(key);
    if ("error" in data) throw new Error(translationError(data.error));
    cache.set(key, data.translatedText);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return data.translatedText;
  })();
  pending.set(key, request);
  void request.finally(() => pending.delete(key)).catch(() => {});
  return request;
}
export function translationError(error: string): string {
  if (error.includes("not set")) return "APIキーが未設定です。環境変数 DEEPL_API_KEY を設定してアプリを再起動してください。";
  if (error.includes("403")) return "APIキーが無効か、API Free用ではありません。DeepLの設定を確認してください。";
  if (error.includes("456")) return "DeepLの翻訳利用上限に達しました。利用状況を確認してください。";
  if (error.includes("429")) return "翻訳の要求が多すぎます。少し待って再試行してください。";
  if (error.includes("in progress")) return "別の翻訳が進行中です。完了後に再試行してください。";
  if (error.includes("too long")) return "翻訳できるのは4000文字までです。";
  return "翻訳できませんでした。通信状態を確認して再試行してください。";
}
