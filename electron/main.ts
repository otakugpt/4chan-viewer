import { app, BrowserWindow, ipcMain, dialog, safeStorage } from "electron";
import path from "path";
import fs from "fs";
import { pathToFileURL } from "node:url";
import { downloadImage, isTrustedDocument, normalizeDownloadUrl, translateText } from "./services";
import { fiveRequest } from "./five";
import { normalizeFiveImage, imageFilename, readFiveImage, downloadFiveImage, ImagePolicyError, LargeImageInfo } from "./five-media";

import { confirmExternal } from "./external";
import { createV2exVault } from "./v2ex-credentials";
import { createV2exService } from "./v2ex";
import { createPttService } from "./ptt";
import { createImageboardService } from "./imageboards";
import { normalizeImageboardImage, sourceForImage } from "./imageboard-policy";
import { createImageboardMedia } from "./imageboard-media";

const DOWNLOAD_DELAY_MS = 500;
const DOWNLOAD_RETRY_COUNT = 3;
const trustedWindows = new Map<number, string>();
let translating = false;

function trustedSender(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  const expected = trustedWindows.get(event.sender.id);
  const frame = event.senderFrame;
  return Boolean(expected && frame && frame === event.sender.mainFrame &&
    isTrustedDocument(frame.url, expected));
}

ipcMain.handle("open-external", (event, url: unknown) => trustedSender(event) ? confirmExternal(url) : { opened: false, error: "Unauthorized request" });

ipcMain.handle("five-request", (event, request: unknown) => trustedSender(event)
  ? fiveRequest(request) : { error: "Unauthorized request" });
let v2ex: { vault: ReturnType<typeof createV2exVault>; request: ReturnType<typeof createV2exService> } | undefined;
const ptt = createPttService();
const imageboards = createImageboardService();
const imageboardMedia = createImageboardMedia(imageboards);
const imageboardReads = new Map<string, AbortController>();
const imageRequestKey = (sender: number, id: unknown) => typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id) ? `${sender}:${id}` : null;
ipcMain.handle("imageboard-image", async (event, input: unknown): Promise<RemoteImageResult> => {
  if (!trustedSender(event)) return { error: "Unauthorized request" };
  const r = input as { id?: unknown; url?: unknown } | null;
  const key = imageRequestKey(event.sender.id, r?.id);
  const url = normalizeImageboardImage(r?.url);
  if (!key || !url || imageboardReads.has(key) || imageboardReads.size >= 32) return { error: "画像の要求が不正、または混み合っています。" };
  const controller = new AbortController();
  imageboardReads.set(key, controller);
  try {
    return await imageboardMedia.read(url, info => controller.signal.aborted ? Promise.resolve(false) : confirmLargeImage(event, info), controller.signal);
  } catch (error) {
    return { error: controller.signal.aborted ? "画像の取得を中止しました。" : error instanceof ImagePolicyError ? error.message : "画像を取得できません。アクセス制限中は時間をおいて再試行してください。" };
  } finally { if (imageboardReads.get(key) === controller) imageboardReads.delete(key); }
});
ipcMain.handle("imageboard-image-cancel", (event, id: unknown) => {
  if (!trustedSender(event)) return;
  const key = imageRequestKey(event.sender.id, id);
  if (key) { imageboardReads.get(key)?.abort(); imageboardReads.delete(key); }
});
let confirmingImageboards = false;
ipcMain.handle("imageboard-request", (event, input: unknown) => trustedSender(event)
  ? imageboards.request(input) : { error: "Unauthorized request" });
