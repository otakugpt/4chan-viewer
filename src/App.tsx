import React, { useState, useEffect } from "react";
import { BoardList } from "./components/BoardList";
import { ThreadList } from "./components/ThreadList";
import { ThreadView } from "./components/ThreadView";

export const App: React.FC = () => {
  const [board, setBoard] = useState<string | null>(null);
  const [thread, setThread] = useState<number | null>(null);

  // === ダウンロード進捗 ===
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let removeProgress: (() => void) | undefined;
    let removeComplete: (() => void) | undefined;

    if (window.electron?.onProgress) {
      removeProgress = window.electron.onProgress(
        (_event: unknown, data: any) => {
          setProgress(data.percent || 0);
          setStatus(`⇣ downloading: ${data.filename}`);
        }
      );
    }

    if (window.electron?.onSaveComplete) {
      removeComplete = window.electron.onSaveComplete(() => {
        setProgress(100);
        setStatus("✅ completed: all files saved.");
        setTimeout(() => {
          setProgress(0);
          setStatus("");
        }, 3000);
      });
    }

    return () => {
      removeProgress?.();
      removeComplete?.();
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-noise text-gray-200 font-mono">
      {/* === ヘッダー: ターミナルバー風 === */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-[rgba(255,255,255,0.02)] backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="text-[10px] text-cyan-400">◎</span>
          <span className="tracking-tight text-gray-300">4chan-viewer</span>
          <span className="text-gray-600">/</span>
          <span className="text-gray-400">
            {board ? board : "select board"}
            {thread ? ` → ${thread}` : ""}
          </span>
        </div>
        <div className="text-[11px] text-gray-500 select-none">v1.0.0</div>
      </div>

      {/* === メインビュー === */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左カラム: BoardList */}
        <div className="w-1/5 border-r border-gray-800 bg-[rgba(255,255,255,0.01)]">
          <BoardList
            onSelect={(b) => {
              setBoard(b);
              setThread(null);
            }}
          />
        </div>

        {/* 中央カラム: ThreadList */}
        <div className="w-1/4 border-r border-gray-800 bg-[rgba(255,255,255,0.015)]">
          {board && <ThreadList board={board} onSelect={setThread} />}
        </div>

        {/* 右カラム: ThreadView */}
        <div className="flex-1 bg-[rgba(255,255,255,0.02)]">
          {board && thread && <ThreadView board={board} threadId={thread} />}
        </div>
      </div>

      {/* === 進捗バー: ミニマルなターミナル風 === */}
      {status && (
        <div className="relative w-full border-t border-gray-800 bg-[rgba(255,255,255,0.02)] backdrop-blur-sm">
          <div className="flex justify-between px-4 py-1 text-xs text-gray-400">
            <div>{status}</div>
            <div>{progress}%</div>
          </div>
          <div className="h-[3px] w-full bg-gray-800 overflow-hidden rounded-sm">
            <div
              className="h-full bg-cyan-500/70 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(0,255,255,0.4)]"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>
      )}
    </div>
  );
};
