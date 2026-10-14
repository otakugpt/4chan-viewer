const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-renderer.cjs');
test('reading data validates storage, bounds favorites and supports deletion', () => {
  let stored;
  const lib = load('src/lib/library.ts', { localStorage: { getItem: () => stored ?? null, setItem: (_key, value) => { stored = value; } } });
  assert.equal(lib.getLibrary().boards.length, 0);
  lib.toggleFavorite('boards', 'g');
  lib.toggleFavorite('boards', '../bad');
  lib.toggleFavorite('threads', 'g/123');
  lib.rememberSelection('g', 123);
  lib.recordVisit('g/123', '4chan');
  lib.rememberReading('g/123', 125, 800);
  lib.rememberReading('g/123', 124, 200);
  assert.equal(lib.getLibrary().reads['g/123'].post, 125);
  const restored = lib.parseLibrary(JSON.stringify(JSON.parse(stored).sites["4chan"]));
  assert.equal(restored.last.thread, '123');
  assert.equal(restored.boards.length, 1);
  assert.equal(restored.reads['g/123'].scroll, 200);
  const epoch = lib.getClearEpoch();
  lib.clearLibrary();
  assert.equal(lib.getLibrary().threads.length, 0);
  assert.equal(lib.getClearEpoch(), epoch + 1);
  const bad = lib.parseLibrary(JSON.stringify({ version: 1, boards: ['../../bad'], last: { board: '../', thread: 2 }, reads: { 'g/1': { post: -1, scroll: 0, updated: 1 } } }));
  assert.equal(bad.last, null);
  assert.equal(Object.keys(bad.reads).length, 0);
});
test('translation shares in-flight requests, caches successes and retries errors', async () => {
  let calls = 0;
  let fail = false;
  const lib = load('src/lib/translation.ts', { window: { electron: { translate: async () => {
    calls++;
    return fail ? { error: 'HTTP 456' } : { translatedText: 'translated' };
  } } } });
  const a = lib.translateCached(' hello '), b = lib.translateCached('hello');
  assert.equal(a, b);
  assert.equal(await a, 'translated');
  await lib.translateCached('hello');
  assert.equal(calls, 1);
  fail = true;
  await assert.rejects(lib.translateCached('other'), /利用上限/);
  fail = false;
  assert.equal(await lib.translateCached('other'), 'translated');
  assert.equal(calls, 3);
  assert.match(lib.translationError('DEEPL_API_KEY is not set'), /未設定/);
  assert.match(lib.translationError('HTTP 403'), /APIキー/);
});

test('legacy 4chan library migrates without collisions and clearing removes legacy data', () => {
  const disk = new Map([['4chan-viewer.library.v1', JSON.stringify({ version: 1, boards: ['g'], threads: ['g/100'], reads: {}, last: { board: 'g', thread: 100 } })]]);
  const lib = load('src/lib/library.ts', { localStorage: { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value), removeItem: key => disk.delete(key) } });
  assert.equal(lib.getLibrary('4chan').last.thread, '100');
  assert.equal(lib.getLibrary('5ch').last, null);
  lib.toggleFavorite('threads', 'g/1608930977', '5ch');
  lib.recordVisit('g/1608930977', '5ch');
  lib.rememberReading('g/1608930977', 7, 100, '5ch');
  lib.selectSource('5ch');
  assert.equal(lib.getLibrary('4chan').reads['g/100'], undefined);
  assert.equal(JSON.parse(disk.get('rift.library.v3')).sites['4chan'].threads[0], 'g/100');
  assert.equal(lib.getSource(), '5ch');
  lib.clearLibrary();
  assert.equal(disk.has('4chan-viewer.library.v1'), false);
  assert.equal(lib.getLibrary('5ch').threads.length, 0);
});


test('tabs validate stored destinations, deduplicate, cap count and tolerate unavailable storage', () => {
  const tabs = load('src/lib/tabs.ts');
  assert.equal(tabs.parseTabs('{broken').length, 0);
  const input = { version: 1, tabs: [
    { source: '4chan', board: 'g', thread: 123 },
    { source: '4chan', board: 'g', thread: 123 },
    { source: '5ch', board: 'software', thread: 1608930977 },
    { source: '5ch', board: '../bad', thread: null },
    { source: 'other', board: 'g', thread: null },
    { source: '5ch', board: 'software', thread: 2 },
  ] };
  assert.equal(tabs.parseTabs(JSON.stringify(input)).length, 2);
  input.tabs = Array.from({ length: 30 }, (_, i) => ({ source: '4chan', board: 'g', thread: i + 1 }));
  assert.equal(tabs.parseTabs(JSON.stringify(input)).length, 20);
  assert.equal(tabs.loadTabs().length, 0);
  assert.doesNotThrow(() => tabs.saveTabs([]));
});

