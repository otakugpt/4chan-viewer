import React, { useMemo, useState } from "react";
import { boardName, deleteHistory, setHistoryEnabled, toggleFavorite, useLibraries } from "../lib/library";
export function LibraryList({ mode, onSelect, active }: { mode: 'favorites' | 'history'; onSelect: (source: BoardSource, board: string, thread: number) => void; active: string }) {
  const data = useLibraries();
  const [query, setQuery] = useState('');
  const [site, setSite] = useState<BoardSource | 'all'>('all');
  const [sort, setSort] = useState('recent');
  const rows = useMemo(() => (['4chan', '5ch'] as BoardSource[]).flatMap(source => {
    const library = data.sites[source];
    return (mode === 'favorites' ? library.threads : Object.keys(library.history)).map((key, order) => {
      const [board, id] = key.split('/');
      return { source, key, board, thread: Number(id), title: library.metadata[key]?.title || `/${board}/ No.${id}`, boardName: boardName(source, board),
        visited: library.history[key] ?? 0, added: library.metadata[key]?.added ?? 0, order, favorite: library.threads.includes(key), reading: library.reads[key] };
    });
  }).filter(row => (site === 'all' || row.source === site) && `${row.title} ${row.boardName} ${row.board} ${row.thread}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => (mode === 'favorites' && sort === 'added' ? b.added - a.added : b.visited - a.visited) || a.order - b.order), [data, mode, query, site, sort]);
  const dayLabel = (timestamp: number) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    return timestamp >= today.getTime() ? '今日' : timestamp >= yesterday.getTime() ? '昨日' : 'それ以前';
  };
  return <section className="panel-surface pane-flex library-list" aria-label={mode === 'favorites' ? 'お気に入りスレッド一覧' : '閲覧履歴一覧'}>
    <div className="panel-header">
      <div className="flex justify-between items-center gap-2"><h2 className="panel-title">{mode === 'favorites' ? 'お気に入りスレッド' : '閲覧履歴'}</h2><span className="meta">{rows.length}</span></div>
      <input className="panel-search" aria-label="保存スレッドを検索" placeholder="タイトル・板名で検索" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="library-list-tools">
        <select aria-label="保存スレッドのサイト" value={site} onChange={e => setSite(e.target.value as typeof site)}><option value="all">すべてのサイト</option><option value="4chan">4chan</option><option value="5ch">5ch</option></select>
        {mode === 'favorites' && <select aria-label="お気に入りの並び順" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">最近読んだ順</option><option value="added">登録順</option></select>}
      </div>
      {mode === 'history' && <details className="history-options"><summary>履歴の設定・消去</summary>
        <label><input type="checkbox" checked={data.historyEnabled} onChange={e => setHistoryEnabled(e.target.checked)} />閲覧履歴・位置を記録する</label>
        <p className="library-hint">オフにしても既存の履歴、お気に入り、開いているタブは残ります。</p>
        <button className="ui-btn" onClick={() => { if (window.confirm('全サイトの閲覧履歴・閲覧位置を消去しますか？ お気に入りとタブは残ります。')) deleteHistory(); }}>履歴だけ全消去</button>
      </details>}
      {mode === 'history' && !data.historyEnabled && <p className="library-hint" role="status">履歴の記録を停止しています</p>}
    </div>
    <div className="list-scroll">
      {!rows.length && <p className="empty-state">{query || site !== 'all' ? '条件に一致するスレッドはありません。' : mode === 'favorites' ? 'スレッドの「お気に入り」で登録できます。' : '本文を開いたスレッドがここに並びます。'}</p>}
      {rows.map((row, index) => <React.Fragment key={row.source + '/' + row.key}>
        {mode === 'history' && (index === 0 || dayLabel(rows[index - 1].visited) !== dayLabel(row.visited)) && <h3 className="history-day">{dayLabel(row.visited)}</h3>}
        <article className={`saved-thread ${active === row.source + '/' + row.key ? 'is-active' : ''}`}>
          <button className="saved-thread-open" onClick={() => onSelect(row.source, row.board, row.thread)}><strong>{row.title}</strong><span>{row.source} / {row.boardName}</span><small>{row.visited ? '最終閲覧 ' + new Date(row.visited).toLocaleString('ja-JP') : 'まだ閲覧記録がありません'}</small></button>
          <div className="saved-thread-actions">
            <button className="ui-btn" onClick={() => onSelect(row.source, row.board, row.thread)}>{row.reading ? '続きから' : '開く'}</button>
            <button className="ui-btn" aria-pressed={row.favorite} onClick={() => toggleFavorite('threads', row.key, row.source, row.title)}>{row.favorite ? 'お気に入り解除' : 'お気に入り'}</button>
            {mode === 'history' && <button className="ui-btn" aria-label={row.title + ' を履歴から削除'} onClick={() => deleteHistory(row.source, row.key)}>履歴削除</button>}
          </div>
        </article>
      </React.Fragment>)}
    </div>
  </section>;
}
