export {};

declare global {
  interface SaveProgressData {
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

  interface ElectronAPI {
    onProgress: (
      listener: (event: unknown, data: SaveProgressData) => void
    ) => () => void;

    onSaveComplete: (listener: (data: SaveCompleteData) => void) => () => void;

    saveImages: (list: { url: string; filename?: string }[]) => void;
  }

  interface Window {
    electron: ElectronAPI;
  }
}