test('library migration keeps favorites and promotes old reading timestamps to history only once', () => {
  const disk = new Map([['rift.library.v2', JSON.stringify({ version: 2, currentSource: '4chan', sites: { '4chan': { version: 1, boards: ['g'], threads: ['g/123'], reads: { 'g/123': { post: 3, scroll: 240, updated: 1000 } } } } })]]);
  const storage = { getItem: k => disk.get(k) ?? null, setItem: (k, v) => disk.set(k, v), removeItem: k => disk.delete(k) };
  let lib = load('src/lib/library.ts', { localStorage: storage });
  assert.equal(lib.getLibrary().history['g/123'], 1000);
  lib.rememberTitles([{ threadId: '123', sub: 'Saved title' }], 'g', '4chan');
  lib.deleteHistory('4chan', 'g/123');
  lib.rememberReading('g/123', 5, 300);
  lib = load('src/lib/library.ts', { localStorage: storage });
  assert.equal(lib.getLibrary().history['g/123'], undefined);
  assert.equal(lib.getLibrary().reads['g/123'], undefined);
  assert.equal(lib.getLibrary().metadata['g/123'].title, 'Saved title');
  assert.equal(lib.getLibrary().threads[0], 'g/123');
});

test('visits are bounded, separate from scrolling, and pause/deletion reject stale requests', () => {
  let now = 1000;
  const lib = load('src/lib/library.ts', { Date: { now: () => now }, localStorage: { getItem: () => null, setItem: () => {} } });
  lib.recordVisit('g/1', '4chan', 'First');
  const visited = lib.getLibrary().history['g/1'];
  now++;
  lib.rememberReading('g/1', 2, 100);
  assert.equal(lib.getLibrary().history['g/1'], visited);
  lib.toggleFavorite('threads', 'g/1');
  for (let i = 2; i <= 502; i++) { now++; lib.recordVisit('g/' + i, '4chan', 'Title ' + i); }
  assert.equal(Object.keys(lib.getLibrary().history).length, 500);
  assert.equal(lib.getLibrary().history['g/1'], undefined);
  assert.equal(lib.getLibrary().metadata['g/1'].title, 'First');
  const unaffected = lib.getHistoryEpoch('4chan', 'g/502');
  const removed = lib.getHistoryEpoch('4chan', 'g/501');
  lib.deleteHistory('4chan', 'g/501');
  assert.equal(lib.getHistoryEpoch('4chan', 'g/502'), unaffected);
  lib.recordVisit('g/501', '4chan', 'Stale deleted visit', removed);
  assert.equal(lib.getLibrary().history['g/501'], undefined);
  const epoch = lib.getHistoryEpoch();
  lib.deleteHistory();
  lib.recordVisit('g/503', '4chan', 'Stale', epoch);
  assert.equal(Object.keys(lib.getLibrary().history).length, 0);
  lib.setHistoryEnabled(false);
  lib.recordVisit('g/504', '4chan', 'Paused');
  assert.equal(lib.getLibrary().metadata['g/504'], undefined);
  lib.rememberReading('g/504', 5, 200);
  assert.equal(lib.getLibrary().reads['g/504'], undefined);
  lib.setHistoryEnabled(true);
  lib.recordVisit('g/504', '4chan', 'Resumed');
  assert.equal(lib.getLibrary().metadata['g/504'].title, 'Resumed');
});

test('favorite board order spans both sites and title metadata is bounded and text-only', () => {
  const lib = load('src/lib/library.ts', { localStorage: { getItem: () => null, setItem: () => {} } });
  lib.toggleFavorite('boards', 'g', '4chan');
  lib.toggleFavorite('boards', 'software', '5ch');
  lib.moveBoard('5ch/software', -1);
  assert.equal(lib.favoriteBoards()[0], '5ch/software');
  lib.rememberBoards([{ board: 'software', title: '<b>Software</b>' }], '5ch');
  assert.equal(lib.getLibrary('5ch').boardNames.software, 'Software');
  lib.toggleFavorite('threads', 'software/1608930977', '5ch', '<script>bad</script>' + 'x'.repeat(400));
  assert.equal(lib.getLibrary('5ch').metadata['software/1608930977'].title.length, 300);
  assert.equal(lib.getLibrary('5ch').metadata['software/1608930977'].title.includes('<'), false);
});

test('saved thread validation bounds data and keeps only approved text fields', () => {
  const { validateSaved } = load('src/lib/savedThreads.ts', { TextEncoder });
  const doc = { key: 'untrusted', source: '5ch', board: 'software', thread: 1608930977, title: 'title', savedAt: 1, secret: 'discard', posts: [{ no: 1, name: 'name', date: '', id: '', com: 'body', media: ['https://example.test/image.jpg'] }] };
  const value = validateSaved(doc);
  assert.equal(value.key, '5ch/software/1608930977');
  assert.equal(value.secret, undefined);
  assert.equal(value.posts[0].media, undefined);
  for (const invalid of [null, { ...doc, source: 'evil' }, { ...doc, board: '../bad' }, { ...doc, thread: 1 }, { ...doc, savedAt: NaN }, { ...doc, posts: [] }, { ...doc, posts: [doc.posts[0], doc.posts[0]] }, { ...doc, title: 'x'.repeat(301) }, { ...doc, posts: [{ ...doc.posts[0], com: 'x'.repeat(8 * 1024 * 1024) }] }]) assert.throws(() => validateSaved(invalid));
});
