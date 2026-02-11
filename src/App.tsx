import React, { useState, useEffect } from "react";
import { BoardList } from "./components/BoardList";
import { ThreadList } from "./components/ThreadList";
import { ThreadView } from "./components/ThreadView";

interface SaveProgressData {
  current: number;
  total: number;
  percent: number;
  filename: string;
}

const EmptyPane: React.FC<{ title: string; description: string }> = ({
  title,
  description,
}) => (
  <div className="panel-surface pane-flex empty-pane">
    <p className="meta text-xs text-slate-400 uppercase tracking-[0.2em]">
      Waiting
    </p>
    <h2 className="mt-2 text-xl font-semibold text-slate-100">{title}</h2>
    <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
      {description}
    </p>
  </div>
);

export const App: React.FC = () => {
  const [board, setBoard] = useState<string | null>(null);
  const [thread, setThread] = useState<number | null>(null);

  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let removeProgress: (() => void) | undefined;
    let removeComplete: (() => void) | undefined;

    if (window.electron?.onProgress) {
      removeProgress = window.electron.onProgress(
        (_event: unknown, data: SaveProgressData) => {
          setProgress(data.percent || 0);
          setStatus(
            `Saving ${data.current}/${data.total}: ${data.filename || "file"}`
          );
        }
      );
    }

    if (window.electron?.onSaveComplete) {
      removeComplete = window.electron.onSaveComplete(() => {
        setProgress(100);
        setStatus("Completed: all selected files saved.");
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
    <div className="app-shell">
      <header className="topbar panel-surface">
        <div>
          <p className="meta text-[11px] tracking-[0.24em] text-slate-400">
            HIGH CONTRAST THREAD TERMINAL
          </p>
          <h1 className="topbar-title">4chan Viewer</h1>
        </div>
        <div className="topbar-meta">
          <span className="chip meta">{board ? `/${board}/` : "No board"}</span>
          <span className="chip meta">
            {thread ? `No.${thread}` : "No thread"}
          </span>
          <span className="chip meta">v1.0.0</span>
        </div>
      </header>

      <main className="workspace-grid">
        <section className="workspace-pane">
          <BoardList
            selectedBoard={board}
            onSelect={(b) => {
              setBoard(b);
              setThread(null);
            }}
          />
        </section>

        <section className="workspace-pane">
          {board ? (
            <ThreadList
              board={board}
              onSelect={setThread}
              selectedThread={thread}
            />
          ) : (
            <EmptyPane
              title="Select a Board"
              description="左カラムで board を選択すると、最新 catalog からスレッド一覧を表示します。"
            />
          )}
        </section>

        <section className="workspace-pane">
          {board && thread ? (
            <ThreadView board={board} threadId={thread} />
          ) : (
            <EmptyPane
              title="Select a Thread"
              description="中央カラムのスレッドを選ぶと、本文・ギャラリー・画像保存アクションを表示します。"
            />
          )}
        </section>
      </main>

      {status && (
        <footer className="status-bar panel-surface animate-enter">
          <div className="flex items-center justify-between gap-4">
            <div className="meta text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Save Status
            </div>
            <div className="meta text-xs text-slate-300">
              {Math.round(progress)}%
            </div>
          </div>
          <div className="mt-1 text-sm text-slate-200">{status}</div>
          <div className="progress-track mt-3">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        </footer>
      )}
    </div>
  );
};
