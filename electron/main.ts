import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "path";
import fs from "fs";
import https from "https";
import http from "http";
import express from "express";
import fetch from "node-fetch";

const PROXY_PORT = 4040;
const FETCH_INTERVAL_MS = 1200;
const DOWNLOAD_DELAY_MS = 500;
const DOWNLOAD_RETRY_COUNT = 3;
const ALLOWED_PROXY_HOSTS = new Set(["i.4cdn.org"]);

const agent = new https.Agent({ keepAlive: true, maxSockets: 5 });

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

function normalizeDownloadUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return null;
    if (!ALLOWED_PROXY_HOSTS.has(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
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

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    const typed = error as NodeJS.ErrnoException;
    if (typed.code !== "ENOENT") {
      console.warn(`[Cleanup] Failed to delete partial file: ${filePath}`, typed);
    }
  }
}

async function downloadViaProxy(proxyUrl: string, filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    const req = http.get(proxyUrl, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        file.destroy();
        reject(new Error(`HTTP ${res.statusCode ?? "unknown"}`));
        return;
      }

      res.pipe(file);

      file.on("finish", () => {
        file.close(() => resolve());
      });
    });

    req.on("error", (error) => {
      file.destroy();
      reject(error);
    });

    file.on("error", (error) => {
      req.destroy();
      reject(error);
    });
  });
}

const proxyApp = express();
let lastFetch = 0;
let proxyServer: ReturnType<typeof proxyApp.listen> | null = null;

proxyApp.get("/proxy", async (req, res) => {
  const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
  const url = normalizeDownloadUrl(rawUrl);
  if (!url) {
    res.status(400).json({ error: "Invalid or unsupported url" });
    return;
  }

  const now = Date.now();
  const diff = now - lastFetch;
  if (diff < FETCH_INTERVAL_MS) await sleep(FETCH_INTERVAL_MS - diff);
  lastFetch = Date.now();

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://boards.4chan.org/",
      },
      agent,
    });

    if (!response.ok) {
      console.error(`[Proxy] ${url} -> HTTP ${response.status}`);
      res.status(response.status).send();
      return;
    }

    const contentType = response.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }

    if (!response.body) {
      console.error(`[Proxy] Empty body from ${url}`);
      res.status(502).json({ error: "Empty body from upstream" });
      return;
    }

    response.body.pipe(res);
  } catch (error) {
    console.error("[Proxy error]", error);
    if (!res.headersSent) {
      res.status(502).json({ error: "Proxy fetch failed" });
    }
  }
});

const DEEPL_API_KEY = process.env.DEEPL_API_KEY?.trim();

proxyApp.post("/translate", express.json({ limit: "32kb" }), async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "Missing text" });
    return;
  }
  if (text.length > 4000) {
    res.status(413).json({ error: "Text too long" });
    return;
  }
  if (!DEEPL_API_KEY) {
    res
      .status(503)
      .json({ error: "Translation unavailable: DEEPL_API_KEY is not set" });
    return;
  }

  try {
    const response = await fetch("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        text,
        target_lang: "JA",
      }),
    });

    const data = (await response.json()) as {
      translations?: Array<{ text?: string }>;
      message?: string;
    };

    if (!response.ok) {
      const message =
        typeof data.message === "string" ? data.message : "Translation failed";
      res.status(response.status).json({ error: message });
      return;
    }

    res.json({ translatedText: data.translations?.[0]?.text ?? "" });
  } catch (error) {
    console.error("[DeepL Error]", error);
    res.status(500).json({ error: "Translation failed" });
  }
});

function createWindow() {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const isDev = Boolean(devServerUrl) || !app.isPackaged;

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

function startProxyServer() {
  if (proxyServer) return;
  proxyServer = proxyApp.listen(PROXY_PORT, () => {
    console.log(`Local proxy running on port ${PROXY_PORT}`);
  });
}

function stopProxyServer() {
  if (!proxyServer) return;
  proxyServer.close();
  proxyServer = null;
}

app.whenReady().then(() => {
  startProxyServer();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopProxyServer();
});

ipcMain.on("save-images", async (event, list: ImageTarget[]) => {
  if (!Array.isArray(list) || list.length === 0) return;

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

    const proxyUrl = `http://localhost:${PROXY_PORT}/proxy?url=${encodeURIComponent(
      normalizedUrl
    )}`;
    const initialFilePath = path.join(saveDir, filename);
    const filePath = await resolveUniqueFilePath(initialFilePath);
    const savedFilename = path.basename(filePath);
    let completed = false;

    for (let attempt = 1; attempt <= DOWNLOAD_RETRY_COUNT; attempt += 1) {
      try {
        await downloadViaProxy(proxyUrl, filePath);
        completed = true;
        break;
      } catch (error) {
        await removeFileIfExists(filePath);
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