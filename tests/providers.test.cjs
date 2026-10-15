const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-renderer.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
function storage(entries = []) {
  const disk = new Map(entries);
  return { disk, getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value), removeItem: key => disk.delete(key) };
}
const pttId = 'M.1789176238.A.A3E';
const oldSite = { version: 2, boards: ['g'], threads: ['g/123'], history: { 'g/123': 1000 }, reads: { 'g/123': { post: 125, scroll: 600, updated: 1001 } }, metadata: { 'g/123': { title: 'Keep me', added: 900 } }, last: { board: 'g', thread: 123 } };
const oldLibrary = JSON.stringify({ version: 2, currentSource: '4chan', sites: { '4chan': oldSite }, historyEnabled: false, boardOrder: ['4chan/g'] });

test('source registry exposes the four implemented providers', () => {
  const { enabledSources, SOURCE_IDS } = load('src/lib/sources.ts');
  assert.deepEqual(plain(enabledSources), ['4chan', '5ch', 'v2ex', 'ptt']);
  assert.deepEqual(plain(SOURCE_IDS), ['4chan', '5ch', 'v2ex', 'ptt']);
});

test('identities support PTT filenames without loosening existing site validation', () => {
  const { normalizeThreadId: id, validBoard, validPostId, validThreadKey } = load('src/lib/sources.ts');
  assert.equal(id('4chan', 123), '123');
  assert.equal(id('5ch', '1608930977'), '1608930977');
  assert.equal(id('ptt', pttId), pttId);
  assert.equal(id('v2ex', '123'), '123');
  for (const value of [0, -1, 1.2, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, null, '001', '1e3', '1/2', '../123', '1?x=y']) assert.equal(id('4chan', value), null);
  assert.equal(id('5ch', '123'), null);
  for (const value of [1789176238, pttId + '.html', pttId + '/..', 'https://www.ptt.cc/' + pttId]) assert.equal(id('ptt', value), null);
  assert.equal(validBoard('ptt', 'C_Chat'), true);
  assert.equal(validBoard('ptt', 'twbbs.org'), true);
  assert.equal(validBoard('v2ex', 'machine-learning'), true);
  assert.equal(validBoard('5ch', 'twbbs.org'), false);
  for (const value of ['../x', 'a/b', '__proto__', 'constructor', 'a?x', 'a%2fb']) assert.equal(validBoard('ptt', value), false);
  assert.equal(validPostId('comment:42'), true);
  assert.equal(validPostId('a" onclick="evil'), false);
  assert.equal(validThreadKey('ptt', 'Soft_Job/' + pttId), true);
});

test('library migration preserves the legacy bytes and normalizes selected thread IDs', () => {
  const localStorage = storage([['rift.library.v2', oldLibrary]]);
  let lib = load('src/lib/library.ts', { localStorage });
  assert.equal(lib.getLibrary().last.thread, '123');
  assert.equal(lib.getLibrary().reads['g/123'].postId, null);
  assert.equal(lib.getLibrary().metadata['g/123'].title, 'Keep me');
  lib.rememberSelection('g', '123');
  assert.equal(localStorage.disk.get('rift.library.v2'), oldLibrary);
  const modern = JSON.parse(localStorage.disk.get(lib.LIBRARY_KEY));
  assert.equal(modern.version, 3);
  assert.equal(modern.historyEnabled, false);
  assert.deepEqual(modern.boardOrder, ['4chan/g']);
  lib = load('src/lib/library.ts', { localStorage });
  assert.equal(lib.getLibrary().last.thread, '123');
  assert.equal(lib.getLibrary().reads['g/123'].scroll, 600);
  assert.equal(lib.getLibrary().threads[0], 'g/123');
});