ipcMain.handle("imageboard-consent", async (event, input: unknown): Promise<ImageboardConsentStatus> => {
  if (!trustedSender(event)) return { accepted: false, error: "Unauthorized request" };
  const action = input && typeof input === "object" ? (input as ImageboardConsentRequest).action : undefined;
  if (action === "status") return imageboards.status();
  if (action === "revoke") { imageboards.setConsent(false); imageboardMedia.clear(); return imageboards.status(); }
  if (action !== "accept" || confirmingImageboards) return { ...imageboards.status(), error: "確認操作を完了してから再試行してください。" };
  confirmingImageboards = true;
  const generation = imageboards.generation();
  try {
    const answer = await dialog.showMessageBox({ type: "warning", title: "Lainchanの閲覧確認", message: "Lainchanは18歳以上の方のみ閲覧できます",
      detail: "18歳以上で、利用ルールを確認した場合だけ続行してください。\nhttps://www.lainchan.org/rules.html\n\n公開APIの存在や低頻度アクセスは、運営の利用許諾や適法性を保証しません。robots.txtには自動巡回を拒否する設定があります。RIFTは手動閲覧のみとし、自動巡回・ログイン・制限回避は行いません。権利・利用条件に反する保存や再配布をしないでください。\n通信は画像も含め10秒以上の間隔を設け、制限を受けたら停止します。同意は今回の起動中だけ有効です。上部から解除できます。",
      buttons: ["キャンセル", "18歳以上で、注意事項を確認して閲覧する"], defaultId: 0, cancelId: 0, noLink: true });
    if (answer.response === 1 && !event.sender.isDestroyed() && trustedSender(event) && imageboards.generation() === generation) {
      imageboards.setConsent(true); imageboardMedia.clear();
    }
    return imageboards.status();
  } catch { return { ...imageboards.status(), error: "閲覧確認を開けませんでした。" }; }
  finally { confirmingImageboards = false; }
});
let confirmingPtt = false;
ipcMain.handle("ptt-request", (event, request: unknown) => trustedSender(event) ? ptt.request(request) : { error: "Unauthorized request" });
ipcMain.handle("ptt-consent", async (event, input: unknown): Promise<PttConsentStatus> => {
  if (!trustedSender(event)) return { accepted: false, error: "Unauthorized request" };
  const kind = input && typeof input === "object" ? (input as PttConsentRequest).kind : undefined;
  if (kind === "status") return ptt.status();
  if (kind === "revoke") { ptt.setConsent(false); return ptt.status(); }
  if (kind !== "confirm" || !ptt.needsConsent() || confirmingPtt) return { ...ptt.status(), error: "確認対象のPTTページを開いてから操作してください。" };
  confirmingPtt = true;
  const generation = ptt.generation();
  try {
    const answer = await dialog.showMessageBox({ type: "warning", title: "PTTの年齢確認", message: "18歳以上であることを確認してください", detail: "PTTはこのページの閲覧に18歳以上の確認を求めています。18歳未満、または同意しない場合はキャンセルしてください。同意は今回のアプリ起動中のPTT閲覧に適用され、PTTへ over18=1 Cookieを送信します。上部の「PTT年齢確認を解除」で取り消せます。", buttons: ["キャンセル", "18歳以上で、閲覧に同意する"], defaultId: 0, cancelId: 0, noLink: true });
    if (answer.response === 1 && trustedSender(event) && ptt.generation() === generation) ptt.setConsent(true);
    return ptt.status();
  } catch { return { ...ptt.status(), error: "年齢確認を開けませんでした。" }; }
  finally { confirmingPtt = false; }
});
function v2exClient() {
  if (!v2ex) {
    const vault = createV2exVault(path.join(app.getPath("userData"), "v2ex-token.bin"), safeStorage);
    v2ex = { vault, request: createV2exService(vault.snapshot) };
  }
  return v2ex;
}
ipcMain.handle("v2ex-request", async (event, request: unknown) => {
  if (!trustedSender(event)) return { error: "Unauthorized request" };
  try { return await v2exClient().request(request); }
  catch { return { error: "V2EXの接続を初期化できません。" }; }
});
ipcMain.handle("v2ex-settings", (event, request: unknown): V2exCredentialStatus => {
  const failure = (error: string): V2exCredentialStatus => ({ configured: false, persistent: false, canPersist: false, mode: "public", error });
  if (!trustedSender(event)) return failure("Unauthorized request");
  try { return v2exClient().vault.settings(request); }
  catch { return failure("接続設定を読み取れませんでした。"); }
});
async function confirmLargeImage(event: Electron.IpcMainInvokeEvent, info: LargeImageInfo): Promise<boolean> {
  if (event.sender.isDestroyed() || !trustedSender(event)) return false;
  const size = (info.size / 1024 / 1024).toFixed(2);
  try {
    const answer = await dialog.showMessageBox({ type: "warning", title: "大きい画像の取得確認", message: "20MBを超える画像です。取得しますか？",
      detail: `${info.exact ? "申告サイズ" : "受信サイズ（全体サイズは不明）"}: ${size} MiB${info.exact ? "" : "以上"}\n接続先: ${new URL(info.url).hostname}\n画像: ${new URL(info.url).pathname}\n通信量とメモリ使用量が増えます。この画像を最初から再取得します。今回の取得だけを許可し、保存・再表示時は改めて確認します。\n通常20MB、確認後も最大100MB（1MB = 1MiB）。画素数・形式・接続先の安全確認は解除しません。`,
      buttons: ["キャンセル", "この画像を取得"], defaultId: 0, cancelId: 0, noLink: true });
    return answer.response === 1 && !event.sender.isDestroyed() && trustedSender(event);
  } catch { return false; }
}
ipcMain.handle("five-image", async (event, url: unknown): Promise<RemoteImageResult> => {
  if (!trustedSender(event)) return { error: "Unauthorized request" };
  try { return normalizeImageboardImage(url)
    ? await imageboardMedia.read(url, info => confirmLargeImage(event, info))
    : await readFiveImage(url, info => confirmLargeImage(event, info)); }
  catch (error) { return { error: error instanceof ImagePolicyError ? error.message : "画像を取得できません。対応ホスト・形式・容量・画素数・通信状態を確認してください。" }; }
});



