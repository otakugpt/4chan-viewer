import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

// ==============================
// 型定義
// ==============================
interface ImageItem {
  url: string;
  filename?: string;
}

interface ProgressData {
  current: number;
  total: number;
  percent: number;
  filename: string;
}

type ProgressCallback = (event: IpcRendererEvent, data: ProgressData) => void;
type CompleteCallback = () => void;

// ==============================
// API 実装
// ==============================
const api = {
  /**
   * 画像を一括保存
   * @param list 保存対象の画像リスト
   */
  saveImages: (list: ImageItem[]): void => {
    if (!Array.isArray(list) || list.length === 0) {
      console.warn("[electron.saveImages] Invalid argument or empty list");
      return;
    }
    ipcRenderer.send("save-images", list);
  },

  /**
   * 進捗イベントを購読
   * @param callback 各ファイル保存時に呼ばれる
   * @returns remove 関数（アンマウント時に呼び出す）
   */
  onProgress: (callback: ProgressCallback): (() => void) => {
    const handler = (event: IpcRendererEvent, data: ProgressData) => {
      callback(event, data);
    };
    ipcRenderer.on("save-progress", handler);
    return () => {
      ipcRenderer.removeListener("save-progress", handler);
    };
  },

  /**
   * 保存完了イベントを購読
   * @param callback すべての保存完了後に呼ばれる
   * @returns remove 関数（アンマウント時に呼び出す）
   */
  onSaveComplete: (callback: CompleteCallback): (() => void) => {
    const handler = () => {
      callback();
      ipcRenderer.removeListener("save-complete", handler);
    };
    ipcRenderer.on("save-complete", handler);
    return () => {
      ipcRenderer.removeListener("save-complete", handler);
    };
  },
};

// ==============================
// window.electron に安全に注入
// ==============================
contextBridge.exposeInMainWorld("electron", api);

// ==============================
// 型拡張
// ==============================
declare global {
  interface Window {
    electron: typeof api;
  }
}
