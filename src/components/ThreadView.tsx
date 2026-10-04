import React, { useEffect, useMemo, useState, useRef } from "react";
import { useSave } from "./SaveProvider";
import { MediaViewer, MediaItem } from "./MediaViewer";
import { plainText as stripHtml } from "../lib/text";
import { getLibrary, getClearEpoch, rememberReading, toggleFavorite, useLibrary } from "../lib/library";
import { TranslateButton } from "./TranslateButton";

interface Post {
  no: number;
  com?: string;
  name?: string;
  tim?: number;
  ext?: string;
}

type ViewMode = "thread" | "gallery";

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
  const [localStatus, setPanelStatus] = useState("");
  const { busy, progress: panelProgress, status: saveStatus, save: saveMedia } = useSave();
  const panelStatus = localStatus || saveStatus;
  const [viewer, setViewer] = useState<number | null>(null);
  const requests = useRef<AbortController | null>(null);
  const olderBusy = useRef(false);
  const scrollPane = useRef<HTMLDivElement>(null);
  const library = useLibrary();
  const readingKey = board + "/" + threadId;
  const initialReading = useRef(getLibrary().reads[readingKey]);
  const lastScroll = useRef(initialReading.current?.scroll ?? 0);


  const isElectron = window.location.protocol === "file:";
  const apiBase = isElectron ? "https://a.4cdn.org" : "/api";
  const imgBase = isElectron ? "https://i.4cdn.org" : "/img";

  useEffect(() => {
    const controller = new AbortController();
    requests.current = controller;
    setPosts([]);
    setLoadedThreadIds([]);
    setLoadingOlder(false);
    olderBusy.current = false;
    setLoading(true);
    setError(null);
    setNoMoreOlder(false);
    setViewMode("thread");

    fetch(`${apiBase}/${board}/thread/${threadId}.json`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.posts)) throw new Error("Invalid thread data");
        setPosts(data.posts);
        setLoadedThreadIds([threadId]);
      })
      .catch((err: Error) => {
        if (controller.signal.aborted) return;
        console.error("Failed to load thread:", err);
        setError(err.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [apiBase, board, threadId]);

  useEffect(() => {
    const pane = scrollPane.current;
    if (!pane || loading || error || viewMode !== "thread") return;
    pane.scrollTop = lastScroll.current;
    const epoch = getClearEpoch();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPost = initialReading.current?.post ?? 0;
    const sample = () => {
      const bottom = pane.getBoundingClientRect().bottom;
      const visible = [...pane.querySelectorAll<HTMLElement>("[data-post]")].filter(el => el.getBoundingClientRect().top < bottom);
      lastPost = Number(visible[visible.length - 1]?.dataset.post ?? 0);
      lastScroll.current = pane.scrollTop;
    };
    const record = () => {
      if (epoch === getClearEpoch()) rememberReading(readingKey, lastPost, lastScroll.current);
    };
    const scroll = () => { sample(); clearTimeout(timer); timer = setTimeout(record, 250); };
    const unload = () => record();
    sample(); record();
    pane.addEventListener("scroll", scroll);
    window.addEventListener("beforeunload", unload);
    return () => { clearTimeout(timer); record(); pane.removeEventListener("scroll", scroll); window.removeEventListener("beforeunload", unload); };
  }, [loading, error, readingKey, viewMode]);

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
    if (olderBusy.current || noMoreOlder) return;
    const signal = requests.current?.signal;
    if (!signal || signal.aborted) return;
    olderBusy.current = true;

    try {
      setLoadingOlder(true);

      const archiveResponse = await fetch(`${apiBase}/${board}/archive.json`, { signal });
      if (!archiveResponse.ok) throw new Error(`HTTP ${archiveResponse.status}`);

      const archiveRaw: unknown = await archiveResponse.json();
      if (signal.aborted) return;
      if (!Array.isArray(archiveRaw)) {
        throw new Error("Invalid archive data");
      }

      const archive = archiveRaw
        .filter((id): id is number => typeof id === "number")
        .sort((a, b) => b - a);
      const loadedSet = new Set(loadedThreadIds);
      const referenceId = loadedThreadIds[loadedThreadIds.length - 1] ?? threadId;
      const nextOldId = archive.find(
        (id) => id < referenceId && !loadedSet.has(id)
      );

      if (!nextOldId) {
        setNoMoreOlder(true);
        return;
      }

      const olderResponse = await fetch(`${apiBase}/${board}/thread/${nextOldId}.json`, { signal });
      if (!olderResponse.ok) throw new Error(`HTTP ${olderResponse.status}`);

      const olderData = (await olderResponse.json()) as { posts?: Post[] };
      if (signal.aborted) return;
      const olderPosts = Array.isArray(olderData.posts) ? olderData.posts : [];

      if (!olderPosts.length) {
        setNoMoreOlder(true);
        return;
      }

      setPosts((prev) => [...prev, ...olderPosts]);
      setLoadedThreadIds((prev) => [...prev, nextOldId]);
    } catch (fetchError) {
      if (signal.aborted) return;
      console.error("Failed to load older thread:", fetchError);
      setPanelStatus("過去スレの読み込みに失敗しました。");

    } finally {
      if (!signal.aborted) { olderBusy.current = false; setLoadingOlder(false); }
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
            <button className="ui-btn" aria-pressed={library.threads.includes(readingKey)} onClick={() => toggleFavorite("threads", readingKey)}>{library.threads.includes(readingKey) ? "お気に入り解除" : "お気に入り"}</button>
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
              disabled={busy || !mediaList.length}
              className="ui-btn ui-btn--primary"
            >
              {busy ? "保存中…" : "Save all"}
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

      <div ref={scrollPane} className="list-scroll">
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
                data-post={post.no}
                className="post-card animate-enter"
                style={{ animationDelay: `${Math.min(index, 24) * 12}ms` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-100">
                    {stripHtml(post.name || "Anonymous")}
                  </span>
                  <span className="meta text-[11px] text-slate-400">{post.no <= (initialReading.current?.post ?? 0) ? "既読 · " : ""}No.{post.no}</span>
                </div>

                {imageUrl && (
                  <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                    <button
                      type="button"
                      aria-label={"投稿 " + post.no + " の画像を拡大"}
                      onClick={() => setViewer(mediaList.findIndex(m => m.postNo === post.no))}
                      className="post-image-link"
                    >
                      <img
                        src={thumbUrl ?? imageUrl}
                        alt={`post-${post.no}`}
                        className="post-thumb"
                      />
                    </button>

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
                        disabled={busy}
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

                <p className="post-body mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                  {plainText || "(no comment)"}
                </p>

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
                <button
                  type="button"
                  aria-label={"投稿 " + media.postNo + " の画像を拡大"}
                  onClick={() => setViewer(index)}
                  className="gallery-link"
                >
                  <img
                    src={media.thumb}
                    alt={`gallery-${media.postNo}`}
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      if (!media.filename.endsWith(".webm") && e.currentTarget.src !== new URL(media.full, location.href).href) e.currentTarget.src = media.full;
                    }}
                    className="gallery-thumb"
                  />
                </button>
                <div className="gallery-meta">
                  <span className="meta text-[11px] text-slate-300">No.{media.postNo}</span>
                  <button
                    type="button"
                    disabled={busy}
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

      {viewer !== null && viewer >= 0 && <MediaViewer items={mediaList} initialIndex={viewer} onClose={() => setViewer(null)} />}
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