test('library migration failure never removes legacy data and can retry next launch', () => {
  const localStorage = storage([['rift.library.v2', oldLibrary]]);
  const write = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('quota'); };
  let lib = load('src/lib/library.ts', { localStorage });
  lib.rememberSelection('g', '124');
  assert.equal(localStorage.disk.get('rift.library.v2'), oldLibrary);
  assert.equal(localStorage.disk.has(lib.LIBRARY_KEY), false);
  localStorage.setItem = write;
  lib = load('src/lib/library.ts', { localStorage });
  assert.equal(lib.getLibrary().last.thread, '123');
  lib.rememberSelection('g', '125');
  assert.equal(JSON.parse(localStorage.disk.get(lib.LIBRARY_KEY)).sites['4chan'].last.thread, '125');
});

test('corrupt and future storage are protected instead of overwritten on startup', () => {
  for (const raw of ['{broken', JSON.stringify({ version: 99, sites: {} }), JSON.stringify({ version: 3, sites: { '4chan': { version: 99 } } })]) {
    const localStorage = storage([['rift.library.v3', raw], ['rift.library.v2', oldLibrary]]);
    const lib = load('src/lib/library.ts', { localStorage });
    lib.rememberBoards([{ board: 'g', title: 'Technology' }], '4chan');
    assert.equal(localStorage.disk.get('rift.library.v3'), raw);
    assert.equal(localStorage.disk.get('rift.library.v2'), oldLibrary);
    lib.clearLibrary();
    assert.equal(JSON.parse(localStorage.disk.get('rift.library.v3')).sites['4chan'].threads.length, 0);
    assert.equal(localStorage.disk.has('rift.library.v2'), false);
  }
});

test('all source libraries retain strings, isolate entries and clear disabled sites too', () => {
  const localStorage = storage();
  let lib = load('src/lib/library.ts', { localStorage });
  lib.toggleFavorite('boards', 'Soft_Job', 'ptt');
  lib.toggleFavorite('threads', 'Soft_Job/' + pttId, 'ptt', 'PTT fixture');
  lib.recordVisit('Soft_Job/' + pttId, 'ptt');
  lib.rememberReading('Soft_Job/' + pttId, 9, 300, 'ptt', { postId: 'comment:17', order: 9 });
  lib.rememberSelection('Soft_Job', pttId, 'ptt');
  lib.selectSource('ptt');
  assert.equal(lib.getSource(), 'ptt');
  lib.toggleFavorite('threads', 'python/123', 'v2ex');
  lib.toggleFavorite('threads', 'python/123', '4chan');
  lib.deleteHistory('ptt');
  lib = load('src/lib/library.ts', { localStorage });
  assert.equal(lib.getLibrary('ptt').last.thread, pttId);
  assert.equal(lib.getLibrary('ptt').threads.length, 1);
  assert.equal(Object.keys(lib.getLibrary('ptt').history).length, 0);
  assert.equal(lib.getLibrary('v2ex').threads[0], 'python/123');
  lib.clearLibrary();
  assert.equal(lib.getLibrary('ptt').threads.length, 0);
  assert.equal(lib.getLibrary('v2ex').threads.length, 0);
});

test('tab migration deduplicates numeric/string IDs and preserves old storage until clear', () => {
  const old = JSON.stringify({ version: 1, tabs: [{ source: '4chan', board: 'g', thread: 123 }] });
  const localStorage = storage([['rift.tabs.v1', old]]);
  const tabs = load('src/lib/tabs.ts', { localStorage });
  const migrated = tabs.loadTabs();
  assert.equal(migrated[0].thread, '123');
  assert.equal(tabs.saveTabs(migrated), true);
  assert.equal(localStorage.disk.get('rift.tabs.v1'), old);
  const parsed = tabs.parseTabs(JSON.stringify({ version: 2, tabs: [...migrated, { ...migrated[0], thread: 123 }, { source: 'ptt', board: 'Soft_Job', thread: pttId }] }));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].thread, pttId);
  tabs.clearTabs();
  assert.equal(localStorage.disk.has('rift.tabs.v1'), false);
});

