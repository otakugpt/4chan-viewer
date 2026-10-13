import { dialog, shell } from "electron";
export function externalUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 4096 || /[\s\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !!url.hostname ? url.href : null;
  } catch { return null; }
}
let opening = false;
export async function confirmExternal(raw: unknown): Promise<{ opened: boolean; error?: string }> {
  const url = externalUrl(raw);
  if (!url) return { opened: false, error: "HTTP/HTTPSのURLのみ開けます。" };
  if (opening) return { opened: false };
  opening = true;
  try {
    const result = await dialog.showMessageBox({ type: "warning", title: "外部リンク", message: "外部サイトへ遷移します", detail: `接続先: ${new URL(url).hostname}\n${url}\n\n既定のブラウザで開きます。`, buttons: ["キャンセル", "ブラウザで開く"], defaultId: 0, cancelId: 0, noLink: true });
    if (result.response !== 1) return { opened: false };
    await shell.openExternal(url);
    return { opened: true };
  } catch { return { opened: false, error: "ブラウザを開けませんでした。" }; }
  finally { opening = false; }
}
