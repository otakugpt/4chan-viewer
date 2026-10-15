export {};
declare global {
  interface ImageTarget { url: string; filename?: string; source?: BoardSource }
  interface SaveProgressData { current: number; total: number; percent: number; filename: string }
  interface SaveResult {
    status: "complete" | "cancelled" | "error" | "busy";
    total: number; saved: number; failedTargets: ImageTarget[]; error?: string;
  }
  interface ElectronAPI {
    openExternal: (url: string) => Promise<{ opened: boolean; error?: string }>;
    fiveRequest: (request: FiveRequest) => Promise<FiveResult>;
    v2exRequest: (request: V2exRequest) => Promise<V2exResult>;
    v2exSettings: (request: V2exSettingsRequest) => Promise<V2exCredentialStatus>;
    pttRequest: (request: PttRequest) => Promise<PttResult>;
    pttConsent: (request: PttConsentRequest) => Promise<PttConsentStatus>;
    fiveImage: (url: string) => Promise<RemoteImageResult>;
    translate: (text: string) => Promise<{ translatedText: string } | { error: string }>;
    saveImages: (list: ImageTarget[]) => Promise<SaveResult>;
    onProgress: (listener: (data: SaveProgressData) => void) => () => void;
  }
  interface Window { electron: ElectronAPI }
}
