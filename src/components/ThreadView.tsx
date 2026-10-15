import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSave } from "./SaveProvider";
import { MediaViewer, MediaItem } from "./MediaViewer";
import { RemoteImage } from "./RemoteImage";
import { UrlText } from "./UrlText";
import { PttAgeNotice } from "./PttAccess";
import { saveThread } from "../lib/savedThreads";
import { ReplyText } from "./ReplyText";
import { TranslateButton } from "./TranslateButton";
import { providers, imageBase } from "../lib/providers";
import { requireReadyPage, mergePage, PageAccessError } from "../lib/pages";
import { readBoundary } from "../lib/reading";
import { plainText } from "../lib/text";
import { recordVisit, getHistoryEpoch, getLibrary, getClearEpoch, rememberReading, toggleFavorite, useLibrary, setFilters } from "../lib/library";

type Media = MediaItem;
export function ThreadView({ source, board, threadId }: { source: BoardSource; board: string; threadId: ThreadId }) {
  const provider = providers[source];
  const [posts, setPosts] = useState<PostInfo[]>([]);
  const currentPosts = useRef<PostInfo[]>([]);
  const [savingText, setSavingText] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ageRequired, setAgeRequired] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const [loadedIds, setLoadedIds] = useState<ThreadId[]>([threadId]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [publicOnly, setPublicOnly] = useState(false);
  const visitedCursors = useRef(new Set<string>());
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
  const visitEpoch = useRef(getHistoryEpoch(source, readingKey));
  const visited = useRef(false);
  const markVisit = (data: PostInfo[]) => {
    if (!visited.current) { recordVisit(readingKey, source, plainText(data[0]?.sub ?? ""), visitEpoch.current); visited.current = true; }
  };
  const initialReading = useRef(getLibrary(source).reads[readingKey]);
  const lastScroll = useRef(initialReading.current?.scroll ?? 0);
  const { busy, save: saveMedia } = useSave();

  useEffect(() => {
    const controller = new AbortController(); requests.current = controller;
    provider.posts(board, threadId, controller.signal).then(result => {
      if (!controller.signal.aborted) {
        const page = requireReadyPage(result), data = page.items;
        setPublicOnly(page.publicOnly === true);
        markVisit(data); currentPosts.current = data; setPosts(data);
        setNextCursor(provider.capabilities.postPages ? page.nextCursor : null);
      }
    }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setAgeRequired(e instanceof PageAccessError && e.status === "age-confirmation-required"); } })
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
    let anchor: { postId: PostId; order: number } | undefined;
    const sample = () => {
      const bottom = pane.getBoundingClientRect().bottom;
      const visible = [...pane.querySelectorAll<HTMLElement>("[data-post]")].filter(el => el.getBoundingClientRect().top < bottom);
      const element = visible[visible.length - 1];
      lastPost = Number(element?.dataset.post ?? 0); lastScroll.current = pane.scrollTop;
      anchor = element ? { postId: element.dataset.postId!, order: Number(element.dataset.order) } : undefined;
    };
    const record = () => { if (epoch === getClearEpoch() && visitEpoch.current === getHistoryEpoch(source, readingKey)) rememberReading(readingKey, lastPost, lastScroll.current, source, anchor); };
    const scroll = () => { sample(); clearTimeout(timer); timer = setTimeout(record, 250); };
    sample(); record(); pane.addEventListener("scroll", scroll); window.addEventListener("beforeunload", record);
    return () => { clearTimeout(timer); record(); pane.removeEventListener("scroll", scroll); window.removeEventListener("beforeunload", record); };
  }, [loading, error, readingKey, viewMode, source]);

  const hidden = (p: PostInfo) => provider.capabilities.references && ((p.id && library.filters.ids.includes(p.id)) || library.filters.words.some(word => plainText(p.com ?? "").includes(word)));
  const visiblePosts = posts.filter(p => (showHidden || !hidden(p)) && (!selectedId || p.id === selectedId));
  const boundary = readBoundary(posts, initialReading.current);
  const readIds = new Set(posts.slice(0, boundary + 1).map(post => post.postId));
  const mediaList = useMemo<Media[]>(() => {
    const seen = new Set<string>();
    const result: Media[] = [];
    for (const post of posts) {
      if (provider.capabilities.remoteImages) {
        if (provider.capabilities.references && ((!showHidden && ((post.id && library.filters.ids.includes(post.id)) || library.filters.words.some(word => plainText(post.com ?? "").includes(word)))) || (selectedId && post.id !== selectedId))) continue;
        for (const url of post.media ?? []) if (!seen.has(url) && result.length < 2000) {
          seen.add(url); result.push({ postId: post.postId, postNo: post.no, full: url, thumb: url, filename: new URL(url).pathname.split("/").pop()!, remote: true, target: { source, url } });
        }
      } else if (post.tim && post.ext) {
        const filename = `${post.tim}${post.ext}`;
        result.push({ postId: post.postId, postNo: post.no, filename, full: `${imageBase()}/${board}/${filename}`, thumb: `${imageBase()}/${board}/${post.tim}s.jpg`, target: { url: `https://i.4cdn.org/${board}/${filename}`, filename } });
      }
    }
    return result;
  }, [posts, provider, source, board, library.filters, selectedId, showHidden]);
  useEffect(() => { setViewer(null); setPage(0); }, [library.filters, selectedId, showHidden]);
  const remote = provider.capabilities.remoteImages && !publicOnly;
  const pageSize = remote ? 12 : mediaList.length || 1;
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(mediaList.length / pageSize) - 1));
  const currentMedia = mediaList.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  const allowImages = () => {
    if (window.confirm("外部画像ホストに接続するとIPアドレス等が相手に伝わります。対応画像（Imgur / Postimages / ImgBB、1枚8MB以内）を読み込みますか？")) setConsent(true);
  };
  const jump = (postId: PostId) => {
    setViewMode("thread"); setSelectedId(null); setViewer(null);
    requestAnimationFrame(() => [...(scrollPane.current?.querySelectorAll<HTMLElement>("[data-post-id]") ?? [])].find(element => element.dataset.postId === postId)?.scrollIntoView({ block: "start" }));
  };
  const refresh = async (older = false, more = false) => {
    const signal = requests.current?.signal;
    if (!signal || signal.aborted || refreshLock.current) return;
    refreshLock.current = true; setRefreshing(true); setNotice("");
    try {
      if (older && provider.archive) {
        const archive = await provider.archive(board, signal);
        if (signal.aborted) return;
        const next = archive.filter(id => Number(id) < Number(loadedIds[loadedIds.length - 1]) && !loadedIds.includes(id)).sort((a, b) => Number(b) - Number(a))[0];
        if (!next) { setNoMoreOlder(true); return; }
        const result = await provider.posts(board, next, signal);
        if (signal.aborted) return;
        const data = requireReadyPage(result).items;
        if (!signal.aborted) { setPosts(prev => [...prev, ...data]); setLoadedIds(ids => [...ids, next]); }
      } else {
        if (more && !nextCursor) return;
        const result = await provider.posts(board, threadId, signal, more ? nextCursor! : undefined);
        if (!signal.aborted) {
          const page = requireReadyPage(result);
          setPublicOnly(page.publicOnly === true);
          if (!more) visitedCursors.current.clear();
          else visitedCursors.current.add(nextCursor!);
          if (page.nextCursor && visitedCursors.current.has(page.nextCursor)) throw new Error("ページの循環を検出しました。更新して再試行してください。");
          const data = more ? mergePage(currentPosts.current, page.items, post => post.postId) : page.items;
          const existing = new Set(currentPosts.current.map(post => post.postId));
          setNotice(`新着 ${page.items.filter(p => !existing.has(p.postId)).length} 件${source === "5ch" ? "（更新間隔は最低10秒）" : ""}`);
          markVisit(data); currentPosts.current = data; setPosts(data); setLoadedIds([threadId]); setError(""); setAgeRequired(false); setNoMoreOlder(false); setViewer(null);
          setNextCursor(provider.capabilities.postPages ? page.nextCursor : null);
        }
      }
    } catch (e) { if (!signal.aborted) {
      if (e instanceof PageAccessError) { currentPosts.current = []; setPosts([]); setViewer(null); setNextCursor(null); setError(e.message); setAgeRequired(e.status === "age-confirmation-required"); }
      setNotice(e instanceof Error ? e.message : "取得に失敗しました。");
    } }
    finally { refreshLock.current = false; if (!signal.aborted) setRefreshing(false); }
  };
  const saveText = async () => {
    if (!window.confirm("取得済みのこのスレッド本文をPC内に保存します（画像・訳文は含みません）。既存の保存本文がある場合は更新します。")) return;
    setSavingText(true); setNotice("");
    try {
      await saveThread({ version: 2, key: "", source, board, thread: threadId, title: (library.metadata[readingKey]?.title || plainText(currentPosts.current[0]?.sub ?? "") || readingKey).slice(0, 300), savedAt: Date.now(),
        posts: currentPosts.current.map(p => ({ postId: p.postId, order: p.order, no: p.no, name: plainText(p.name ?? ""), date: plainText(p.date ?? ""), id: p.id ?? "", com: (p.reaction ? p.reaction + " " : "") + plainText(p.com ?? "") })) });
      setNotice("本文を保存しました。左の「保存済みスレッド」から読めます。");
    } catch (e) { setNotice(e instanceof Error ? e.message : "本文を保存できませんでした。"); }
    finally { setSavingText(false); }
  };
  const save = (media: Media[]) => { if (!remote || consent) void saveMedia(media.map(m => m.target)); };
  if (loading) return <div className="panel-surface pane-flex"><div className="load-state">Loading thread...</div></div>;
  if (error) return <div className="panel-surface pane-flex"><div className="error-state" role="alert">{source === "ptt" && ageRequired ? <PttAgeNotice /> : <>{error}<button className="ui-btn" disabled={refreshing} onClick={() => refresh()}>再試行</button>{notice && <p>{notice}</p>}</>}</div></div>;

  return <div className="panel-surface pane-flex">
    <div className="panel-header">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="panel-title thread-heading">{plainText(posts[0]?.sub ?? "") || library.metadata[readingKey]?.title || `/${board}/ No.${threadId}`}</h2><p className="meta mt-1 text-[11px] text-slate-400">{source}{source === "5ch" && posts[0]?.archived ? " · 公式過去ログ" : ""} · Posts {posts.length}{(source === "4chan" || remote) && ` / Images ${mediaList.length}`}</p></div>
        <div className="flex flex-wrap gap-2">
          <button className="ui-btn" aria-pressed={library.threads.includes(readingKey)} onClick={() => toggleFavorite("threads", readingKey, source, plainText(posts[0]?.sub ?? ""))}>{library.threads.includes(readingKey) ? "お気に入り解除" : "お気に入り"}</button>
          <button className={`ui-btn ${viewMode === "thread" ? "ui-btn--active" : ""}`} onClick={() => setViewMode("thread")}>Thread</button>
          {(source === "4chan" || remote) && <button className={`ui-btn ${viewMode === "gallery" ? "ui-btn--active" : ""}`} onClick={() => setViewMode("gallery")}>Gallery</button>}
          <button className="ui-btn" disabled={refreshing} onClick={() => refresh()}>更新</button>
          <button className="ui-btn save-thread-text" disabled={savingText || refreshing} onClick={() => void saveText()}>{savingText ? "本文保存中…" : "本文を保存"}</button>
          {(source === "4chan" || remote) && <button className="ui-btn ui-btn--primary" disabled={busy || !mediaList.length || (remote && !consent)} onClick={() => save(mediaList)}>{busy ? "保存中…" : "Save all"}</button>}
        </div>
      </div>
      {provider.capabilities.references && <details className="reader-options"><summary>閲覧設定・非表示設定</summary>
        <label><input type="checkbox" checked={aa} onChange={e => setAa(e.target.checked)} /> AA表示</label>
        <label><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} /> 非表示レスを一時表示</label>
        <button className="ui-btn" onClick={() => { const unread = posts[boundary + 1]; if (unread) jump(unread.postId); }}>未読位置へ</button>
        <label>非表示ワード（1行1件・文字列一致）<textarea value={wordsDraft} onChange={e => setWordsDraft(e.target.value)} /></label>
        <label>非表示ID（1行1件）<textarea value={idsDraft} onChange={e => setIdsDraft(e.target.value)} /></label>
        <button className="ui-btn" onClick={() => setFilters({ words: wordsDraft.split("\n").map(s => s.trim()), ids: idsDraft.split("\n").map(s => s.trim()) }, source)}>非表示設定を保存</button>
      </details>}
      {selectedId && <button className="ui-btn mt-2" onClick={() => setSelectedId(null)}>ID: {selectedId} の絞り込みを解除</button>}
      {notice && <p className="reader-notice" role="status">{notice}</p>}
      {publicOnly && <div className="reader-notice"><p>公式フィードで公開された本文です。本文が省略される場合があります。画像取得・過去ページには対応しません。返信は試験取得で、表示件数が全件とは限りません。保存対象は取得済みの本文・返信だけです。</p><UrlText text={`原文: https://www.v2ex.com/t/${threadId}`} externalOnly /></div>}
      {source === "v2ex" && !publicOnly && nextCursor && <p className="reader-notice">未取得の返信がある場合は下の「続きの投稿を読み込む」で取得できます。本文保存の対象は取得済みの投稿だけです。</p>}
      {remote && <div className="image-consent"><span>外部画像は自動取得しません。対応: Imgur / Postimages / ImgBB</span>{!consent ? <button className="ui-btn" onClick={allowImages}>画像を読み込む</button> : <button className="ui-btn" onClick={() => { setConsent(false); setViewer(null); }}>画像の表示を停止</button>}</div>}
    </div>
    <div ref={scrollPane} className="list-scroll">
      {viewMode === "thread" ? visiblePosts.map((post, index) => {
        const text = plainText(post.com ?? "");
        const media = mediaList.find(m => m.postId === post.postId);
        return <article key={post.postId} data-post={post.no} data-post-id={post.postId} data-order={post.order} className="post-card animate-enter" style={{ animationDelay: `${Math.min(index, 24) * 12}ms` }}>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold">{post.reaction && <span className="chip ptt-reaction">{post.reaction}</span>} {plainText(post.name || "Anonymous")}</span><span className="meta text-[11px] text-slate-400">{readIds.has(post.postId) ? "既読 · " : ""}{source === "ptt" ? post.order === 1 ? "本文" : `コメント ${post.order - 1}` : `No.${post.no}`}</span></div>
          {post.date && <p className="meta text-xs mt-2">{plainText(post.date)}</p>}
          {post.id && <div className="flex gap-2 mt-2"><button className="ui-btn" onClick={() => setSelectedId(post.id!)}>ID: {post.id}</button><button className="ui-btn" onClick={() => setFilters({ ...library.filters, ids: [...library.filters.ids, post.id!] }, source)}>IDを非表示</button></div>}
          {media && !remote && <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <button className="post-image-link" aria-label={`投稿 ${post.no} の画像を拡大`} onClick={() => setViewer(mediaList.indexOf(media))}><img className="post-thumb" src={media.thumb} alt={`post-${post.no}`} /></button>
            <div className="flex gap-2"><button className="ui-btn ui-btn--primary ui-btn--small" disabled={busy} onClick={() => save([media])}>Save image</button><a className="ui-btn" href={media.full} target="_blank" rel="noopener noreferrer">Open full</a></div>
          </div>}
          <div className={`post-body mt-3 whitespace-pre-wrap text-sm leading-relaxed ${aa ? "aa-body" : ""}`}>{provider.capabilities.references ? <ReplyText text={text} posts={visiblePosts} onJump={jump} /> : <UrlText text={text || "(no comment)"} />}</div>
          {remote && (post.media?.length ?? 0) > 0 && <button className="ui-btn mt-2" onClick={() => { setViewMode("gallery"); setPage(Math.floor(Math.max(0, mediaList.findIndex(m => m.postId === post.postId)) / pageSize)); }}>画像 {post.media!.length} 件を一覧で見る</button>}
          {provider.capabilities.translation && post.com && <TranslateButton text={text} confirmSend={source === "v2ex" || source === "ptt"} className="mt-3" />}
        </article>;
      }) : <>
        <div className="gallery-tools"><button className="ui-btn" disabled={busy || (remote && !consent) || !mediaList.some(m => selected.has(m.full))} onClick={() => save(mediaList.filter(m => selected.has(m.full)))}>選択した画像を保存</button><span>{mediaList.filter(m => selected.has(m.full)).length} 件選択</span></div>
        <div className="gallery-grid">{currentMedia.map((media, index) => <div className="gallery-card" key={media.full}>
          <div className="gallery-link" role="button" tabIndex={0} aria-label={`投稿 ${media.postNo} の画像を拡大`} onClick={() => { if (!remote || consent) setViewer(pageIndex * pageSize + index); }} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); if (!remote || consent) setViewer(pageIndex * pageSize + index); } }}>
            {remote ? consent ? <RemoteImage url={media.full} alt={`post-${media.postNo}`} className="gallery-thumb" /> : <div className="media-placeholder">未読み込み<br />{new URL(media.full).hostname}</div> : <img src={media.thumb} alt={`gallery-${media.postNo}`} className="gallery-thumb" />}
          </div>
          <div className="gallery-meta"><label><input type="checkbox" aria-label={`画像 ${index + 1} を選択`} checked={selected.has(media.full)} onChange={e => setSelected(prev => { const next = new Set(prev); if (e.target.checked) next.add(media.full); else next.delete(media.full); return next; })} /> No.{media.postNo}</label><button className="ui-btn ui-btn--primary ui-btn--small" disabled={busy || (remote && !consent)} onClick={() => save([media])}>Save</button></div>
          <button className="ui-btn m-2" onClick={() => jump(media.postId)}>元のレスへ</button>
        </div>)}</div>
        {!mediaList.length && <p className="empty-state">対応する画像がありません。外部画像は許可ホストのHTTPS直リンクのみ対象です。</p>}
        {remote && mediaList.length > pageSize && <div className="gallery-tools"><button className="ui-btn" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>前の画像</button><span>{pageIndex + 1} / {Math.ceil(mediaList.length / pageSize)}</span><button className="ui-btn" disabled={(pageIndex + 1) * pageSize >= mediaList.length} onClick={() => setPage(pageIndex + 1)}>次の画像</button></div>}
      </>}
      {viewMode === "thread" && !visiblePosts.length && <p className="empty-state">表示対象がありません。非表示設定やIDの絞り込みを確認してください。</p>}
    </div>
    {viewer !== null && mediaList[viewer] && <MediaViewer items={mediaList} initialIndex={viewer} onClose={() => setViewer(null)} onJump={jump} />}
    {nextCursor && <div className="panel-footer"><button className="ui-btn w-full" disabled={refreshing} onClick={() => { if (!publicOnly || window.confirm("V2EXの公開APIから返信を試験取得します。全件取得は保証されず、続きのページは取得しません。実行しますか？")) void refresh(false, true); }}>{publicOnly ? "公開返信を試験取得" : "続きの投稿を読み込む"}</button></div>}
    {provider.capabilities.archive && !noMoreOlder && <div className="panel-footer"><button className="ui-btn w-full" disabled={refreshing} onClick={() => refresh(true)}>{refreshing ? "Loading older thread..." : "Load older thread"}</button></div>}
  </div>;
}
