import { app, BrowserWindow, ipcMain, dialog, safeStorage } from "electron";
import path from "path";
import fs from "fs";
import { pathToFileURL } from "node:url";
import { downloadImage, isTrustedDocument, normalizeDownloadUrl, translateText } from "./services";
import { fiveRequest } from "./five";
import { normalizeFiveImage, imageFilename, readFiveImage, downloadFiveImage } from "./five-media";

import { confirmExternal } from "./external";
import { createV2exVault } from "./v2ex-credentials";
import { createV2exService } from "./v2ex";
import { createPttService } from "./ptt";

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
ipcMain.handle("five-image", async (event, url: unknown): Promise<RemoteImageResult> => {
  if (!trustedSender(event)) return { error: "Unauthorized request" };
  try { return await readFiveImage(url); }
  catch { return { error: "画像を取得できません。対応ホスト・形式・8MB以内の画像か確認してください。" }; }
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
  win.on("closed", () => trustedWindows.delete(contentsId));
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
ipcMain.handle("save-images", async (event, input: unknown): Promise<SaveResult> => {
  const failure = (error: string): SaveResult => ({ status: "error", total: 0, saved: 0, failedTargets: [], error });
  if (!trustedSender(event)) return failure("Unauthorized request");
  if (saving) return { status: "busy", total: 0, saved: 0, failedTargets: [] };
  if (!Array.isArray(input) || input.length === 0 || input.length > 2000 ||
      !input.every(item => item && (remoteImageSource(item.source)
        ? normalizeFiveImage(item.url) && (item.filename === undefined || item.filename === imageFilename(item.url))
        : (item.source === undefined || item.source === "4chan") && normalizeDownloadUrl(item.url) &&
          (item.filename === undefined || (typeof item.filename === "string" && /^\d+\.(jpg|jpeg|png|gif|webm)$/i.test(item.filename)))))) {
    return failure("保存対象が不正です（1〜2000件まで）。");
  }
  const list: ImageTarget[] = input.map(item => remoteImageSource(item.source)
    ? { source: item.source, url: normalizeFiveImage(item.url)!, filename: imageFilename(item.url) }
    : { url: item.url, ...(item.filename === undefined ? {} : { filename: item.filename }) });
  const failedTargets: ImageTarget[] = [];
  let saved = 0;
  let processed = 0;
  saving = true;
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({ title: "保存先フォルダを選択", properties: ["openDirectory"] });
    if (canceled || !filePaths.length) return { status: "cancelled", total: list.length, saved: 0, failedTargets: [] };
    for (let i = 0; i < list.length; i++) {
      if (event.sender.isDestroyed()) { failedTargets.push(...list.slice(i)); processed = list.length; break; }
      const item = list[i];
      const filename = safeFilenameFromTarget(item, i);
      let complete = false;
      try {
        const filePath = await resolveUniqueFilePath(path.join(filePaths[0], filename));
        for (let attempt = 1; attempt <= DOWNLOAD_RETRY_COUNT; attempt++) {
          try {
            if (remoteImageSource(item.source)) await downloadFiveImage(item.url, filePath);
            else await downloadImage(item.url, filePath);
            complete = true; break;
          }
          catch { if (attempt < DOWNLOAD_RETRY_COUNT) await sleep(1200 * attempt); }
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
