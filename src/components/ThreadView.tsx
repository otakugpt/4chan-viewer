import React, { useEffect, useMemo, useState } from "react";
import { TranslateButton } from "./TranslateButton";

interface Post {
  no: number;
  com?: string;
  name?: string;
  tim?: number;
  ext?: string;
}

interface MediaItem {
  postNo: number;
  full: string;
  thumb: string;
  filename: string;
}

interface SaveProgressData {
  current: number;
  total: number;
  percent: number;
  filename: string;
}

type ViewMode = "thread" | "gallery";

const stripHtml = (html: string): string =>
  html.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "");

const formatCommentHtml = (comment: string): string =>
  comment
    .replace(/<br\s*\/?>/g, "<br/>")
    .replace(
      /&gt;&gt;(\d+)/g,
      `<span class="text-sky-300 font-semibold hover:text-cyan-200 transition-colors">&gt;&gt;$1</span>`
    )
    .replace(
      /<a href="([^"]+)">/g,
      `<a href="$1" target="_blank" rel="noopener noreferrer" class="text-emerald-300 underline decoration-emerald-400/50 hover:text-cyan-200">`
    );

export const ThreadView: React.FC<{ board: string; threadId: number }> = ({
  board,
  threadId,
}) => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadedThreadIds, setLoadedThreadIds] = useState<number[]>([]);
  const [loadingOlder, setLoadingOlder] = useState<boolean>(false);
  const [noMoreOlder, setNoMoreOlder] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewMode>("thread");
  const [panelStatus, setPanelStatus] = useState("");
  const [panelProgress, setPanelProgress] = useState(0);

  const isElectron = window.location.protocol === "file:";
  const apiBase = isElectron ? "https://a.4cdn.org" : "/api";
  const imgBase = isElectron ? "https://i.4cdn.org" : "/img";

  useEffect(() => {
    setLoading(true);
    setError(null);
    setNoMoreOlder(false);
    setViewMode("thread");

    fetch(`${apiBase}/${board}/thread/${threadId}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!data.posts) throw new Error("Invalid thread data");
        setPosts(data.posts);
        setLoadedThreadIds([threadId]);
      })
      .catch((err: Error) => {
        console.error("Failed to load thread:", err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [apiBase, board, threadId]);

  useEffect(() => {
    if (!window.electron?.onProgress || !window.electron?.onSaveComplete) return;

    const removeProgress = window.electron.onProgress(
      (_event: unknown, data: SaveProgressData) => {
        setPanelProgress(data.percent ?? 0);
        setPanelStatus(
          `Saving ${data.current}/${data.total}: ${data.filename || "file"}`
        );
      }
    );
    const removeComplete = window.electron.onSaveComplete(() => {
      setPanelProgress(100);
      setPanelStatus("保存が完了しました。");
      setTimeout(() => {
        setPanelProgress(0);
        setPanelStatus("");
      }, 2400);
    });

    return () => {
      removeProgress?.();
      removeComplete?.();
    };
  }, []);

  const mediaList = useMemo<MediaItem[]>(
    () =>
      posts
        .filter((p) => p.tim && p.ext)
        .map((p) => {
          const filename = `${p.tim}${p.ext}`;
          return {
            postNo: p.no,
            filename,
            full: `${imgBase}/${board}/${filename}`,
            thumb: `${imgBase}/${board}/${p.tim}s.jpg`,
          };
        }),
    [posts, board, imgBase]
  );

  const saveMedia = (items: { url: string; filename?: string }[]) => {
    if (!items.length) return;
    if (!window.electron?.saveImages) {
      setPanelStatus("画像保存は Electron での実行時のみ利用できます。");
      setTimeout(() => setPanelStatus(""), 2200);
      return;
    }
    setPanelStatus("保存先フォルダを選択してください...");
    setPanelProgress(0);
    window.electron.saveImages(items);
  };

  const downloadAllMedia = () => {
    if (!mediaList.length) return;
    const list = mediaList.map((m) => ({
      url: `https://i.4cdn.org/${board}/${m.filename}`,
      filename: m.filename,
    }));
    saveMedia(list);
  };

  const downloadSingleMedia = (media: MediaItem) => {
    saveMedia([
      {
        url: `https://i.4cdn.org/${board}/${media.filename}`,
        filename: media.filename,
      },
    ]);
  };

  const loadOlderThread = async () => {
    try {
      setLoadingOlder(true);
      const archiveResponse = await fetch(`${apiBase}/${board}/archive.json`);
      if (!archiveResponse.ok) throw new Error(`HTTP ${archiveResponse.status}`);

      const archive: number[] = await archiveResponse.json();
      const lastLoadedId = loadedThreadIds[loadedThreadIds.length - 1];
      const idx = archive.indexOf(lastLoadedId);

      if (idx === -1 || idx === archive.length - 1) {
        setNoMoreOlder(true);
        return;
      }

      const nextOldId = archive[idx + 1];
      const olderResponse = await fetch(`${apiBase}/${board}/thread/${nextOldId}.json`);
      if (!olderResponse.ok) throw new Error(`HTTP ${olderResponse.status}`);

      const olderData = await olderResponse.json();
      const olderPosts: Post[] = olderData.posts || [];
      setPosts((prev) => [...prev, ...olderPosts]);
      setLoadedThreadIds((prev) => [...prev, nextOldId]);
    } catch (fetchError) {
      console.error("Failed to load older thread:", fetchError);
    } finally {
      setLoadingOlder(false);
    }
  };

  if (loading) {
    return (
      <div className="panel-surface pane-flex">
        <div className="load-state">
          <span className="loader-dot" />
          Loading thread...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-surface pane-flex">
        <div className="error-state">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="panel-surface pane-flex">
      <div className="panel-header">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="panel-title">
              /{board}/ No.{threadId}
            </h2>
            <p className="meta mt-1 text-[11px] text-slate-400">
              Posts {posts.length} / Images {mediaList.length}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode("thread")}
              className={`ui-btn ui-btn--ghost ${viewMode === "thread" ? "ui-btn--active" : ""}`}
            >
              Thread
            </button>
            <button
              type="button"
              onClick={() => setViewMode("gallery")}
              className={`ui-btn ui-btn--ghost ${viewMode === "gallery" ? "ui-btn--active" : ""}`}
            >
              Gallery
            </button>
            <button
              type="button"
              onClick={downloadAllMedia}
              disabled={!mediaList.length}
              className="ui-btn ui-btn--primary"
            >
              Save all
            </button>
          </div>
        </div>

        {panelStatus && (
          <div className="inline-progress animate-enter">
            <div className="meta flex items-center justify-between text-[11px] text-slate-400">
              <span>File save</span>
              <span>{Math.round(panelProgress)}%</span>
            </div>
            <div className="progress-track mt-2">
              <div className="progress-fill" style={{ width: `${panelProgress}%` }} />
            </div>
            <div className="mt-2 text-xs text-slate-200">{panelStatus}</div>
          </div>
        )}
      </div>

      <div className="list-scroll smooth-scroll">
        {viewMode === "thread" ? (
          posts.map((post, index) => {
            const hasImage = Boolean(post.tim && post.ext);
            const filename = hasImage ? `${post.tim}${post.ext}` : "";
            const imageUrl = hasImage ? `${imgBase}/${board}/${filename}` : null;
            const thumbUrl = hasImage ? `${imgBase}/${board}/${post.tim}s.jpg` : null;
            const plainText = stripHtml(post.com || "");

            return (
              <article
                key={post.no}
                className="post-card animate-enter"
                style={{ animationDelay: `${Math.min(index, 24) * 12}ms` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-100">
                    {post.name || "Anonymous"}
                  </span>
                  <span className="meta text-[11px] text-slate-400">No.{post.no}</span>
                </div>

                {imageUrl && (
                  <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                    <a
                      href={imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="post-image-link"
                    >
                      <img
                        src={thumbUrl ?? imageUrl}
                        alt={`post-${post.no}`}
                        className="post-thumb"
                      />
                    </a>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          downloadSingleMedia({
                            postNo: post.no,
                            full: imageUrl,
                            thumb: thumbUrl ?? imageUrl,
                            filename,
                          })
                        }
                        className="ui-btn ui-btn--primary ui-btn--small"
                      >
                        Save image
                      </button>
                      <a
                        href={imageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ui-btn ui-btn--ghost ui-btn--small"
                      >
                        Open full
                      </a>
                    </div>
                  </div>
                )}

                <div
                  className="post-body mt-3 text-sm leading-relaxed text-slate-200"
                  dangerouslySetInnerHTML={{
                    __html: formatCommentHtml(post.com || ""),
                  }}
                />

                {post.com && <TranslateButton text={plainText} className="mt-3" />}
              </article>
            );
          })
        ) : (
          <div className="gallery-grid">
            {mediaList.map((media, index) => (
              <div
                key={media.postNo}
                className="gallery-card animate-enter"
                style={{ animationDelay: `${Math.min(index, 24) * 14}ms` }}
              >
                <a
                  href={media.full}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gallery-link"
                >
                  <img
                    src={media.thumb}
                    alt={`gallery-${media.postNo}`}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = media.full;
                    }}
                    className="gallery-thumb"
                  />
                </a>
                <div className="gallery-meta">
                  <span className="meta text-[11px] text-slate-300">No.{media.postNo}</span>
                  <button
                    type="button"
                    onClick={() => downloadSingleMedia(media)}
                    className="ui-btn ui-btn--primary ui-btn--small"
                  >
                    Save
                  </button>
                </div>
              </div>
            ))}

            {!mediaList.length && (
              <div className="empty-state col-span-full">このスレには画像がありません。</div>
            )}
          </div>
        )}
      </div>

      {!noMoreOlder && (
        <div className="panel-footer">
          <button
            type="button"
            onClick={loadOlderThread}
            disabled={loadingOlder}
            className="ui-btn ui-btn--ghost w-full"
          >
            {loadingOlder ? "Loading older thread..." : "Load older thread"}
          </button>
        </div>
      )}
    </div>
  );
};
