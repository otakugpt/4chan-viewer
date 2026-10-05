import React, { useEffect, useMemo, useState } from "react";

import { useLibrary, toggleFavorite } from "../lib/library";

import { providers } from "../lib/providers";

interface BoardListProps {
  source: BoardSource;
  onSelect: (board: string) => void;
  selectedBoard: string | null;
}

export const BoardList: React.FC<BoardListProps> = ({
  source,
  onSelect,
  selectedBoard,
}) => {
  const library = useLibrary(source);
  const [boards, setBoards] = useState<BoardInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");

  const provider = providers[source];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    provider.boards(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data)) {
          throw new Error("Invalid response structure");
        }
        setBoards(data);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error("Failed to load boards:", err);
        setError(err.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [provider, reload]);

  const filteredBoards = useMemo(() => {
    const sorted = [...boards].sort((a, b) => Number(library.boards.includes(b.board)) - Number(library.boards.includes(a.board)));
    const keyword = query.trim().toLowerCase();
    if (!keyword) return sorted;

    return sorted.filter((b) => {
      const token = `${b.board} ${b.title}`.toLowerCase();
      return token.includes(keyword);
    });
  }, [boards, query, library.boards]);

  return (
    <div className="panel-surface pane-flex">
      <div className="panel-header">
        <div className="flex items-center justify-between">
          <h2 className="panel-title">Boards</h2>
          <span className="meta text-xs text-slate-400">{boards.length}</span>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter boards..."
          aria-label="板を検索"
          className="panel-search"
        />
      </div>

      <div className="list-scroll smooth-scroll">
        {loading && (
          <div className="load-state">
            <span className="loader-dot" />
            Loading boards...
          </div>
        )}

        {!loading && error && <div className="error-state" role="alert">{error}<button className="ui-btn" onClick={() => setReload(value => value + 1)}>再試行</button></div>}

        {!loading &&
          !error &&
          filteredBoards.map((b, index) => (
            <div key={b.board} className="board-row"><button
              type="button"
              onClick={() => onSelect(b.board)}
              className={`board-item animate-enter ${
                selectedBoard === b.board ? "board-item--active" : ""
              }`}
              style={{ animationDelay: `${Math.min(index, 16) * 18}ms` }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="meta board-item-code font-semibold">/{b.board}/</span>
                {selectedBoard === b.board && (
                  <span className="chip chip--small">active</span>
                )}
              </div>
              <p className="board-item-title mt-1 text-sm">{b.title}</p>
            </button><button className="ui-btn favorite-board" aria-label={"/" + b.board + "/ をお気に入りに"} aria-pressed={library.boards.includes(b.board)} onClick={() => toggleFavorite("boards", b.board, source)}>{library.boards.includes(b.board) ? "解除" : "登録"}</button></div>
          ))}

        {!loading && !error && filteredBoards.length === 0 && (
          <div className="empty-state">No matching boards.</div>
        )}
        {!loading && !error && boards.length === 0 && (
          <div className="empty-state">No boards available.</div>
        )}
      </div>
    </div>
  );
};
