import React, { useEffect, useMemo, useState } from "react";

interface Board {
  board: string;
  title: string;
}

interface BoardListProps {
  onSelect: (board: string) => void;
  selectedBoard: string | null;
}

export const BoardList: React.FC<BoardListProps> = ({
  onSelect,
  selectedBoard,
}) => {
  const [boards, setBoards] = useState<Board[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [query, setQuery] = useState("");

  const isElectron = window.location.protocol === "file:";
  const apiBase = isElectron ? "https://a.4cdn.org" : "/api";

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetch(`${apiBase}/boards.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!data.boards || !Array.isArray(data.boards)) {
          throw new Error("Invalid response structure");
        }
        setBoards(data.boards);
      })
      .catch((err) => {
        console.error("Failed to load boards:", err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredBoards = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return boards;

    return boards.filter((b) => {
      const token = `${b.board} ${b.title}`.toLowerCase();
      return token.includes(keyword);
    });
  }, [boards, query]);

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

        {!loading && error && <div className="error-state">Error: {error}</div>}

        {!loading &&
          !error &&
          filteredBoards.map((b, index) => (
            <button
              type="button"
              key={b.board}
              onClick={() => onSelect(b.board)}
              className={`board-item animate-enter ${
                selectedBoard === b.board ? "board-item--active" : ""
              }`}
              style={{ animationDelay: `${Math.min(index, 16) * 18}ms` }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="meta font-semibold text-slate-100">/{b.board}/</span>
                {selectedBoard === b.board && (
                  <span className="chip chip--small">active</span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-100">{b.title}</p>
            </button>
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
