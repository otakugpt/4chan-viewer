import React, { useState } from "react";
import { BoardList } from "./components/BoardList";
import { ThreadList } from "./components/ThreadList";
import { ThreadView } from "./components/ThreadView";

import { useSave } from "./components/SaveProvider";
import { getLibrary, useLibrary, rememberSelection, clearLibrary, toggleFavorite } from "./lib/library";

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
  const [board, setBoard] = useState<string | null>(() => getLibrary().last?.board ?? null);
  const [thread, setThread] = useState<number | null>(() => getLibrary().last?.thread ?? null);
  const library = useLibrary();
  const { progress, status, busy, failed, save } = useSave();
  const select = (b: string, t: number | null) => { setBoard(b); setThread(t); rememberSelection(b, t); };

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
          <button className="ui-btn" onClick={() => { if (window.confirm("お気に入りと閲覧履歴を削除しますか？")) { clearLibrary(); setBoard(null); setThread(null); } }}>閲覧データを消去</button>
        </div>
      </header>

      {library.threads.length > 0 && <nav className="favorite-strip" aria-label="お気に入りスレッド">{library.threads.map(id => <span key={id} className="flex gap-1"><button className="ui-btn" key={id} onClick={() => { const [b, t] = id.split("/"); select(b, Number(t)); }}>/{id}</button><button className="ui-btn" aria-label={id + " をお気に入りから削除"} onClick={() => toggleFavorite("threads", id)}>解除</button></span>)}</nav>}
      <main className="workspace-grid">
        <section className="workspace-pane">
          <BoardList
            selectedBoard={board}
            onSelect={(b) => select(b, null)}
          />
        </section>

        <section className="workspace-pane">
          {board ? (
            <ThreadList
              key={board}
              board={board}
              onSelect={(t) => select(board, t)}
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
            <ThreadView key={board + "/" + thread} board={board} threadId={thread} />
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
          <div className="mt-1 text-sm text-slate-200" role="status">{status}</div>
          {failed.length > 0 && <button className="ui-btn mt-2" disabled={busy} onClick={() => save(failed)}>失敗した {failed.length} 件だけ再試行</button>}
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
