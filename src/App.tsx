import React, { useEffect, useRef, useState } from "react";
import { LibrarySidebar, LibraryMode } from "./components/LibrarySidebar";
import { LibraryList } from "./components/LibraryList";
import { SavedThreadList, SavedThreadView } from "./components/SavedThreads";
import { deleteSaved, refreshSaved, SavedThread } from "./lib/savedThreads";
import { ThreadList } from "./components/ThreadList";
import { ThreadNavigation } from "./components/ThreadNavigation";
import { ThreadView } from "./components/ThreadView";
import { useSave } from "./components/SaveProvider";
import { forgetSelection, getLibrary, useLibrary, getSource, selectSource, rememberSelection, clearLibrary } from "./lib/library";

import { loadTabs, saveTabs, clearTabs, tabId, MAX_TABS, ReaderTab } from "./lib/tabs";
import { enabledSources, sources } from "./lib/sources";
import { useLibraries } from "./lib/library";
import { V2exSettings } from "./components/V2exSettings";
import { parseV2exUrl } from "../electron/v2ex-url";
import { parsePttUrl, validPttBoard } from "../electron/ptt-url";
import { PttAccess } from "./components/PttAccess";

const EmptyPane = ({ title }: { title: string }) => <div className="panel-surface pane-flex empty-pane"><h2>{title}</h2><p className="mt-3">左から板、スレッドを選択してください。</p></div>;
export const App: React.FC = () => {
  const [connectionSettings, setConnectionSettings] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [pttRevision, setPttRevision] = useState(0);
  const [pttRevoking, setPttRevoking] = useState(false);
  const siteRevision = (site: BoardSource) => site === "v2ex" ? connectionRevision : site === "ptt" ? pttRevision : 0;
  const [savedDoc, setSavedDoc] = useState<SavedThread | null>(null);
  const [clearing, setClearing] = useState(false);
  useEffect(() => { void refreshSaved(); }, []);
  const [source, setSource] = useState<BoardSource>(getSource);
  const [board, setBoard] = useState<string | null>(() => getLibrary(getSource()).last?.board ?? null);
  const [thread, setThread] = useState<ThreadId | null>(() => getLibrary(getSource()).last?.thread ?? null);
  const [mode, setMode] = useState<LibraryMode>("board");
  const [browseSource, setBrowseSource] = useState<BoardSource>(getSource);
  const [listBoard, setListBoard] = useState<string | null>(() => getLibrary(getSource()).last?.board ?? null);
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
  const [tabStorageError, setTabStorageError] = useState("");
  useEffect(() => { setTabStorageError(saveTabs(tabs) ? "" : "タブを保存できません。既存の保存データを確認してください。"); }, [tabs]);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [opening, setOpening] = useState(false);
  const navigation = useRef(0);
  const library = useLibrary(source);
  const { storageError } = useLibraries();
  const { progress, status, busy, failed, save } = useSave();
  const activate = (next: BoardSource, b: string | null, t: ThreadId | null) => {
    if (!sources[next].enabled) { setTabNotice("このサイトはまだ閲覧できません。"); return; }
    navigation.current++; setSavedDoc(null); setOpening(false); setUrlError(""); setTabNotice("");
    setSource(next); selectSource(next); setBoard(b); setThread(t); setBrowseSource(next); setListBoard(b);
    if (b) rememberSelection(b, t, next); else forgetSelection(next);
  };
  const openTab = (next: BoardSource, b: string | null, t: ThreadId | null) => {
    if (!sources[next].enabled) { setTabNotice("このサイトはまだ閲覧できません。"); return; }
    if (b) {
      const target = { source: next, board: b, thread: t };
      if (!tabs.some(item => tabId(item) === tabId(target))) {
        if (tabs.length >= MAX_TABS) { setTabNotice("タブは20件までです。不要なタブを閉じてください。"); return; }
        setTabs(items => [...items, target]);
      }
    }
    activate(next, b, t);
  };
  const select = (b: string, t: ThreadId | null) => openTab(browseSource, b, t);
  const chooseBoard = (next: BoardSource, b: string) => {
    navigation.current++; setOpening(false); setBrowseSource(next); setListBoard(b); setMode("board");
    if (!thread) openTab(next, b, null);
  };
  const changeSource = (next: BoardSource) => {
    const last = getLibrary(next).last;
    setMode("board"); openTab(next, last?.board ?? null, last?.thread ?? null);
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
  const navigateInternal = async (raw: string) => {
    const generation = ++navigation.current;
    setOpening(true); setUrlError("");
    try {
      const targetSource = parsePttUrl(raw.trim()) ? "ptt" : parseV2exUrl(raw.trim()) ? "v2ex" : "5ch";
      if (!window.electron?.fiveRequest || !window.electron?.v2exRequest) throw new Error("URLからの閲覧は Electron アプリで利用できます。");
      const result = targetSource === "ptt" ? await window.electron.pttRequest({ kind: "resolve", url: raw.trim() }) : targetSource === "v2ex" ? await window.electron.v2exRequest({ kind: "resolve", url: raw.trim() }) : await window.electron.fiveRequest({ kind: "resolve", url: raw.trim() });
      if (generation !== navigation.current) return;
      if ("error" in result) throw new Error(result.error);
      if (!("board" in result)) throw new Error("移動先を確認できませんでした。");
      openTab(targetSource, result.board, result.thread === null ? null : String(result.thread));
      setMode("board");
    } catch (error) { if (generation === navigation.current) throw error; }
    finally { if (generation === navigation.current) setOpening(false); }
  };
  const openUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await navigateInternal(browseSource === "ptt" && validPttBoard(url.trim()) ? `https://www.ptt.cc/bbs/${url.trim()}/index.html` : url); }
    catch (error) { setUrlError(error instanceof Error ? error.message : "URLを開けませんでした。"); }
  };
  const renderedNavigation = navigation.current;
  return <PttAccess.Provider value={() => { navigation.current++; setOpening(false); setPttRevision(value => value + 1); }}><ThreadNavigation.Provider value={navigateInternal}><div className="app-shell">
    <header className="topbar panel-surface">
      <h1 className="topbar-title" title="RIFT（仮称）"><img className="app-icon" src="./icons/rift-48.png" width="24" height="24" alt="" aria-hidden="true" />RIFT</h1>
      <div className="topbar-meta">
        <nav aria-label="掲示板サイト" className="flex gap-2">{enabledSources.map(site => <button key={site} data-source={site} className={`ui-btn ${browseSource === site ? "ui-btn--active" : ""}`} aria-pressed={browseSource === site} onClick={() => changeSource(site)}>{sources[site].label}</button>)}</nav>
        {browseSource !== "4chan" && <form onSubmit={openUrl} className="url-bar"><input value={url} onChange={e => setUrl(e.target.value)} aria-label={browseSource === "ptt" ? "PTTの板名またはURL" : browseSource === "v2ex" ? "V2EXのURL" : "5chのURL"} placeholder={browseSource === "ptt" ? "PTTの板名（Soft_Job等）または記事URL" : browseSource === "v2ex" ? "V2EXのノード・トピックURL" : "5chの板・スレッドURL（旧 .net も対応）"} /><button className="ui-btn" disabled={opening || !url.trim()}>{opening ? "確認中…" : "URLを開く"}</button>{urlError && <span role="alert">{urlError}</span>}</form>}
        {browseSource === "ptt" && <button className="ui-btn" disabled={pttRevoking} onClick={async () => {
          setPttRevoking(true);
          try { const result = await window.electron.pttConsent({ kind: "revoke" }); if (result.error) setTabNotice(result.error); else { navigation.current++; setOpening(false); setPttRevision(n => n + 1); setTabNotice("PTTの年齢確認を解除しました。保存済み本文は別途削除できます。"); } }
          catch { setTabNotice("PTTの年齢確認を解除できませんでした。"); }
          finally { setPttRevoking(false); }
        }}>PTT年齢確認を解除</button>}
        <button className="ui-btn" onClick={() => setConnectionSettings(true)}>V2EX接続設定</button>
        <span className="chip meta">{savedDoc ? `保存 /${savedDoc.board}/` : board ? `/${board}/` : "No board"}</span>
        <span className="chip meta">{savedDoc ? `No.${savedDoc.thread}` : thread ? `No.${thread}` : "No thread"}</span>
        <button className="ui-btn" disabled={clearing} onClick={async () => {
          if (!window.confirm("全サイトのお気に入り・閲覧履歴・非表示設定・保存済み本文・タブを削除しますか？")) return;
          setClearing(true);
          try { await deleteSaved(); navigation.current++; clearLibrary(); clearTabs(); setSavedDoc(null); setTabs([]); setTabNotice(""); setBoard(null); setThread(null); setListBoard(null); }
          catch { setTabNotice("保存本文の消去に失敗しました。ほかの閲覧情報は消去していません。"); }
          finally { setClearing(false); }
        }}>閲覧データを消去</button>
      </div>
    </header>
    {tabs.length > 0 && <nav className="reader-tabs" aria-label="開いているタブ">{tabs.map(tab => {
      const active = source === tab.source && board === tab.board && thread === tab.thread;
      const title = tab.thread ? getLibrary(tab.source).metadata[tab.board + "/" + tab.thread]?.title : "";
      const label = tab.source + " /" + tab.board + (tab.thread ? " / " + tab.thread + (title ? " " + title : "") : " / 板一覧");
      return <span className={active ? "reader-tab reader-tab--active" : "reader-tab"} key={tabId(tab)}>
        <button className="ui-btn" aria-current={active ? "page" : undefined} title={label} onClick={() => activate(tab.source, tab.board, tab.thread)}>{label}</button>
        <button className="ui-btn" aria-label={label + " を閉じる"} onClick={() => closeTab(tab)}>×</button>
      </span>;
    })}</nav>}
    {tabNotice && <p className="reader-notice" role="status">{tabNotice}</p>}
    {(storageError || tabStorageError) && <p className="reader-notice" role="alert">{storageError || tabStorageError}</p>}
    {browseSource === "v2ex" && <p className="reader-notice">V2EX 試験対応 / 個人トークンが必要です。原文テキストのみ表示し、画像・翻訳は後続フェーズで対応します。API取得は約6秒間隔です。</p>}
    {browseSource === "ptt" && <p className="reader-notice">PTT 公開Web版 / 一覧は人気板です。板名の直接指定も可能です。原文とコメントを表示し、画像・翻訳は未対応。通信は約3秒間隔、年齢確認の同意は起動中だけ保持します。</p>}
    <main className="workspace-grid">
      <section className="workspace-pane"><LibrarySidebar key={browseSource + siteRevision(browseSource)} source={browseSource} selectedBoard={listBoard} mode={mode} onMode={next => { navigation.current++; setOpening(false); setMode(next); }} onBoard={chooseBoard} /></section>
      <section className="workspace-pane">{mode === "saved" ? <SavedThreadList onOpen={doc => { if (navigation.current === renderedNavigation) setSavedDoc(doc); }} onDelete={key => { if (!key || savedDoc?.key === key) setSavedDoc(null); }} /> : mode !== "board" ? <LibraryList key={mode} mode={mode} active={source + "/" + board + "/" + thread} onSelect={openTab} /> : listBoard ? <ThreadList key={browseSource + listBoard + siteRevision(browseSource)} source={browseSource} board={listBoard} onSelect={t => select(listBoard, t)} selectedThread={source === browseSource && board === listBoard ? thread : null} /> : <EmptyPane title="Select a Board" />}</section>
      <section className="workspace-pane">{savedDoc ? <SavedThreadView key={savedDoc.key + savedDoc.savedAt} doc={savedDoc} onClose={() => setSavedDoc(null)} /> : board && thread ? <ThreadView key={source + board + "/" + thread + ("/" + siteRevision(source))} source={source} board={board} threadId={thread} /> : <EmptyPane title="Select a Thread" />}</section>
    </main>
    {status && <footer className="status-bar panel-surface">
      <div className="flex items-center justify-between gap-4"><span className="meta">Save Status</span><span>{Math.round(progress)}%</span></div>
      <div className="mt-1 text-sm" role="status">{status}</div>
      {failed.length > 0 && <button className="ui-btn mt-2" disabled={busy} onClick={() => save(failed)}>失敗した {failed.length} 件だけ再試行</button>}
      <div className="progress-track mt-3"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
    </footer>}
    {connectionSettings && <V2exSettings onClose={() => setConnectionSettings(false)} onChanged={() => { navigation.current++; setOpening(false); setConnectionRevision(value => value + 1); }} />}
  </div></ThreadNavigation.Provider></PttAccess.Provider>;
};
