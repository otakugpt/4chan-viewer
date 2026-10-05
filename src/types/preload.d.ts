export {};
declare global {
  interface ImageTarget { url: string; filename?: string; source?: BoardSource }
  interface SaveProgressData { current: number; total: number; percent: number; filename: string }
  interface SaveResult {
    status: "complete" | "cancelled" | "error" | "busy";
    total: number; saved: number; failedTargets: ImageTarget[]; error?: string;
  }
  interface ElectronAPI {
    fiveRequest: (request: FiveRequest) => Promise<FiveResult>;
    fiveImage: (url: string) => Promise<RemoteImageResult>;
    translate: (text: string) => Promise<{ translatedText: string } | { error: string }>;
    saveImages: (list: ImageTarget[]) => Promise<SaveResult>;
    onProgress: (listener: (data: SaveProgressData) => void) => () => void;
  }
  interface Window { electron: ElectronAPI }
}
