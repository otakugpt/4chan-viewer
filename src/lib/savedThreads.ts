import { useSyncExternalStore } from "react";
import { isSource, normalizeThreadId, validBoard, validPostId } from "./sources";
export type SavedPost = { postId: PostId; order: number; no: number; name: string; date: string; id: string; com: string };
export type SavedThread = { version: 2; key: string; source: BoardSource; board: string; thread: ThreadId; title: string; savedAt: number; posts: SavedPost[] };
export type SavedSummary = Omit<SavedThread, 'posts'> & { count: number; bytes: number };
const MAX_ONE = 8 * 1024 * 1024, MAX_TOTAL = 50 * 1024 * 1024;
export function validateSaved(input: unknown): SavedThread {
  const value = input as SavedThread;
  if (!value || !isSource(value.source) || !validBoard(value.source, value.board) || !normalizeThreadId(value.source, value.thread) || (value.version !== undefined && value.version !== 2) || (value.version === undefined && !['4chan', '5ch'].includes(value.source)) || !Array.isArray(value.posts) || !value.posts.length || value.posts.length > 10000) throw new Error('保存データの形式が不正です。');
  const text = (s: unknown, max: number) => { if (typeof s !== 'string' || s.length > max) throw new Error('保存するテキストが大きすぎます。'); return s; };
  const seen = new Set<string>(), orders = new Set<number>();
  const result: SavedThread = { version: 2, key: `${value.source}/${value.board}/${value.thread}`, source: value.source, board: value.board, thread: normalizeThreadId(value.source, value.thread)!, title: text(value.title, 300), savedAt: value.savedAt,
    posts: value.posts.map((p, index) => {
      if (!p || !Number.isSafeInteger(p.no) || p.no <= 0) throw new Error('投稿番号が不正です。');
      const postId = value.version === 2 ? p.postId : String(p.no);
      const order = value.version === 2 ? p.order : index + 1;
      if (!validPostId(postId) || seen.has(postId) || !Number.isSafeInteger(order) || order <= 0 || orders.has(order)) throw new Error('投稿識別子が不正です。');
      seen.add(postId); orders.add(order);
      return { postId, order, no: p.no, name: text(p.name, 4096), date: text(p.date, 4096), id: text(p.id, 1024), com: text(p.com, MAX_ONE) };
    }) };
  const sizeChecked = value.version === 2 ? result : { key: result.key, source: result.source, board: result.board, thread: Number(result.thread), title: result.title, savedAt: result.savedAt, posts: result.posts.map(({ postId: _postId, order: _order, ...post }) => post) };
  if (!Number.isFinite(result.savedAt) || result.savedAt <= 0 || new TextEncoder().encode(JSON.stringify(sizeChecked)).length > MAX_ONE) throw new Error('本文保存は1スレッド8MiBまでです。');
  return result;
}
let database: Promise<IDBDatabase> | undefined;
function db() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('rift.saved-threads.v1', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('threads', { keyPath: 'key' }); request.result.createObjectStore('summaries', { keyPath: 'key' }); };
    request.onerror = () => reject(new Error('本文保存領域を開けません。'));
    request.onblocked = () => reject(new Error('他のRIFTウィンドウを閉じて再試行してください。'));
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
  }).catch(error => { database = undefined; throw error; });
  return database;
}
let state: { items: SavedSummary[]; error: string } = { items: [], error: '' };
const listeners = new Set<() => void>();
function emit(items: SavedSummary[], error = '') { state = { items, error }; listeners.forEach(fn => fn()); }
export const useSavedThreads = () => useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state);
export async function refreshSaved() {
  try {
    const database = await db();
    const items = await new Promise<SavedSummary[]>((resolve, reject) => {
      const request = database.transaction('summaries').objectStore('summaries').getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('保存一覧を読み取れません。'));
    });
    emit(items.map(normalizeSummary).sort((a, b) => b.savedAt - a.savedAt));
  } catch (error) { emit(state.items, error instanceof Error ? error.message : '保存領域を開けません。'); }
}
export function normalizeSummary(value: SavedSummary): SavedSummary {
  if (!value || !isSource(value.source) || !validBoard(value.source, value.board) || !normalizeThreadId(value.source, value.thread) || (value.version !== undefined && value.version !== 2) || !Number.isFinite(value.savedAt) || value.savedAt <= 0 || !Number.isSafeInteger(value.count) || value.count <= 0 || value.count > 10000 || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || typeof value.title !== 'string' || value.title.length > 300) throw new Error('保存一覧の形式が不正です。');
  const thread = normalizeThreadId(value.source, value.thread)!;
  const key = `${value.source}/${value.board}/${thread}`;
  if (key !== value.key) throw new Error('保存一覧の識別子が不正です。');
  return { version: 2, key, source: value.source, board: value.board, thread, title: value.title, savedAt: value.savedAt, count: value.count, bytes: value.bytes };
}
export async function saveThread(input: SavedThread) {
  const doc = validateSaved(input), { posts, ...info } = doc;
  const bytes = new TextEncoder().encode(JSON.stringify(doc)).length;
  if (bytes > MAX_ONE) throw new Error('本文保存は1スレッド8MiBまでです。');
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['threads', 'summaries'], 'readwrite');
    let reason = '本文を保存できません。空き容量を確認してください。';
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(new Error(reason)); tx.onerror = () => {};
    const list = tx.objectStore('summaries').getAll();
    list.onsuccess = () => {
      const others = (list.result as SavedSummary[]).filter(item => item.key !== doc.key);
      if (others.length >= 100 || others.reduce((sum, item) => sum + item.bytes, 0) + bytes > MAX_TOTAL) { reason = '保存上限（100件／合計50MiB）です。不要な保存済み本文を削除してください。'; tx.abort(); return; }
      tx.objectStore('threads').put(doc); tx.objectStore('summaries').put({ ...info, count: posts.length, bytes });
    };
  });
  await refreshSaved();
}
export async function readSaved(key: string) {
  const database = await db();
  const value = await new Promise<unknown>((resolve, reject) => {
    const request = database.transaction('threads').objectStore('threads').get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('保存本文を読み取れません。'));
  });
  if (!value) throw new Error('保存本文がありません。');
  const result = validateSaved(value);
  if (result.key !== key) throw new Error('保存本文の識別子が一致しません。');
  return result;
}
export async function deleteSaved(key?: string) {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['threads', 'summaries'], 'readwrite');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(new Error('保存本文を削除できません。')); tx.onerror = () => {};
    for (const store of ['threads', 'summaries']) { if (key) tx.objectStore(store).delete(key); else tx.objectStore(store).clear(); }
  });
  await refreshSaved();
}
