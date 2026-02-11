"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// ==============================
// API 実装
// ==============================
const api = {
    /**
     * 画像を一括保存
     * @param list 保存対象の画像リスト
     */
    saveImages: (list) => {
        if (!Array.isArray(list) || list.length === 0) {
            console.warn("[electron.saveImages] Invalid argument or empty list");
            return;
        }
        electron_1.ipcRenderer.send("save-images", list);
    },
    /**
     * 進捗イベントを購読
     * @param callback 各ファイル保存時に呼ばれる
     * @returns remove 関数（アンマウント時に呼び出す）
     */
    onProgress: (callback) => {
        const handler = (event, data) => {
            callback(event, data);
        };
        electron_1.ipcRenderer.on("save-progress", handler);
        return () => {
            electron_1.ipcRenderer.removeListener("save-progress", handler);
        };
    },
    /**
     * 保存完了イベントを購読
     * @param callback すべての保存完了後に呼ばれる
     * @returns remove 関数（アンマウント時に呼び出す）
     */
    onSaveComplete: (callback) => {
        const handler = () => {
            callback();
        };
        electron_1.ipcRenderer.on("save-complete", handler);
        return () => {
            electron_1.ipcRenderer.removeListener("save-complete", handler);
        };
    },
};
// ==============================
// window.electron に安全に注入
// ==============================
electron_1.contextBridge.exposeInMainWorld("electron", api);
