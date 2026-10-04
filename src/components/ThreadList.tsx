import React, { useEffect, useMemo, useState } from "react";
import { plainText } from "../lib/text";
import { useLibrary, toggleFavorite } from "../lib/library";
import { TranslateButton } from "./TranslateButton";

interface Thread {
  no: number;
  com?: string;
  sub?: string;
  replies?: number;
  images?: number;
  tim?: number;
}

interface ThreadListProps {
  board: string;
  selectedThread: number | null;
  onSelect: (threadNo: number) => void;
}

const createPreview = (comment: string): string => {
  const normalized = comment.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 200
    ? `${normalized.slice(0, 200).trim()}...`
    : normalized;
};

export const ThreadList: React.FC<ThreadListProps> = ({
  board,
  selectedThread,
  onSelect,
}) => {
  const library = useLibrary();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const isElectron = window.location.protocol === "file:";
  const apiBase = isElectron ? "https://a.4cdn.org" : "/api";
  const imgBase = isElectron ? "https://i.4cdn.org" : "/img";

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setThreads([]);

    fetch(`${apiBase}/${board}/catalog.json`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((pages) => {
        if (controller.signal.aborted) return;
        const allThreads = pages.flatMap((page: any) => page.threads || []);
        setThreads(allThreads);
      })
      .catch((err: Error) => {
        if (controller.signal.aborted) return;
        console.error("Failed to load threads:", err);
        setError(err.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [apiBase, board]);

  const visibleThreads = useMemo(() => threads.slice(0, 50), [threads]);

  return (
    <div className="panel-surface pane-flex">
      <div className="panel-header">
        <div className="flex items-center justify-between">
          <h2 className="panel-title">Threads /{board}/</h2>
          <span className="meta text-xs text-slate-400">{visibleThreads.length}</span>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          catalog の先頭 50 件を表示しています。
        </p>
      </div>

      <div className="list-scroll smooth-scroll">
        {loading && (
          <div className="load-state">
            <span className="loader-dot" />
            Loading threads...
          </div>
        )}

        {!loading && error && <div className="error-state">Error: {error}</div>}

        {!loading &&
          !error &&
          visibleThreads.map((thread, index) => {
            const thumb = thread.tim ? `${imgBase}/${board}/${thread.tim}s.jpg` : null;
            const comment = plainText(thread.com || "");
            const summary = createPreview(comment);
            const active = selectedThread === thread.no;

            return (
              <article
                key={thread.no}
                onClick={() => onSelect(thread.no)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(thread.no);
                  }
                }}
                role="button"
                tabIndex={0}
                className={`thread-card animate-enter ${active ? "thread-card--active" : ""}`}
                style={{ animationDelay: `${Math.min(index, 20) * 16}ms` }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="meta text-xs">{library.reads[board + "/" + thread.no] ? "既読" : "未読"}</span>
                  <button className="ui-btn ui-btn--small" aria-pressed={library.threads.includes(board + "/" + thread.no)} onClick={e => { e.stopPropagation(); toggleFavorite("threads", board + "/" + thread.no); }}>{library.threads.includes(board + "/" + thread.no) ? "お気に入り解除" : "お気に入り"}</button>
                </div>
                <div className="flex gap-3">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={`thread-${thread.no}`}
                      className="thread-thumb"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="thread-thumb thread-thumb--empty">No image</div>
                  )}

                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate text-sm font-semibold text-slate-100">
                        {plainText(thread.sub || "(no subject)")}
                      </h3>
                      <span className="meta text-[11px] text-slate-400">No.{thread.no}</span>
                    </div>

                    <p className="thread-summary mt-2 text-xs leading-relaxed text-slate-300">
                      {summary || "(no comment)"}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <div className="meta text-[11px] text-slate-400">
                        Replies {thread.replies ?? 0} / Images {thread.images ?? 0}
                      </div>
                    </div>
                    <TranslateButton
                      text={comment}
                      stopPropagation
                      className="thread-list-translate mt-2"
                    />
                  </div>
                </div>
              </article>
            );
          })}

        {!loading && !error && visibleThreads.length === 0 && (
          <div className="empty-state">No threads found.</div>
        )}
      </div>
    </div>
  );
};