function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeFilenameFromTarget(target: ImageTarget, index: number): string {
  const explicit = target.filename?.trim();
  if (explicit) return path.basename(explicit);

  try {
    const parsed = new URL(target.url);
    const fromPath = path.basename(parsed.pathname);
    if (fromPath) return fromPath;
  } catch {
    // Ignore parse errors and fallback to deterministic name.
  }

  return `image-${index + 1}.dat`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveUniqueFilePath(filePath: string): Promise<string> {
  if (!(await fileExists(filePath))) return filePath;

  const parsed = path.parse(filePath);
  let suffix = 1;
  let candidate = filePath;

  while (await fileExists(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`);
    suffix += 1;
  }

  return candidate;
}

ipcMain.handle("translate-text", async (event, text: unknown) => {
  if (!trustedSender(event)) return { error: "Unauthorized request" };
  if (translating) return { error: "Another translation is in progress. Please retry." };
  translating = true;
  try { return await translateText(text, process.env.DEEPL_API_KEY); }
  finally { translating = false; }
});

function createWindow() {
  const isDev = !app.isPackaged && process.env.NODE_ENV === "development";
  const devServerUrl = isDev && process.env.VITE_DEV_SERVER_URL === "http://localhost:5173"
    ? "http://localhost:5173/" : undefined;

  const win = new BrowserWindow({
    title: "RIFT",
    icon: path.join(__dirname, "..", devServerUrl ? "public" : "dist", "icons", process.platform === "win32" ? "rift.ico" : "rift-256.png"),
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const trustedUrl = devServerUrl ?? pathToFileURL(path.resolve(__dirname, "../dist/index.html")).href;
  trustedWindows.set(win.webContents.id, trustedUrl);
  const contentsId = win.webContents.id;
  win.on("closed", () => {
    trustedWindows.delete(contentsId);
    for (const [key, controller] of imageboardReads) if (key.startsWith(contentsId + ":")) {
      controller.abort(); imageboardReads.delete(key);
    }
  });
  win.webContents.on("will-navigate", event => event.preventDefault());
  win.webContents.on("will-redirect", event => event.preventDefault());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedDocument(win.webContents.mainFrame.url, trustedUrl)) void confirmExternal(url);
    return { action: "deny" };
  });

  if (devServerUrl) {
    win.loadURL(devServerUrl).catch((error) => {
      console.error("[Electron] Failed to load dev server URL:", error);
    });
  } else {
    const indexPath = path.resolve(__dirname, "../dist/index.html");
    if (fs.existsSync(indexPath)) {
      win.loadFile(indexPath).catch((error) => {
        console.error("[Electron] Failed to load index.html:", error);
      });
    } else {
      console.error("[Electron] index.html not found at:", indexPath);
      win.loadURL("data:text/html,<h2 style='color:red;'>index.html not found</h2>");
    }
  }

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(() => {
  if (process.platform === "win32") app.setAppUserModelId("org.rift.viewer");
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let saving = false;
const remoteImageSource = (source: unknown) => source === "5ch" || source === "v2ex" || source === "ptt";
const imageboardSource = (source: unknown) => source === "2333chan" || source === "komica" || source === "lainchan";
ipcMain.handle("save-images", async (event, input: unknown): Promise<SaveResult> => {
  const failure = (error: string): SaveResult => ({ status: "error", total: 0, saved: 0, failedTargets: [], error });
  if (!trustedSender(event)) return failure("Unauthorized request");
  if (saving) return { status: "busy", total: 0, saved: 0, failedTargets: [] };
  if (Array.isArray(input) && input.some(item => imageboardSource(item?.source)) && input.length > 100)
    return failure("新規掲示板の画像は負荷軽減のため1回100件まで保存できます。画像を選択して保存してください。");
  if (!Array.isArray(input) || input.length === 0 || input.length > 2000 ||
      !input.every(item => item && (imageboardSource(item.source)
        ? normalizeImageboardImage(item.url) && sourceForImage(item.url) === item.source && (item.filename === undefined || item.filename === imageFilename(item.url))
        : remoteImageSource(item.source)
        ? normalizeFiveImage(item.url) && (item.filename === undefined || item.filename === imageFilename(item.url))
        : (item.source === undefined || item.source === "4chan") && normalizeDownloadUrl(item.url) &&
          (item.filename === undefined || (typeof item.filename === "string" && /^\d+\.(jpg|jpeg|png|gif|webm)$/i.test(item.filename)))))) {
    return failure("保存対象が不正です（1〜2000件まで）。");
  }
  const list: ImageTarget[] = input.map(item => remoteImageSource(item.source) || imageboardSource(item.source)
    ? { source: item.source, url: (imageboardSource(item.source) ? normalizeImageboardImage(item.url) : normalizeFiveImage(item.url))!, filename: imageFilename(item.url) }
    : { url: item.url, ...(item.filename === undefined ? {} : { filename: item.filename }) });
  const failedTargets: ImageTarget[] = [];
  const imageboardGeneration = imageboards.generation();
  let saved = 0;
  let processed = 0;
  saving = true;
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({ title: "保存先フォルダを選択", properties: ["openDirectory"] });
    if (canceled || !filePaths.length) return { status: "cancelled", total: list.length, saved: 0, failedTargets: [] };
    for (let i = 0; i < list.length; i++) {
      if (event.sender.isDestroyed() || !trustedSender(event) ||
          (list.some(item => item.source === "lainchan") && imageboards.generation() !== imageboardGeneration)) {
        failedTargets.push(...list.slice(i)); processed = list.length; break;
      }
      const item = list[i];
      const filename = safeFilenameFromTarget(item, i);
      let complete = false;
      try {
        const filePath = await resolveUniqueFilePath(path.join(filePaths[0], filename));
        for (let attempt = 1; attempt <= DOWNLOAD_RETRY_COUNT; attempt++) {
          try {
            if (imageboardSource(item.source)) await imageboardMedia.download(item.url, filePath, info => confirmLargeImage(event, info));
            else if (remoteImageSource(item.source)) await downloadFiveImage(item.url, filePath, info => confirmLargeImage(event, info));
            else await downloadImage(item.url, filePath);
            complete = true; break;
          }
          catch (error) {
            if (imageboardSource(item.source) || error instanceof ImagePolicyError) break;
            if (attempt < DOWNLOAD_RETRY_COUNT) await sleep(1200 * attempt);
          }
        }
      } catch { /* A single file failure must not discard the rest of the batch. */ }
      if (complete) saved++; else failedTargets.push(item);
      processed = i + 1;
      if (!event.sender.isDestroyed()) event.sender.send("save-progress", {
        current: i + 1, total: list.length, percent: Math.round((i + 1) / list.length * 100), filename,
      });
      if (i < list.length - 1) await sleep(DOWNLOAD_DELAY_MS);
    }
    return { status: "complete", total: list.length, saved, failedTargets };
  } catch {
    return { status: "error", total: list.length, saved, failedTargets: [...failedTargets, ...list.slice(processed)], error: "保存処理に失敗しました。保存先の権限やアプリの状態を確認してください。" };
  } finally { saving = false; }
});
