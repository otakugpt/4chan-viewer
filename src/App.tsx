import React, { useEffect, useRef, useState } from "react";
import { BoardList } from "./components/BoardList";
import { ThreadList } from "./components/ThreadList";
import { ThreadView } from "./components/ThreadView";
import { useSave } from "./components/SaveProvider";
import { forgetSelection, getLibrary, useLibrary, getSource, selectSource, rememberSelection, clearLibrary, toggleFavorite } from "./lib/library";

import { loadTabs, saveTabs, tabId, MAX_TABS, ReaderTab } from "./lib/tabs";

const EmptyPane = ({ title }: { title: string }) => <div className="panel-surface pane-flex empty-pane"><h2>{title}</h2><p className="mt-3">左から板、スレッドを選択してください。</p></div>;
export const App: React.FC = () => {
  const [source, setSource] = useState<BoardSource>(getSource);
  const [board, setBoard] = useState<string | null>(() => getLibrary(getSource()).last?.board ?? null);
  const [thread, setThread] = useState<number | null>(() => getLibrary(getSource()).last?.thread ?? null);
  const [tabs, setTabs] = useState<ReaderTab[]>(() => {
    const saved = loadTabs();
    const last = getLibrary(getSource()).last;
    if (last) {
      const current = { source: getSource(), board: last.board, thread: last.thread };
      if (!saved.some(t => tabId(t) === tabId(current)) && saved.length < MAX_TABS) saved.push(current);
    }
    return saved;
  });
  const [tabNotice, setTabNotice] = useState("");
  useEffect(() => saveTabs(tabs), [tabs]);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [opening, setOpening] = useState(false);
  const navigation = useRef(0);
  const library = useLibrary(source);
  const { progress, status, busy, failed, save } = useSave();
  const activate = (next: BoardSource, b: string | null, t: number | null) => {
    navigation.current++; setOpening(false); setUrlError(""); setTabNotice("");
    setSource(next); selectSource(next); setBoard(b); setThread(t);
    if (b) rememberSelection(b, t, next); else forgetSelection(next);
  };
  const openTab = (next: BoardSource, b: string | null, t: number | null) => {
    if (b) {
      const target = { source: next, board: b, thread: t };
      if (!tabs.some(item => tabId(item) === tabId(target))) {
        if (tabs.length >= MAX_TABS) { setTabNotice("タブは20件までです。不要なタブを閉じてください。"); return; }
        setTabs(items => [...items, target]);
      }
    }
    activate(next, b, t);
  };
  const select = (b: string, t: number | null) => openTab(source, b, t);
  const changeSource = (next: BoardSource) => {
    const last = getLibrary(next).last;
    openTab(next, last?.board ?? null, last?.thread ?? null);
  };
  const closeTab = (tab: ReaderTab) => {
    const index = tabs.findIndex(item => tabId(item) === tabId(tab));
    const remaining = tabs.filter(item => tabId(item) !== tabId(tab));
    setTabs(remaining); setTabNotice("");
    if (source === tab.source && board === tab.board && thread === tab.thread) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      if (next) activate(next.source, next.board, next.thread);
      else activate(source, null, null);
    }
  };
  const openUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const generation = ++navigation.current;
    setOpening(true); setUrlError("");
    try {
      if (!window.electron?.fiveRequest) throw new Error("5ch閲覧は Electron アプリで利用できます。");
      const result = await window.electron.fiveRequest({ kind: "resolve", url: url.trim() });
      if (generation !== navigation.current) return;
      if ("error" in result) throw new Error(result.error);
      if ("board" in result) select(result.board, result.thread);
    } catch (error) { if (generation === navigation.current) setUrlError(error instanceof Error ? error.message : "URLを開けませんでした。"); }
    finally { if (generation === navigation.current) setOpening(false); }
  };
  return <div className="app-shell">
    <header className="topbar panel-surface">
      <h1 className="topbar-title" title="RIFT（仮称）">RIFT</h1>
      <div className="topbar-meta">
        <nav aria-label="掲示板サイト" className="flex gap-2">{(["4chan", "5ch"] as BoardSource[]).map(site => <button key={site} data-source={site} className={`ui-btn ${source === site ? "ui-btn--active" : ""}`} aria-pressed={source === site} onClick={() => changeSource(site)}>{site}</button>)}</nav>
        {source === "5ch" && <form onSubmit={openUrl} className="url-bar"><input value={url} onChange={e => setUrl(e.target.value)} aria-label="5chのURL" placeholder="5chの板・スレッドURL（旧 .net も対応）" /><button className="ui-btn" disabled={opening || !url.trim()}>{opening ? "確認中…" : "URLを開く"}</button>{urlError && <span role="alert">{urlError}</span>}</form>}
        <span className="chip meta">{board ? `/${board}/` : "No board"}</span>
        <span className="chip meta">{thread ? `No.${thread}` : "No thread"}</span>
        <button className="ui-btn" onClick={() => { if (window.confirm("全サイトのお気に入り・閲覧履歴・非表示設定を削除しますか？")) { navigation.current++; clearLibrary(); setTabs([]); setTabNotice(""); setBoard(null); setThread(null); } }}>閲覧データを消去</button>
      </div>
    </header>
    {library.threads.length > 0 && <nav className="favorite-strip" aria-label="お気に入りスレッド">{library.threads.map(id => <span key={id} className="flex gap-1"><button className="ui-btn" onClick={() => { const [b, t] = id.split("/"); select(b, Number(t)); }}>{source} /{id}</button><button className="ui-btn" aria-label={id + " をお気に入りから削除"} onClick={() => toggleFavorite("threads", id, source)}>解除</button></span>)}</nav>}
    {tabs.length > 0 && <nav className="reader-tabs" aria-label="開いているタブ">{tabs.map(tab => {
      const active = source === tab.source && board === tab.board && thread === tab.thread;
      const label = tab.source + " /" + tab.board + (tab.thread ? " / " + tab.thread : " / 板一覧");
      return <span className={active ? "reader-tab reader-tab--active" : "reader-tab"} key={tabId(tab)}>
        <button className="ui-btn" aria-current={active ? "page" : undefined} title={label} onClick={() => activate(tab.source, tab.board, tab.thread)}>{label}</button>
        <button className="ui-btn" aria-label={label + " を閉じる"} onClick={() => closeTab(tab)}>×</button>
      </span>;
    })}</nav>}
    {tabNotice && <p className="reader-notice" role="status">{tabNotice}</p>}
    <main className="workspace-grid">
      <section className="workspace-pane"><BoardList key={source} source={source} selectedBoard={board} onSelect={b => select(b, null)} /></section>
      <section className="workspace-pane">{board ? <ThreadList key={source + board} source={source} board={board} onSelect={t => select(board, t)} selectedThread={thread} /> : <EmptyPane title="Select a Board" />}</section>
      <section className="workspace-pane">{board && thread ? <ThreadView key={source + board + "/" + thread} source={source} board={board} threadId={thread} /> : <EmptyPane title="Select a Thread" />}</section>
    </main>
    {status && <footer className="status-bar panel-surface">
      <div className="flex items-center justify-between gap-4"><span className="meta">Save Status</span><span>{Math.round(progress)}%</span></div>
      <div className="mt-1 text-sm" role="status">{status}</div>
      {failed.length > 0 && <button className="ui-btn mt-2" disabled={busy} onClick={() => save(failed)}>失敗した {failed.length} 件だけ再試行</button>}
      <div className="progress-track mt-3"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
    </footer>}
  </div>;
};