test('tab migration protects malformed data and write failures preserve the legacy copy', () => {
  for (const raw of ['{broken', '{"version":99,"tabs":[]}']) {
    const localStorage = storage([['rift.tabs.v2', raw]]);
    const tabs = load('src/lib/tabs.ts', { localStorage });
    assert.equal(tabs.loadTabs().length, 0);
    assert.equal(tabs.saveTabs([]), false);
    assert.equal(localStorage.disk.get('rift.tabs.v2'), raw);
    assert.equal(tabs.clearTabs(), true);
  }
  const old = '{"version":1,"tabs":[{"source":"4chan","board":"g","thread":123}]}';
  const localStorage = storage([['rift.tabs.v1', old]]);
  localStorage.setItem = () => { throw new Error('quota'); };
  const tabs = load('src/lib/tabs.ts', { localStorage });
  assert.equal(tabs.saveTabs(tabs.loadTabs()), false);
  assert.equal(localStorage.disk.get('rift.tabs.v1'), old);
});

test('old snapshots normalize in memory without mutating the original object', () => {
  const { validateSaved, normalizeSummary } = load('src/lib/savedThreads.ts', { TextEncoder });
  const old = { key: '4chan/g/123', source: '4chan', board: 'g', thread: 123, title: 'Old snapshot', savedAt: 1000, posts: [{ no: 125, name: '', date: '', id: 'AUTHOR', com: 'hello' }] };
  const before = JSON.stringify(old);
  const doc = validateSaved(old);
  assert.equal(doc.version, 2);
  assert.equal(doc.thread, '123');
  assert.equal(doc.posts[0].postId, '125');
  assert.equal(doc.posts[0].id, 'AUTHOR');
  assert.equal(doc.posts[0].order, 1);
  assert.equal(JSON.stringify(old), before);
  const summary = normalizeSummary({ ...old, count: 1, bytes: 300 });
  assert.equal(summary.key, old.key);
  assert.equal(summary.thread, '123');
  assert.throws(() => normalizeSummary({ ...summary, key: '4chan/g/999' }));
});

test('new snapshots separate display numbers from post IDs and reject invalid identifiers', () => {
  const { validateSaved } = load('src/lib/savedThreads.ts', { TextEncoder });
  const post = { postId: 'comment:1', order: 1, no: 1, name: '', date: '', id: '', com: 'hello' };
  const doc = { version: 2, key: '', source: 'ptt', board: 'Soft_Job', thread: pttId, title: 'PTT', savedAt: 1000, posts: [post, { ...post, postId: 'comment:2', order: 2 }] };
  assert.equal(validateSaved(doc).posts.length, 2);
  assert.equal(validateSaved(doc).key, 'ptt/Soft_Job/' + pttId);
  for (const bad of [{ ...doc, version: 3 }, { ...doc, version: undefined }, { ...doc, thread: 123 }, { ...doc, posts: [post, post] }, { ...doc, posts: [{ ...post, postId: '../x' }] }, { ...doc, posts: [{ ...post, order: 0 }] }]) assert.throws(() => validateSaved(bad));
});

test('near-limit legacy snapshots remain readable despite normalization overhead', () => {
  const { validateSaved } = load('src/lib/savedThreads.ts', { TextEncoder });
  const doc = { key: '4chan/g/123', source: '4chan', board: 'g', thread: 123, title: 'Legacy', savedAt: 1000, posts: [{ no: 123, name: '', date: '', id: '', com: '' }] };
  doc.posts[0].com = 'x'.repeat(8 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(doc)));
  assert.equal(Buffer.byteLength(JSON.stringify(doc)), 8 * 1024 * 1024);
  assert.equal(validateSaved(doc).posts[0].com.length, doc.posts[0].com.length);
});

test('read boundary uses stable post IDs rather than display numbers or lexical ordering', () => {
  const { readBoundary } = load('src/lib/reading.ts');
  const posts = [{ postId: 'z', order: 1, no: 100 }, { postId: 'a', order: 2, no: 1 }, { postId: 'b', order: 3, no: 50 }];
  assert.equal(readBoundary(posts, { postId: 'a', post: 1, order: 2 }), 1);
  assert.equal(readBoundary(posts, { postId: 'deleted', post: 999, order: 2 }), -1);
  assert.equal(readBoundary([{ postId: '100', no: 100 }, { postId: '101', no: 101 }], { postId: null, post: 100 }), 0);
  assert.equal(readBoundary([{ postId: '100', no: 100 }, { postId: '101', no: 101 }, { postId: '50', no: 50 }], { postId: null, post: 100 }), 0);
});

