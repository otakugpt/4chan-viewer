import React, { useEffect, useRef, useState } from "react";
import { deleteSaved, readSaved, refreshSaved, SavedThread, useSavedThreads } from "../lib/savedThreads";
import { UrlText } from "./UrlText";
import { LainAgeNotice } from "./ImageboardAccess";
import { getImageboardAccess, useImageboardAccess } from "../lib/imageboardAccess";
export function SavedThreadList({ onOpen, onDelete }: { onOpen: (doc: SavedThread) => void; onDelete: (key?: string) => void }) {
  const mounted = useRef(true);
  const access = useImageboardAccess();
  const { items, error } = useSavedThreads();
  const [query, setQuery] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const remove = async (key?: string) => {
    if (!window.confirm(key ? 'この保存済み本文を削除しますか？' : 'すべての保存済み本文を削除しますか？ お気に入り・履歴は残ります。')) return;
    setBusy(true); setNotice('');
    try { await deleteSaved(key); onDelete(key); } catch (e) { setNotice(e instanceof Error ? e.message : '削除できません。'); } finally { setBusy(false); }
  };
  useEffect(() => { mounted.current = true; void refreshSaved(); return () => { mounted.current = false; }; }, []);
  const visibleItems = items.map(item => item.source === "lainchan" && !access.accepted ? { ...item, title: "Lainchan / 年齢・利用条件の確認が必要です" } : item);
  return <section className="panel-surface pane-flex saved-thread-list"><div className="panel-header"><h2 className="panel-title">保存済みスレッド</h2><p className="library-hint">本文のみ・画像なし / {items.length}件（最大100件・50MiB）</p><input className="panel-search" aria-label="保存済み本文を検索" placeholder="タイトル・サイト・板名で検索" value={query} onChange={e => setQuery(e.target.value)} /><button className="ui-btn mt-2" disabled={busy || !items.length} onClick={() => remove()}>保存本文を全削除</button></div>
    {(error || notice) && <p className="error-state" role="alert">{notice || error}<button className="ui-btn" onClick={() => void refreshSaved()}>再試行</button></p>}
    {!access.accepted && items.some(item => item.source === "lainchan") && <LainAgeNotice />}
    <div className="list-scroll">{visibleItems.filter(item => `${item.title} ${item.source} ${item.board}`.toLowerCase().includes(query.toLowerCase())).map(item => <article className="saved-thread" key={item.key}><button className="saved-thread-open" disabled={busy || (item.source === "lainchan" && !access.accepted)} onClick={async () => { setNotice(''); setBusy(true); try { const revision = getImageboardAccess().revision; const doc = await readSaved(item.key); if (mounted.current && (doc.source !== "lainchan" || (getImageboardAccess().accepted && getImageboardAccess().revision === revision))) onOpen(doc); } catch (e) { setNotice(e instanceof Error ? e.message : '読み取れません。'); } finally { setBusy(false); } }}><strong>{item.title}</strong><span>{item.source} /{item.board}/ · {item.count}レス</span><small>保存 {new Date(item.savedAt).toLocaleString('ja-JP')}</small></button><div className="saved-thread-actions"><button className="ui-btn" disabled={busy} onClick={() => remove(item.key)}>保存本文を削除</button></div></article>)}{!items.length && <p className="empty-state">本文画面の「本文を保存」で追加できます。</p>}</div>
  </section>;
}
export function SavedThreadView({ doc, onClose }: { doc: SavedThread; onClose: () => void }) {
  const { accepted } = useImageboardAccess();
  if (doc.source === "lainchan" && !accepted) return <div className="panel-surface pane-flex"><LainAgeNotice /><button className="ui-btn" onClick={onClose}>通常の閲覧に戻る</button></div>;
  return <section className="panel-surface pane-flex offline-thread"><div className="panel-header"><h2 className="panel-title thread-heading">{doc.title}</h2><p className="library-hint">保存済み本文 / {doc.source} /{doc.board}/ · {new Date(doc.savedAt).toLocaleString('ja-JP')}</p><p className="library-hint">保存時点の本文です。画像取得・更新・翻訳は行いません。</p><button className="ui-btn" onClick={onClose}>通常の閲覧に戻る</button></div><div className="list-scroll">{doc.posts.map(post => <article className="post-card" key={post.postId}><strong>{post.name || 'Anonymous'}</strong><span className="meta"> · No.{post.no}</span><p className="library-hint">{post.date}{post.id && !post.date.includes('ID:' + post.id) ? ' ID:' + post.id : ''}</p><div className="post-body whitespace-pre-wrap"><UrlText text={post.com} /></div></article>)}</div></section>;
}
