import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSave } from "./SaveProvider";
import { MediaViewer, MediaItem } from "./MediaViewer";
import { RemoteImage } from "./RemoteImage";
import { ReplyText } from "./ReplyText";
import { TranslateButton } from "./TranslateButton";
import { providers, imageBase } from "../lib/providers";
import { plainText } from "../lib/text";
import { getLibrary, getClearEpoch, rememberReading, toggleFavorite, useLibrary, setFilters } from "../lib/library";

type Media = MediaItem & { target: ImageTarget };
export function ThreadView({ source, board, threadId }: { source: BoardSource; board: string; threadId: number }) {
  const provider = providers[source];
  const [posts, setPosts] = useState<PostInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const [loadedIds, setLoadedIds] = useState<number[]>([threadId]);
  const [noMoreOlder, setNoMoreOlder] = useState(false);
  const [viewMode, setViewMode] = useState<"thread" | "gallery">("thread");
  const [viewer, setViewer] = useState<number | null>(null);
  const [consent, setConsent] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [aa, setAa] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const scrollPane = useRef<HTMLDivElement>(null);
  const requests = useRef<AbortController | null>(null);
  const library = useLibrary(source);
  const [wordsDraft, setWordsDraft] = useState(library.filters.words.join("\n"));
  const [idsDraft, setIdsDraft] = useState(library.filters.ids.join("\n"));
  useEffect(() => { setWordsDraft(library.filters.words.join("\n")); setIdsDraft(library.filters.ids.join("\n")); }, [library.filters]);
  const readingKey = board + "/" + threadId;
  const initialReading = useRef(getLibrary(source).reads[readingKey]);
  const lastScroll = useRef(initialReading.current?.scroll ?? 0);
  const { busy, save: saveMedia } = useSave();

  useEffect(() => {
    const controller = new AbortController(); requests.current = controller;
    provider.posts(board, threadId, controller.signal).then(data => {
      if (!controller.signal.aborted) setPosts(data);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [provider, board, threadId]);

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
      lastPost = Number(visible[visible.length - 1]?.dataset.post ?? 0); lastScroll.current = pane.scrollTop;
    };
    const record = () => { if (epoch === getClearEpoch()) rememberReading(readingKey, lastPost, lastScroll.current, source); };
    const scroll = () => { sample(); clearTimeout(timer); timer = setTimeout(record, 250); };
    sample(); record(); pane.addEventListener("scroll", scroll); window.addEventListener("beforeunload", record);
    return () => { clearTimeout(timer); record(); pane.removeEventListener("scroll", scroll); window.removeEventListener("beforeunload", record); };
  }, [loading, error, readingKey, viewMode, source]);

  const hidden = (p: PostInfo) => provider.capabilities.references && ((p.id && library.filters.ids.includes(p.id)) || library.filters.words.some(word => plainText(p.com ?? "").includes(word)));
  const visiblePosts = posts.filter(p => (showHidden || !hidden(p)) && (!selectedId || p.id === selectedId));
  const mediaList = useMemo<Media[]>(() => {
    const seen = new Set<string>();
    const result: Media[] = [];
    for (const post of posts) {
      if (provider.capabilities.remoteImages) {
        if ((!showHidden && ((post.id && library.filters.ids.includes(post.id)) || library.filters.words.some(word => plainText(post.com ?? "").includes(word)))) || (selectedId && post.id !== selectedId)) continue;
        for (const url of post.media ?? []) if (!seen.has(url) && result.length < 2000) {
          seen.add(url); result.push({ postNo: post.no, full: url, thumb: url, filename: new URL(url).pathname.split("/").pop()!, remote: true, target: { source: "5ch", url } });
        }
      } else if (post.tim && post.ext) {
        const filename = `${post.tim}${post.ext}`;
        result.push({ postNo: post.no, filename, full: `${imageBase()}/${board}/${filename}`, thumb: `${imageBase()}/${board}/${post.tim}s.jpg`, target: { url: `https://i.4cdn.org/${board}/${filename}`, filename } });
      }
    }
    return result;
  }, [posts, provider, board, library.filters, selectedId, showHidden]);
  useEffect(() => { setViewer(null); setPage(0); }, [library.filters, selectedId, showHidden]);
  const remote = provider.capabilities.remoteImages;
  const pageSize = remote ? 12 : mediaList.length || 1;
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(mediaList.length / pageSize) - 1));
  const currentMedia = mediaList.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  const allowImages = () => {
    if (window.confirm("外部画像ホストに接続するとIPアドレス等が相手に伝わります。対応画像（Imgur / Postimages / ImgBB、1枚8MB以内）を読み込みますか？")) setConsent(true);
  };
  const jump = (no: number) => {
    setViewMode("thread"); setSelectedId(null); setViewer(null);
    requestAnimationFrame(() => scrollPane.current?.querySelector<HTMLElement>(`[data-post="${no}"]`)?.scrollIntoView({ block: "start" }));
  };
  const refresh = async (older = false) => {
    const signal = requests.current?.signal;
    if (!signal || signal.aborted || refreshLock.current) return;
    refreshLock.current = true; setRefreshing(true); setNotice("");
    try {
      if (older && provider.archive) {
        const archive = await provider.archive(board, signal);
        if (signal.aborted) return;
        const next = archive.filter(id => typeof id === "number" && id < loadedIds[loadedIds.length - 1] && !loadedIds.includes(id)).sort((a, b) => b - a)[0];
        if (!next) { setNoMoreOlder(true); return; }
        const data = await provider.posts(board, next, signal);
        if (!signal.aborted) { setPosts(prev => [...prev, ...data]); setLoadedIds(ids => [...ids, next]); }
      } else {
        const data = await provider.posts(board, threadId, signal);
        if (!signal.aborted) {
          const max = Math.max(0, ...posts.map(p => p.no));
          setNotice(`新着 ${data.filter(p => p.no > max).length} 件${source === "5ch" ? "（更新間隔は最低10秒）" : ""}`);
          setPosts(data); setLoadedIds([threadId]); setError(""); setNoMoreOlder(false); setViewer(null);
        }
      }
    } catch (e) { if (!signal.aborted) setNotice(e instanceof Error ? e.message : "取得に失敗しました。"); }
    finally { refreshLock.current = false; if (!signal.aborted) setRefreshing(false); }
  };
  const save = (media: Media[]) => { if (!remote || consent) void saveMedia(media.map(m => m.target)); };
  if (loading) return <div className="panel-surface pane-flex"><div className="load-state">Loading thread...</div></div>;
  if (error) return <div className="panel-surface pane-flex"><div className="error-state" role="alert">{error}<button className="ui-btn" disabled={refreshing} onClick={() => refresh()}>再試行</button>{notice && <p>{notice}</p>}</div></div>;

  return <div className="panel-surface pane-flex">
    <div className="panel-header">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="panel-title">/{board}/ No.{threadId}</h2><p className="meta mt-1 text-[11px] text-slate-400">{source} · Posts {posts.length} / Images {mediaList.length}</p></div>
        <div className="flex flex-wrap gap-2">
          <button className="ui-btn" aria-pressed={library.threads.includes(readingKey)} onClick={() => toggleFavorite("threads", readingKey, source)}>{library.threads.includes(readingKey) ? "お気に入り解除" : "お気に入り"}</button>
          <button className={`ui-btn ${viewMode === "thread" ? "ui-btn--active" : ""}`} onClick={() => setViewMode("thread")}>Thread</button>
          <button className={`ui-btn ${viewMode === "gallery" ? "ui-btn--active" : ""}`} onClick={() => setViewMode("gallery")}>Gallery</button>
          <button className="ui-btn" disabled={refreshing} onClick={() => refresh()}>更新</button>
          <button className="ui-btn ui-btn--primary" disabled={busy || !mediaList.length || (remote && !consent)} onClick={() => save(mediaList)}>{busy ? "保存中…" : "Save all"}</button>
        </div>
      </div>
      {provider.capabilities.references && <details className="reader-options"><summary>閲覧設定・非表示設定</summary>
        <label><input type="checkbox" checked={aa} onChange={e => setAa(e.target.checked)} /> AA表示</label>
        <label><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} /> 非表示レスを一時表示</label>
        <button className="ui-btn" onClick={() => { const unread = posts.find(p => p.no > (initialReading.current?.post ?? 0)); if (unread) jump(unread.no); }}>未読位置へ</button>
        <label>非表示ワード（1行1件・文字列一致）<textarea value={wordsDraft} onChange={e => setWordsDraft(e.target.value)} /></label>
        <label>非表示ID（1行1件）<textarea value={idsDraft} onChange={e => setIdsDraft(e.target.value)} /></label>
        <button className="ui-btn" onClick={() => setFilters({ words: wordsDraft.split("\n").map(s => s.trim()), ids: idsDraft.split("\n").map(s => s.trim()) }, source)}>非表示設定を保存</button>
      </details>}
      {selectedId && <button className="ui-btn mt-2" onClick={() => setSelectedId(null)}>ID: {selectedId} の絞り込みを解除</button>}
      {notice && <p className="reader-notice" role="status">{notice}</p>}
      {remote && <div className="image-consent"><span>外部画像は自動取得しません。対応: Imgur / Postimages / ImgBB</span>{!consent ? <button className="ui-btn" onClick={allowImages}>画像を読み込む</button> : <button className="ui-btn" onClick={() => { setConsent(false); setViewer(null); }}>画像の表示を停止</button>}</div>}
    </div>
    <div ref={scrollPane} className="list-scroll">
      {viewMode === "thread" ? visiblePosts.map((post, index) => {
        const text = plainText(post.com ?? "");
        const media = mediaList.find(m => m.postNo === post.no);
        return <article key={post.no} data-post={post.no} className="post-card animate-enter" style={{ animationDelay: `${Math.min(index, 24) * 12}ms` }}>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">{plainText(post.name || "Anonymous")}</span><span className="meta text-[11px] text-slate-400">{post.no <= (initialReading.current?.post ?? 0) ? "既読 · " : ""}No.{post.no}</span></div>
          {post.date && <p className="meta text-xs mt-2">{plainText(post.date)}</p>}
          {post.id && <div className="flex gap-2 mt-2"><button className="ui-btn" onClick={() => setSelectedId(post.id!)}>ID: {post.id}</button><button className="ui-btn" onClick={() => setFilters({ ...library.filters, ids: [...library.filters.ids, post.id!] }, source)}>IDを非表示</button></div>}
          {media && !remote && <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <button className="post-image-link" aria-label={`投稿 ${post.no} の画像を拡大`} onClick={() => setViewer(mediaList.indexOf(media))}><img className="post-thumb" src={media.thumb} alt={`post-${post.no}`} /></button>
            <div className="flex gap-2"><button className="ui-btn ui-btn--primary ui-btn--small" disabled={busy} onClick={() => save([media])}>Save image</button><a className="ui-btn" href={media.full} target="_blank" rel="noopener noreferrer">Open full</a></div>
          </div>}
          <div className={`post-body mt-3 whitespace-pre-wrap text-sm leading-relaxed ${aa ? "aa-body" : ""}`}>{provider.capabilities.references ? <ReplyText text={text} posts={visiblePosts} onJump={jump} /> : text || "(no comment)"}</div>
          {remote && (post.media?.length ?? 0) > 0 && <button className="ui-btn mt-2" onClick={() => { setViewMode("gallery"); setPage(Math.floor(Math.max(0, mediaList.findIndex(m => m.postNo === post.no)) / pageSize)); }}>画像 {post.media!.length} 件を一覧で見る</button>}
          {provider.capabilities.translation && post.com && <TranslateButton text={text} className="mt-3" />}
        </article>;
      }) : <>
        <div className="gallery-tools"><button className="ui-btn" disabled={busy || (remote && !consent) || !mediaList.some(m => selected.has(m.full))} onClick={() => save(mediaList.filter(m => selected.has(m.full)))}>選択した画像を保存</button><span>{mediaList.filter(m => selected.has(m.full)).length} 件選択</span></div>
        <div className="gallery-grid">{currentMedia.map((media, index) => <div className="gallery-card" key={media.full}>
          <div className="gallery-link" role="button" tabIndex={0} aria-label={`投稿 ${media.postNo} の画像を拡大`} onClick={() => { if (!remote || consent) setViewer(pageIndex * pageSize + index); }} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); if (!remote || consent) setViewer(pageIndex * pageSize + index); } }}>
            {remote ? consent ? <RemoteImage url={media.full} alt={`post-${media.postNo}`} className="gallery-thumb" /> : <div className="media-placeholder">未読み込み<br />{new URL(media.full).hostname}</div> : <img src={media.thumb} alt={`gallery-${media.postNo}`} className="gallery-thumb" />}
          </div>
          <div className="gallery-meta"><label><input type="checkbox" aria-label={`画像 ${index + 1} を選択`} checked={selected.has(media.full)} onChange={e => setSelected(prev => { const next = new Set(prev); if (e.target.checked) next.add(media.full); else next.delete(media.full); return next; })} /> No.{media.postNo}</label><button className="ui-btn ui-btn--primary ui-btn--small" disabled={busy || (remote && !consent)} onClick={() => save([media])}>Save</button></div>
          <button className="ui-btn m-2" onClick={() => jump(media.postNo)}>元のレスへ</button>
        </div>)}</div>
        {!mediaList.length && <p className="empty-state">対応する画像がありません。外部画像は許可ホストのHTTPS直リンクのみ対象です。</p>}
        {remote && mediaList.length > pageSize && <div className="gallery-tools"><button className="ui-btn" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>前の画像</button><span>{pageIndex + 1} / {Math.ceil(mediaList.length / pageSize)}</span><button className="ui-btn" disabled={(pageIndex + 1) * pageSize >= mediaList.length} onClick={() => setPage(pageIndex + 1)}>次の画像</button></div>}
      </>}
      {viewMode === "thread" && !visiblePosts.length && <p className="empty-state">表示対象がありません。非表示設定やIDの絞り込みを確認してください。</p>}
    </div>
    {viewer !== null && mediaList[viewer] && <MediaViewer items={mediaList} initialIndex={viewer} onClose={() => setViewer(null)} onJump={jump} />}
    {provider.capabilities.archive && !noMoreOlder && <div className="panel-footer"><button className="ui-btn w-full" disabled={refreshing} onClick={() => refresh(true)}>{refreshing ? "Loading older thread..." : "Load older thread"}</button></div>}
  </div>;
}
