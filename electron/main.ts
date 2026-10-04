import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "path";
import fs from "fs";
import { pathToFileURL } from "node:url";
import { downloadImage, isTrustedDocument, normalizeDownloadUrl, translateText } from "./services";

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

type ImageTarget = { url: string; filename?: string };

interface SaveCompletePayload {
  total: number;
  saved: number;
  failed: number;
  failedFiles: string[];
}

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
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
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
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.on("save-images", async (event, list: ImageTarget[]) => {
  if (!trustedSender(event) || !Array.isArray(list) || list.length === 0 || list.length > 2000) return;
  if (!list.every(item => item && normalizeDownloadUrl(item.url) &&
      (item.filename === undefined || (typeof item.filename === "string" &&
       /^\d+\.(jpg|jpeg|png|gif|webm)$/i.test(item.filename))))) return;

  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "保存先フォルダを選択",
    properties: ["openDirectory"],
  });
  if (canceled || filePaths.length === 0) return;

  const saveDir = filePaths[0];
  let savedCount = 0;
  const failedFiles: string[] = [];

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    const filename = safeFilenameFromTarget(item, i);
    const normalizedUrl = normalizeDownloadUrl(item.url);
    const progressBase = {
      current: i + 1,
      total: list.length,
      percent: Math.round(((i + 1) / list.length) * 100),
      filename,
    };

    if (!normalizedUrl) {
      failedFiles.push(filename);
      event.sender.send("save-progress", progressBase);
      continue;
    }

    const initialFilePath = path.join(saveDir, filename);
    const filePath = await resolveUniqueFilePath(initialFilePath);
    const savedFilename = path.basename(filePath);
    let completed = false;

    for (let attempt = 1; attempt <= DOWNLOAD_RETRY_COUNT; attempt += 1) {
      try {
        await downloadImage(normalizedUrl, filePath);
        completed = true;
        break;
      } catch (error) {
        const typed = error as Error;
        console.error(
          `[Retry ${attempt}] ${normalizedUrl}: ${typed.message || error}`
        );
        if (attempt < DOWNLOAD_RETRY_COUNT) {
          await sleep(1200 * attempt);
        }
      }
    }

    if (completed) {
      savedCount += 1;
    } else {
      failedFiles.push(savedFilename);
    }

    event.sender.send("save-progress", {
      ...progressBase,
      filename: savedFilename,
    });

    if (i < list.length - 1) {
      await sleep(DOWNLOAD_DELAY_MS);
    }
  }

  const payload: SaveCompletePayload = {
    total: list.length,
    saved: savedCount,
    failed: list.length - savedCount,
    failedFiles,
  };

  event.sender.send("save-complete", payload);
});
