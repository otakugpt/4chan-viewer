import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
const api: ElectronAPI = {
  fiveRequest: request => ipcRenderer.invoke("five-request", request),
  fiveImage: url => ipcRenderer.invoke("five-image", url),
  translate: text => ipcRenderer.invoke("translate-text", text),
  saveImages: list => ipcRenderer.invoke("save-images", list),
  onProgress: callback => {
    const handler = (_event: IpcRendererEvent, data: SaveProgressData) => callback(data);
    ipcRenderer.on("save-progress", handler);
    return () => ipcRenderer.removeListener("save-progress", handler);
  },
};
contextBridge.exposeInMainWorld("electron", api);
