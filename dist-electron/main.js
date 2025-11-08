"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const node_fetch_1 = __importDefault(require("node-fetch"));
// =============================================
// 🌐 共通設定
// =============================================
const agent = new https_1.default.Agent({ keepAlive: true, maxSockets: 5 });
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// =============================================
// 🌀 Local Proxy Server（レートリミット回避）
// =============================================
const proxyApp = (0, express_1.default)();
let lastFetch = 0;
proxyApp.get("/proxy", async (req, res) => {
    const url = req.query.url;
    if (!url)
        return res.status(400).send("missing url");
    const now = Date.now();
    const diff = now - lastFetch;
    if (diff < 2000)
        await sleep(2000 - diff); // 2秒間隔
    lastFetch = Date.now();
    try {
        const response = await (0, node_fetch_1.default)(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
                Referer: "https://boards.4chan.org/",
            },
            agent,
        });
        if (!response.ok) {
            console.error(`[Proxy] ${url} → HTTP ${response.status}`);
            res.status(response.status).send();
            return;
        }
        if (!response.body) {
            console.error(`[Proxy] Empty body from ${url}`);
            res.status(500).send("Empty body from fetch");
            return;
        }
        response.body.pipe(res);
    }
    catch (e) {
        console.error("[Proxy error]", e);
        res.status(500).send();
    }
});
proxyApp.listen(4040, () => console.log("🌀 Local proxy running on port 4040"));
// =============================================
// 翻訳
// =============================================
const DEEPL_API_KEY = process.env.DEEPL_API_KEY || "e35be5a4-632a-4761-a6a1-8db3644667d3:fx";
proxyApp.post("/translate", express_1.default.json(), async (req, res) => {
    const { text } = req.body;
    if (!text)
        return res.status(400).json({ error: "Missing text" });
    try {
        const response = await (0, node_fetch_1.default)("https://api-free.deepl.com/v2/translate", {
            method: "POST",
            headers: {
                "Authorization": `DeepL-Auth-Key ${DEEPL_API_KEY}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                text,
                target_lang: "JA",
            }),
        });
        const data = await response.json();
        res.json({ translatedText: data.translations?.[0]?.text || "" });
    }
    catch (err) {
        console.error("[DeepL Error]", err);
        res.status(500).json({ error: "Translation failed" });
    }
});
// =============================================
// 🪟 Electron Main Window
// =============================================
function createWindow() {
    const win = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path_1.default.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    // 🚀 絶対パスで dist/index.html を正確に指定
    // __dirname は dist-electron/ を指すため ../dist に戻る
    const indexPath = path_1.default.resolve(__dirname, "../dist/index.html");
    console.log("[LOAD]", indexPath);
    // ファイルが存在するか確認してからロード
    if (fs_1.default.existsSync(indexPath)) {
        win.loadFile(indexPath).catch((err) => {
            console.error("[Electron] Failed to load index.html:", err);
        });
    }
    else {
        console.error("[Electron] index.html not found at:", indexPath);
        win.loadURL("data:text/html,<h2 style='color:red;'>❌ index.html not found</h2>");
    }
    // ✅ DevTools 自動表示（デバッグ用）
    win.webContents.openDevTools({ mode: "detach" });
}
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
// =============================================
// 📦 画像保存ロジック（Proxy経由, リトライ付き）
// =============================================
electron_1.ipcMain.on("save-images", async (event, list) => {
    if (!Array.isArray(list) || list.length === 0)
        return;
    const { canceled, filePaths } = await electron_1.dialog.showOpenDialog({
        title: "保存先フォルダを選択",
        properties: ["openDirectory"],
    });
    if (canceled || filePaths.length === 0)
        return;
    const saveDir = filePaths[0];
    console.log(`📁 保存先: ${saveDir}`);
    console.log(`📦 保存対象: ${list.length}件`);
    for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const filename = item.filename || path_1.default.basename(item.url);
        const filePath = path_1.default.join(saveDir, filename);
        const proxyUrl = `http://localhost:4040/proxy?url=${encodeURIComponent(item.url)}`;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`📡 [${i + 1}/${list.length}] DL開始: ${item.url}`);
                await new Promise((resolve, reject) => {
                    const file = fs_1.default.createWriteStream(filePath);
                    const req = http_1.default.get(proxyUrl, (res) => {
                        console.log(`📡 STATUS ${res.statusCode} (${item.url})`);
                        if (res.statusCode === 429) {
                            res.resume();
                            reject(new Error("429"));
                            return;
                        }
                        if (res.statusCode !== 200) {
                            res.resume();
                            reject(new Error(`HTTP ${res.statusCode}`));
                            return;
                        }
                        let downloadedBytes = 0;
                        res.on("data", (chunk) => (downloadedBytes += chunk.length));
                        res.pipe(file);
                        file.on("finish", () => {
                            file.close(() => {
                                console.log(`✅ 完了: ${filename} (${downloadedBytes} bytes)`);
                                // ✅ 進捗イベント送信
                                event.sender.send("save-progress", {
                                    current: i + 1,
                                    total: list.length,
                                    percent: Math.round(((i + 1) / list.length) * 100),
                                    filename,
                                });
                                resolve();
                            });
                        });
                        file.on("error", reject);
                    });
                    req.on("error", reject);
                    req.end();
                });
                await sleep(800); // 軽いdelay（サーバ負荷対策）
                break; // 成功したら次へ
            }
            catch (err) {
                console.error(`⚠️ [Retry ${attempt}] ${item.url}: ${err.message}`);
                if (attempt < 3)
                    await sleep(3000 * attempt);
                else
                    console.error(`❌ 永続失敗: ${item.url}`);
            }
        }
    }
    console.log("🎉 全ファイル保存完了");
    event.sender.send("save-complete");
});
