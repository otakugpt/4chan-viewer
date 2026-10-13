import React, { useState } from "react";
import { BoardList } from "./BoardList";
import { boardName, favoriteBoards, moveBoard, toggleFavorite, useLibraries } from "../lib/library";
import { useSavedThreads } from "../lib/savedThreads";
export type LibraryMode = "favorites" | "history" | "board" | "saved";
export function LibrarySidebar({ source, selectedBoard, mode, onMode, onBoard }: {
  source: BoardSource; selectedBoard: string | null; mode: LibraryMode;
  onMode: (mode: LibraryMode) => void; onBoard: (source: BoardSource, board: string) => void;
}) {
  const data = useLibraries();
  const saved = useSavedThreads();
  const [expanded, setExpanded] = useState(true);
  const boards = favoriteBoards();
  const favoriteCount = data.sites['4chan'].threads.length + data.sites['5ch'].threads.length;
  const historyCount = Object.keys(data.sites['4chan'].history).length + Object.keys(data.sites['5ch'].history).length;
  return <aside className="panel-surface pane-flex library-sidebar">
    <div className="panel-header"><h2 className="panel-title">ライブラリ</h2></div>
    <nav className="library-nav" aria-label="ライブラリ">
      <button className={`library-nav-item ${mode === 'favorites' ? 'is-active' : ''}`} aria-pressed={mode === 'favorites'} onClick={() => onMode('favorites')}>お気に入りスレッド <span>{favoriteCount}</span></button>
      <button className={`library-nav-item ${mode === 'history' ? 'is-active' : ''}`} aria-pressed={mode === 'history'} onClick={() => onMode('history')}>閲覧履歴 <span>{historyCount}</span></button>
      <button className={`library-nav-item ${mode === "saved" ? "is-active" : ""}`} aria-pressed={mode === "saved"} onClick={() => onMode("saved")}>保存済みスレッド <span>{saved.items.length}</span></button>
    </nav>
    <div className="library-sidebar-scroll">
      <section className="library-boards" aria-label="お気に入り板">
        <h3>お気に入り板</h3>
        {!boards.length && <p className="library-hint">下の板一覧で「登録」すると、ここからすぐ開けます。</p>}
        {boards.map((id, index) => {
          const [site, board] = id.split('/') as [BoardSource, string];
          const name = boardName(site, board);
          return <div className="library-board-row" key={id}>
            <button title={name + " / " + site + " /" + board + "/"} className="library-board-link" aria-current={mode === 'board' && source === site && selectedBoard === board ? 'page' : undefined} onClick={() => onBoard(site, board)}><span>{name}</span><small>{site}</small></button>
            <div className="library-board-tools">
              <button className="ui-btn" disabled={index === 0} aria-label={name + ' を上へ'} onClick={() => moveBoard(id, -1)}>↑</button>
              <button className="ui-btn" disabled={index === boards.length - 1} aria-label={name + ' を下へ'} onClick={() => moveBoard(id, 1)}>↓</button>
              <button className="ui-btn" aria-label={name + ' のお気に入り解除'} onClick={() => toggleFavorite('boards', board, site)}>解除</button>
            </div>
          </div>;
        })}
      </section>
      <details className="all-boards" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
        <summary>すべての板 <span>{source}</span></summary>
        {expanded && <BoardList key={source} source={source} selectedBoard={selectedBoard} onSelect={board => onBoard(source, board)} />}
      </details>
    </div>
  </aside>;
}
