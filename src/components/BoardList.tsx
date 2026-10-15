import React, { useEffect, useMemo, useState } from "react";

import { rememberBoards, useLibrary, toggleFavorite } from "../lib/library";

import { providers } from "../lib/providers";
import { requireReadyPage, PageAccessError } from "../lib/pages";
import { PttAgeNotice } from "./PttAccess";
import { validPttBoard } from "../../electron/ptt-url";

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
  const [ageRequired, setAgeRequired] = useState(false);

  const provider = providers[source];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setAgeRequired(false);
    setBoards([]);

    provider.boards(controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        const data = requireReadyPage(page).items;
        setBoards(data); rememberBoards(data, source);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error("Failed to load boards:", err);
        setError(err.message);
        setAgeRequired(err instanceof PageAccessError && err.status === "age-confirmation-required");
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
          <h2 className="panel-title">{source === "ptt" ? "人気の板" : "Boards"}</h2>
          <span className="meta text-xs text-slate-400">{boards.length}</span>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={source === "ptt" ? "人気板を絞り込み / 板名で開く" : "Filter boards..."}
          aria-label="板を検索"
          className="panel-search"
        />
        {source === "ptt" && <>
          {validPttBoard(query.trim()) && <button type="button" className="ui-btn ptt-direct-board" onClick={() => onSelect(query.trim())}>板名「{query.trim()}」を直接開く</button>}
          <details className="ptt-guide">
            <summary>PTTの読み方・板の探し方</summary>
            <p>一覧は人気板だけです。載っていない板も、正式な板名を上の欄に入力して開けます（大文字・小文字を区別）。上部の入力欄では記事URLも使えます。</p>
            <button type="button" className="ui-btn" onClick={() => onSelect("Soft_Job")}>Soft_Job を開く</button>
            <p>「推／噓／→」はコメントの反応種別です。記事一覧の「次のページを読み込む」で古い記事へ進めます。気に入った板は「登録」で保存できます。</p>
            <p>公開Web版のみを読みます。年齢確認が必要な板は同意するまで表示しません。画像取得・翻訳も確認後だけ実行します。</p>
          </details>
        </>}
      </div>

      <div className="list-scroll smooth-scroll">
        {loading && (
          <div className="load-state">
            <span className="loader-dot" />
            Loading boards...
          </div>
        )}

        {!loading && error && <div className="error-state" role="alert">{source === "ptt" && ageRequired ? <PttAgeNotice /> : <>{error}<button className="ui-btn" onClick={() => setReload(value => value + 1)}>再試行</button></>}</div>}

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
          <div className="empty-state">{source === "ptt" ? "人気一覧に一致する板はありません。正式な板名が分かれば直接開けます。" : "No matching boards."}</div>
        )}
        {!loading && !error && boards.length === 0 && (
          <div className="empty-state">No boards available.</div>
        )}
      </div>
    </div>
  );
};
