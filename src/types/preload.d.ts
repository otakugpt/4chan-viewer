export {};
declare global {
  interface ImageTarget { url: string; filename?: string }
  interface SaveProgressData { current: number; total: number; percent: number; filename: string }
  interface SaveResult {
    status: "complete" | "cancelled" | "error" | "busy";
    total: number; saved: number; failedTargets: ImageTarget[]; error?: string;
  }
  interface ElectronAPI {
    translate: (text: string) => Promise<{ translatedText: string } | { error: string }>;
    saveImages: (list: ImageTarget[]) => Promise<SaveResult>;
    onProgress: (listener: (data: SaveProgressData) => void) => () => void;
  }
  interface Window { electron: ElectronAPI }
}
