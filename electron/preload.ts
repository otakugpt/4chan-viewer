import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

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

interface SaveCompleteData {
  total: number;
  saved: number;
  failed: number;
  failedFiles: string[];
}

type ProgressCallback = (event: IpcRendererEvent, data: ProgressData) => void;
type CompleteCallback = (data: SaveCompleteData) => void;

const api = {
  saveImages: (list: ImageItem[]): void => {
    if (!Array.isArray(list) || list.length === 0) {
      console.warn("[electron.saveImages] Invalid argument or empty list");
      return;
    }
    ipcRenderer.send("save-images", list);
  },

  onProgress: (callback: ProgressCallback): (() => void) => {
    const handler = (event: IpcRendererEvent, data: ProgressData) => {
      callback(event, data);
    };
    ipcRenderer.on("save-progress", handler);
    return () => {
      ipcRenderer.removeListener("save-progress", handler);
    };
  },

  onSaveComplete: (callback: CompleteCallback): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: SaveCompleteData) => {
      callback(data);
    };
    ipcRenderer.on("save-complete", handler);
    return () => {
      ipcRenderer.removeListener("save-complete", handler);
    };
  },
};

contextBridge.exposeInMainWorld("electron", api);

declare global {
  interface Window {
    electron: typeof api;
  }
}