test('page results never expose gated content through the ready-page accessor', () => {
  const { readyPage, requireReadyPage, mergePage } = load('src/lib/pages.ts');
  assert.equal(requireReadyPage(readyPage([1], 'page-2')).nextCursor, 'page-2');
  for (const status of ['age-confirmation-required', 'unavailable']) {
    assert.throws(() => requireReadyPage({ status, items: [{ secret: 'blocked' }], nextCursor: null }));
  }
  assert.throws(() => requireReadyPage({ status: 'ready', items: {}, nextCursor: null }));
  assert.throws(() => requireReadyPage(readyPage([], 'x\nheader')));
  const merged = mergePage([{ id: '1', text: 'old' }, { id: '2' }], [{ id: '1', text: 'new' }, { id: '3' }], item => item.id);
  assert.deepEqual(plain(merged), [{ id: '1', text: 'new' }, { id: '2' }, { id: '3' }]);
});

test('adapters validate destinations before requesting', async () => {
  let requests = 0;
  const signal = new AbortController().signal;
  const { providers } = load('src/lib/providers.ts', { DOMException, location: { protocol: 'file:' }, fetch: async () => { requests++; throw new Error('unexpected'); }, window: { electron: { fiveRequest: async () => { requests++; throw new Error('unexpected'); } } } });
  await assert.rejects(providers.ptt.threads('../x', signal));
  await assert.rejects(providers.ptt.posts('Soft_Job', '123', signal));
  await assert.rejects(providers['4chan'].threads('../x', signal));
  await assert.rejects(providers['4chan'].posts('g', '../x', signal));
  await assert.rejects(providers['5ch'].posts('software', '123', signal));
  await assert.rejects(providers['4chan'].posts('g', '123', signal, 'page-2'));
  assert.equal(requests, 0);
});

test('4chan and 5ch adapters normalize IDs only at the provider boundary', async () => {
  const signal = new AbortController().signal;
  const calls = [];
  const { providers, normalizePosts } = load('src/lib/providers.ts', { DOMException, location: { protocol: 'file:' }, fetch: async url => ({ ok: true, json: async () => url.endsWith('/catalog.json') ? [{ threads: [{ no: 123, sub: 'test' }] }] : url.endsWith('/archive.json') ? [100, 99] : { posts: [{ no: 123, id: 'AUTHOR' }, { no: 124 }] } }), window: { electron: { fiveRequest: async request => { calls.push(request); return { posts: [{ no: 1, id: 'AUTHOR' }] }; } } } });
  assert.equal((await providers['4chan'].threads('g', signal)).items[0].threadId, '123');
  const posts = (await providers['4chan'].posts('g', '123', signal)).items;
  assert.equal(posts[0].postId, '123');
  assert.equal(posts[0].id, 'AUTHOR');
  assert.equal(posts[1].order, 2);
  assert.deepEqual(plain(await providers['4chan'].archive('g', signal)), ['100', '99']);
  await providers['5ch'].posts('software', '1608930977', signal);
  assert.equal(calls[0].thread, 1608930977);
  assert.throws(() => normalizePosts([{ no: 1 }, { no: 1 }]));
});

test('PTT adapter blocks gated content and discards a cancelled IPC response', async () => {
  let finish;
  const { providers } = load('src/lib/providers.ts', { DOMException, window: { electron: { pttRequest: async request => request.kind === 'threads' ? { status: 'age-confirmation-required', threads: [{ sub: 'do not expose' }] } : new Promise(resolve => { finish = resolve; }) } } });
  await assert.rejects(providers.ptt.threads('Beauty', new AbortController().signal), error => error.status === 'age-confirmation-required');
  const controller = new AbortController(), result = providers.ptt.posts('Soft_Job', pttId, controller.signal);
  controller.abort(); finish({ posts: [] });
  await assert.rejects(result, { name: 'AbortError' });
});
