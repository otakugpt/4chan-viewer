import React, { useEffect, useMemo, useRef, useState } from "react";
import { plainText } from "../lib/text";
import { rememberTitles, useLibrary, toggleFavorite } from "../lib/library";
import { TranslateButton } from "./TranslateButton";

import { providers } from "../lib/providers";
import { requireReadyPage, mergePage, PageAccessError } from "../lib/pages";
import { PttAgeNotice } from "./PttAccess";

interface ThreadListProps {
  source: BoardSource;
  board: string;
  selectedThread: ThreadId | null;
  onSelect: (threadNo: ThreadId) => void;
}

const createPreview = (comment: string): string => {
  const normalized = comment.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 200
    ? `${normalized.slice(0, 200).trim()}...`
    : normalized;
};

export const ThreadList: React.FC<ThreadListProps> = ({
  source,
  board,
  selectedThread,
  onSelect,
}) => {
  const library = useLibrary(source);
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [ageRequired, setAgeRequired] = useState(false);
  const [publicOnly, setPublicOnly] = useState(false);

  const provider = providers[source];
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const visitedCursors = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setAgeRequired(false);
    if (cursor === undefined) { setThreads([]); visitedCursors.current.clear(); }
    setNextCursor(null);

    provider.threads(board, controller.signal, cursor)
      .then((pages) => {
        if (controller.signal.aborted) return;
        const page = requireReadyPage(pages);
        setPublicOnly(page.publicOnly === true);
        if (cursor !== undefined) visitedCursors.current.add(cursor);
        if (page.nextCursor && visitedCursors.current.has(page.nextCursor)) throw new Error("ページの循環を検出しました。更新して再試行してください。");
        setThreads(previous => cursor === undefined ? page.items : mergePage(previous, page.items, item => item.threadId));
        setNextCursor(provider.capabilities.threadPages ? page.nextCursor : null);
        rememberTitles(page.items.map(t => ({ ...t, sub: plainText(t.sub ?? "") })), board, source);
      })
      .catch((err: Error) => {
        if (controller.signal.aborted) return;
        console.error("Failed to load threads:", err);
        setError(err.message);
        setAgeRequired(err instanceof PageAccessError && err.status === "age-confirmation-required");
        if (err instanceof PageAccessError) setThreads([]);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [provider, board, refresh, cursor]);

  const visibleThreads = useMemo(() => threads.filter(t => plainText(t.sub ?? "").toLowerCase().includes(query.toLowerCase())).slice(0, source === "4chan" ? 50 : source === "5ch" ? 500 : undefined), [threads, query, source]);

  return (
    <div className="panel-surface pane-flex">
      <div className="panel-header">
        <div className="flex items-center justify-between">
          <h2 className="panel-title">Threads /{board}/</h2>
          <span className="meta text-xs text-slate-400">{visibleThreads.length}</span>
          {source === "ptt" && <button className="ui-btn ui-btn--small" aria-pressed={library.boards.includes(board)} onClick={() => toggleFavorite("boards", board, source)}>{library.boards.includes(board) ? "板の登録解除" : "板を登録"}</button>}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {publicOnly ? "公式の公開フィード内を検索します。過去ページなし・更新は最大10分キャッシュ。" : source === "4chan" ? "catalog の先頭 50 件を表示しています。" : source === "5ch" ? "検索結果の先頭500件を表示。更新間隔は最低30秒です。" : "取得済みのページ内を検索します。"}
        </p>
      </div>

      <div className="px-3 py-2 flex gap-2"><input className="panel-search" aria-label="スレッド検索" placeholder="スレッド検索" value={query} onChange={e => setQuery(e.target.value)} /><button className="ui-btn" disabled={loading} onClick={() => { setCursor(undefined); setRefresh(n => n + 1); }}>更新</button></div>
      <div className="list-scroll smooth-scroll">
        {loading && (
          <div className="load-state">
            <span className="loader-dot" />
            Loading threads...
          </div>
        )}

        {!loading && error && <div className="error-state" role="alert">{source === "ptt" && ageRequired ? <PttAgeNotice /> : <>Error: {error}</>}</div>}

        {!loading &&
          !error &&
          visibleThreads.map((thread, index) => {
            const thumb = provider.thumbnail(board, thread);
            const comment = plainText(thread.com || "");
            const summary = createPreview(comment);
            const active = selectedThread === thread.threadId;

            return (
              <article
                key={thread.threadId}
                onClick={() => onSelect(thread.threadId)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(thread.threadId);
                  }
                }}
                role="button"
                tabIndex={0}
                className={`thread-card animate-enter ${active ? "thread-card--active" : ""}`}
                style={{ animationDelay: `${Math.min(index, 20) * 16}ms` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="meta text-xs">{library.reads[board + "/" + thread.threadId] ? "既読" : "未読"}</span>
                  <button className="ui-btn ui-btn--small" aria-pressed={library.threads.includes(board + "/" + thread.threadId)} onClick={e => { e.stopPropagation(); toggleFavorite("threads", board + "/" + thread.threadId, source, plainText(thread.sub ?? "")); }}>{library.threads.includes(board + "/" + thread.threadId) ? "お気に入り解除" : "お気に入り"}</button>
                </div>
                <div className="flex gap-3">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={`thread-${thread.threadId}`}
                      className="thread-thumb"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : source === "v2ex" || source === "ptt" ? null : (
                    <div className="thread-thumb thread-thumb--empty">No image</div>
                  )}

                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-100">
                        {plainText(thread.sub || "(no subject)")}
                      </h3>
                      <span className="meta text-[11px] text-slate-400">No.{thread.threadId}</span>
                    </div>

                    <p className="thread-summary mt-2 text-xs leading-relaxed text-slate-300">
                      {summary || "(no comment)"}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <div className="meta text-[11px] text-slate-400">
                        {publicOnly ? "公開記事 / 返信数不明" : source === "ptt" ? "推・噓・→ は記事内に表示" : `レス ${thread.replies ?? 0}${source === "4chan" ? " / Images " + (thread.images ?? 0) : ""}`}
                      </div>
                    </div>
                    {provider.capabilities.translation && <TranslateButton confirmSend={source === "v2ex" || source === "ptt"}
                      text={source === "v2ex" || source === "ptt" ? plainText(thread.sub ?? "") : comment}
                      stopPropagation
                      className="thread-list-translate mt-2"
                    />}
                  </div>
                </div>
              </article>
            );
          })}

        {!loading && !error && visibleThreads.length === 0 && (
          <div className="empty-state">No threads found.</div>
        )}
      </div>
      {nextCursor && !error && <div className="panel-footer"><button className="ui-btn w-full" disabled={loading} onClick={() => setCursor(nextCursor)}>次のページを読み込む</button></div>}
    </div>
  );
};
