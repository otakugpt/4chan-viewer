// src/types/preload.d.ts
export {};

declare global {
  interface SaveProgressData {
    current: number;
    total: number;
    percent: number;
    filename: string;
  }

  /**
   * Electron 側で提供されるAPI群
   * preload.ts の contextBridge.exposeInMainWorld で公開される
   */
  interface ElectronAPI {
    /**
     * 保存進捗イベント購読
     * @param listener - イベントを受け取るコールバック
     * @returns 解除関数
     */
    onProgress: (
      listener: (event: unknown, data: SaveProgressData) => void
    ) => () => void;

    /**
     * 保存完了イベント購読
     * @param listener - 完了時に呼ばれるコールバック
     * @returns 解除関数
     */
    onSaveComplete: (listener: () => void) => () => void;

    /**
     * 画像一括保存（IPC経由）
     * @param list 保存対象の画像リスト
     */
    saveImages: (list: { url: string; filename?: string }[]) => void;
  }

  interface Window {
    /** preload.ts で exposeInMainWorld されたAPI */
    electron: ElectronAPI;
  }
}
