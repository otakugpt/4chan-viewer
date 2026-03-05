"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    saveImages: (list) => {
        if (!Array.isArray(list) || list.length === 0) {
            console.warn("[electron.saveImages] Invalid argument or empty list");
            return;
        }
        electron_1.ipcRenderer.send("save-images", list);
    },
    onProgress: (callback) => {
        const handler = (event, data) => {
            callback(event, data);
        };
        electron_1.ipcRenderer.on("save-progress", handler);
        return () => {
            electron_1.ipcRenderer.removeListener("save-progress", handler);
        };
    },
    onSaveComplete: (callback) => {
        const handler = (_event, data) => {
            callback(data);
        };
        electron_1.ipcRenderer.on("save-complete", handler);
        return () => {
            electron_1.ipcRenderer.removeListener("save-complete", handler);
        };
    },
};
electron_1.contextBridge.exposeInMainWorld("electron", api);
