const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load } = require('./helpers/load-renderer.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const storage = () => {
  const disk = new Map();
  return { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value), removeItem: key => disk.delete(key) };
};

// In-memory TSX loader: no shared build output or browser/network is touched.
function uiLoader(globals = {}, hookOverrides = {}) {
  const cache = new Map();
  const hooks = { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: current => ({ current }), useEffect: () => {}, useMemo: fn => fn(),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(), ...hookOverrides };
  function read(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const localRequire = id => {
      if (id === 'react') return hooks;
      if (!id.startsWith('.')) return require(id);
      const target = path.resolve(path.dirname(file), id);
      return read(fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx');
    };
    vm.runInNewContext(code, { exports, require: localRequire, console, URL, TextEncoder, DOMException, ...globals }, { filename: file });
    return exports;
  }
  return read;
}

test('all seven source identities preserve existing validation and ASCII storage keys', () => {
  const source = load('src/lib/sources.ts');
  assert.deepEqual(plain(source.enabledSources), ['4chan', '5ch', 'v2ex', 'ptt', '2333chan', 'komica', 'lainchan']);
  for (const [site, board] of [['2333chan', 'TK'], ['komica', '00b'], ['lainchan', 'lambda']]) {
    assert.equal(source.isSource(site), true);
    assert.equal(source.validBoard(site, board), true);
    assert.equal(source.validThreadKey(site, board + '/123'), true);
    for (const bad of ['../x', 'a/b', '__proto__', 'constructor', 'a%2fb', 'λ']) assert.equal(source.validBoard(site, bad), false);
    for (const bad of ['0', '-1', '1e3', '../1', 'x', '99999999999999999']) assert.equal(source.normalizeThreadId(site, bad), null);
  }
  assert.equal(source.validBoard('5ch', 'a.b'), false);
  assert.equal(source.normalizeThreadId('5ch', '123'), null);
  assert.equal(source.normalizeThreadId('ptt', 'M.1789176238.A.A3E'), 'M.1789176238.A.A3E');
});

test('new sources roundtrip favorites, history, tabs and saved snapshots without migration changes', () => {
  const localStorage = storage();
  let lib = load('src/lib/library.ts', { localStorage });
  const tabs = load('src/lib/tabs.ts', { localStorage });
  const { validateSaved, normalizeSummary } = load('src/lib/savedThreads.ts', { TextEncoder });
  const entries = [['2333chan', 'ayu'], ['komica', '00b'], ['lainchan', 'lambda']];
  for (const [source, board] of entries) {
    const key = board + '/123';
    lib.toggleFavorite('boards', board, source);
    lib.toggleFavorite('threads', key, source, 'Saved title');
    lib.recordVisit(key, source);
    lib.rememberSelection(board, '123', source);
    const doc = validateSaved({ version: 2, source, board, thread: '123', title: 'Saved title', savedAt: 1000,
      posts: [{ no: 123, postId: '123', order: 1, name: '', date: '', id: '', com: 'Body' }] });
    assert.equal(doc.key, `${source}/${key}`);
    assert.equal(normalizeSummary({ ...doc, count: 1, bytes: 300 }).thread, '123');
  }
  lib = load('src/lib/library.ts', { localStorage });
  for (const [source, board] of entries) {
    assert.equal(lib.getLibrary(source).threads[0], board + '/123');
    assert.equal(lib.getLibrary(source).last.thread, '123');
    assert.ok(lib.getLibrary(source).history[board + '/123']);
  }
  assert.equal(tabs.saveTabs(entries.map(([source, board]) => ({ source, board, thread: '123' }))), true);
  assert.equal(tabs.loadTabs().length, 3);
});

test('manual and internal URL classification shares backend fixed hosts and Unicode aliases', () => {
  const { imageboardUrlSource } = load('src/lib/imageboardUrls.ts', { URL });
  for (const [url, source] of [
    ['https://x.1145141919810.org/ayu/res/123.html', '2333chan'],
    ['https://gaia.komica1.org/00b/pixmicat.php?res=123', 'komica'],
    ['https://www.lainchan.org/λ/res/123.html', 'lainchan'],
    ['https://lainchan.org/%CE%94/', 'lainchan'],
    ['https://www.lainchan.org/%CE%A9/catalog.html', 'lainchan'],
  ]) assert.equal(imageboardUrlSource(url), source);
  for (const url of ['https://evil.test/ayu/', 'https://x.998fun.com/ayu/', 'https://gaia.komica1.org.evil.test/00b/',
    'https://user@www.lainchan.org/λ/', 'http://www.lainchan.org/λ/', 'https://www.lainchan.org:444/λ/',
    'https://www.lainchan.org/not-allowed/', 'https://www.lainchan.org/λ/../sec/']) assert.equal(imageboardUrlSource(url), null);
});

test('providers preserve multiple attachments and cursors, with unsupported features disabled', async () => {
  const calls = [];
  const posts = [{ postId: '123', no: 123, order: 1, media: ['https://a.test/1.png', 'https://a.test/2.png'], mediaThumbs: { 'https://a.test/1.png': 'https://a.test/thumb/1.png' } }];
  const { providers } = load('src/lib/providers.ts', { DOMException, window: { electron: { imageboardRequest: async input => {
    calls.push(input);
    return input.kind === 'boards' ? { boards: [{ board: 'ayu', title: 'Ayu' }] } : input.kind === 'threads' ? { threads: [{ threadId: '123' }], nextCursor: '1' } : { posts };
  } } } });
  const signal = new AbortController().signal;
  for (const source of ['2333chan', 'komica']) {
    const board = source === 'komica' ? '00b' : 'ayu', p = providers[source];
    assert.equal((await p.boards(signal)).status, 'ready');
    assert.equal((await p.threads(board, signal, '1')).nextCursor, '1');
    assert.deepEqual(plain((await p.posts(board, '123', signal)).items), posts);
    for (const feature of ['archive', 'translation', 'references', 'postPages']) assert.equal(p.capabilities[feature], false);
    assert.equal(p.thumbnail(board, {}), null);
  }
  assert.equal(calls.filter(call => call.kind === 'posts').every(call => call.thread === '123'), true);
  const count = calls.length;
  await assert.rejects(providers.komica.posts('00b', '../1', signal));
  await assert.rejects(providers.komica.posts('00b', '123', signal, '1'));
  await assert.rejects(providers.komica.threads('../x', signal));
  await assert.rejects(providers.komica.threads('00b', signal, '1\nheader'));
  assert.equal(calls.length, count);
});

test('Lain consent fails closed and revocation discards queued text responses', async () => {
  const cache = new Map();
  let finish, requests = 0;
  const globals = { DOMException, window: { electron: {
    imageboardConsent: async ({ action }) => ({ accepted: action !== 'revoke' }),
    imageboardRequest: async () => { requests++; return new Promise(resolve => { finish = resolve; }); },
  } } };
  const access = load('src/lib/imageboardAccess.ts', globals, cache);
  const { providers } = load('src/lib/providers.ts', globals, cache);
  const signal = new AbortController().signal;
  await assert.rejects(providers.lainchan.boards(signal), error => error.status === 'age-confirmation-required');
  assert.equal(requests, 0);
  await access.changeImageboardConsent('accept');
  const pending = providers.lainchan.posts('lambda', '123', signal);
  await access.changeImageboardConsent('revoke');
  finish({ posts: [{ com: 'Never show this response' }] });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(access.getImageboardAccess().accepted, false);
});

test('late native acceptance cannot undo revoke, and native errors stay locked', async () => {
  let accept;
  const api = { imageboardConsent: ({ action }) => action === 'accept' ? new Promise(resolve => { accept = resolve; }) : Promise.resolve({ accepted: false }) };
  const access = load('src/lib/imageboardAccess.ts', { window: { electron: api } });
  const pending = access.changeImageboardConsent('accept');
  await access.changeImageboardConsent('revoke');
  accept({ accepted: true });
  assert.equal(await pending, false);
  assert.equal(access.getImageboardAccess().accepted, false);
  api.imageboardConsent = async () => ({ error: 'Native error' });
  await assert.rejects(access.changeImageboardConsent('accept'), /Native error/);
  assert.equal(access.getImageboardAccess().accepted, false);
});

test('gated/error and aborted IPC responses never become ready pages', async () => {
  let result = { error: 'Blocked', accessDenied: true }, finish;
  const api = { imageboardRequest: async () => result };
  const { providers } = load('src/lib/providers.ts', { DOMException, window: { electron: api } });
  const signal = new AbortController().signal;
  await assert.rejects(providers.komica.threads('00b', signal), error => error.status === 'unavailable');
  result = { status: 'age-confirmation-required', threads: [{ com: 'Hidden' }] };
  await assert.rejects(providers.komica.threads('00b', signal), error => error.status === 'age-confirmation-required');
  api.imageboardRequest = () => new Promise(resolve => { finish = resolve; });
  const controller = new AbortController();
  const pending = providers.komica.posts('00b', '123', controller.signal);
  controller.abort(); finish({ posts: [] });
  await assert.rejects(pending, { name: 'AbortError' });
});

test('gallery only accepts genuine allowed thumbnails, not full images or other sites', () => {
  const { imageboardThumbnail, IMAGEBOARD_SAVE_LIMIT } = load('src/lib/imageboardMedia.ts', { URL });
  const full = 'https://gita-pix.komica1.org/src/1792680000000.jpg';
  const thumb = 'https://gita-pix.komica1.org/thumb/1792680000000s.jpg';
  assert.equal(imageboardThumbnail('komica', full, { [full]: thumb }), thumb);
  assert.equal(imageboardThumbnail('komica', full), '');
  for (const bad of [full, 'https://evil.test/thumb/1792680000000s.jpg', 'https://www.lainchan.org/sec/thumb/1792680000000s.jpg']) {
    assert.equal(imageboardThumbnail('komica', full, { [full]: bad }), '');
  }
  assert.equal(IMAGEBOARD_SAVE_LIMIT, 100);
});

test('Lain saved bodies and library titles remain hidden before consent and after revoke', async () => {
  const read = uiLoader({ localStorage: storage(), window: { electron: { imageboardConsent: async ({ action }) => ({ accepted: action === 'accept' }) } } });
  const access = read('src/lib/imageboardAccess.ts');
  const library = read('src/lib/library.ts');
  const { LibraryList } = read('src/components/LibraryList.tsx');
  const { SavedThreadView } = read('src/components/SavedThreads.tsx');
  const doc = { source: 'lainchan', board: 'lambda', thread: '123', title: 'SECRET TITLE', savedAt: 1000,
    posts: [{ postId: '123', no: 123, name: 'SECRET AUTHOR', date: '', com: 'SECRET BODY' }] };
  library.toggleFavorite('threads', 'lambda/123', 'lainchan', doc.title);
  const render = () => renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(LibraryList, { mode: 'favorites', active: '', onSelect: () => {} }),
    React.createElement(SavedThreadView, { doc, onClose: () => {} })));
  assert.doesNotMatch(render(), /SECRET/);
  await access.changeImageboardConsent('accept');
  assert.match(render(), /SECRET TITLE/);
  assert.match(render(), /SECRET BODY/);
  await access.changeImageboardConsent('revoke');
  assert.doesNotMatch(render(), /SECRET/);
});

test('save provider enforces new-site batches and consent without restricting legacy saves', async () => {
  const calls = [];
  const read = uiLoader({ window: { electron: { saveImages: async items => {
    calls.push(items); return { status: 'complete', failedTargets: [], saved: items.length, total: items.length };
  } } } });
  const { SaveProvider } = read('src/components/SaveProvider.tsx');
  const { save } = SaveProvider({ children: null }).props.value;
  const items = source => Array.from({ length: 101 }, (_, i) => ({ source, url: `https://example.test/${i}.png` }));
  await save(items('komica'));
  await save(items('2333chan'));
  await save(items('lainchan').slice(0, 1));
  assert.equal(calls.length, 0);
  await save(items('komica').slice(0, 100));
  await save(items('5ch'));
  assert.deepEqual(calls.map(items => items.length), [100, 101]);
});

test('app exposes all sources while restored Lain tabs and board content stay gated', () => {
  const localStorage = storage();
  const read = uiLoader({ localStorage, window: {} });
  const library = read('src/lib/library.ts');
  library.toggleFavorite('threads', 'lambda/123', 'lainchan', 'SECRET TAB TITLE');
  library.rememberSelection('lambda', '123', 'lainchan');
  library.selectSource('lainchan');
  const { App } = read('src/App.tsx');
  const { SaveProvider } = read('src/components/SaveProvider.tsx');
  const html = renderToStaticMarkup(React.createElement(SaveProvider, null, React.createElement(App)));
  for (const source of ['4chan', '5ch', 'v2ex', 'ptt', '2333chan', 'komica', 'lainchan']) assert.match(html, new RegExp(`data-source="${source}"`));
  assert.doesNotMatch(html, /SECRET TAB TITLE/);
  assert.match(html, /18歳以上/);
  assert.match(html, /Lainchan同意を解除/);
  assert.match(html, /class="external-link" href="https:\/\/www\.lainchan\.org\/rules\.html"/);
  assert.match(html, /class="external-link" href="https:\/\/www\.lainchan\.org\/robots\.txt"/);
  assert.match(html, /自動巡回・自動更新・自動再試行は行いません/);
});

function remoteImageHarness(electron) {
  const state = [], created = [], revoked = [], ids = [];
  let cursor = 0, effect;
  class ImageURL extends URL {
    static createObjectURL() { const url = `blob:fixture-${created.length}`; created.push(url); return url; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  const read = uiLoader({ window: { electron }, Blob, URL: ImageURL, crypto: {
    randomUUID: () => { const id = require('node:crypto').randomUUID(); ids.push(id); return id; },
  } }, {
    useEffect: fn => { effect = fn; },
    useState: initial => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
  });
  const { RemoteImage } = read('src/components/RemoteImage.tsx');
  return { state, created, revoked, ids,
    render(url) { cursor = 0; return RemoteImage({ url, alt: 'fixture' }); },
    mount(url) { this.render(url); return effect(); },
  };
}

test('RemoteImage only routes policy-normalized new-site URLs through cancellable IPC', () => {
  const requests = [], legacy = [], cancelled = [];
  const h = remoteImageHarness({
    imageboardImage: request => { requests.push(request); return new Promise(() => {}); },
    fiveImage: url => { legacy.push(url); return new Promise(() => {}); },
    cancelImageboardImage: id => { cancelled.push(id); return Promise.resolve(); },
  });
  const urls = ['https://x.1145141919810.org/ayu/thumb/1792680000000s.jpg',
    'https://gita-pix.komica1.org/src/1792680000000.jpg',
    'https://lainchan.org/sec/thumb/1792680000000s.jpg'];
  for (const url of urls) h.mount(url)();
  assert.equal(requests.length, 3);
  assert.equal(requests[2].url, 'https://www.lainchan.org/sec/thumb/1792680000000s.jpg');
  assert.deepEqual(cancelled, requests.map(request => request.id));
  assert.equal(new Set(h.ids).size, 3);
  for (const id of h.ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const others = ['https://i.imgur.com/abc1234.jpg', 'https://i.ibb.co/abc1234/test.png',
    'https://gita-pix.komica1.org.evil.test/src/1792680000000.jpg',
    'https://gita-pix.komica1.org/src/1792680000000.jpg?tracking=1'];
  for (const url of others) h.mount(url)();
  assert.deepEqual(legacy, others);
  assert.equal(cancelled.length, 3);
  assert.equal(h.ids.length, 3);
});

test('RemoteImage cleanup cancels immediately and ignores late image bytes', async () => {
  let finish;
  const cancelled = [];
  const h = remoteImageHarness({
    imageboardImage: () => new Promise(resolve => { finish = resolve; }),
    cancelImageboardImage: id => { cancelled.push(id); return Promise.reject(new Error('Window closed')); },
  });
  const cleanup = h.mount('https://gita-pix.komica1.org/thumb/1792680000000s.jpg');
  cleanup();
  assert.deepEqual(cancelled, [h.ids[0]]);
  finish({ bytes: new Uint8Array([1]), mime: 'image/png' });
  await new Promise(setImmediate);
  assert.deepEqual(h.created, []);
  assert.equal(h.state[0], '');
  assert.equal(h.state[1], '');
});

test('RemoteImage manual retry uses a new UUID and cleanup releases displayed blobs', async () => {
  const requests = [], cancelled = [];
  const h = remoteImageHarness({
    imageboardImage: request => {
      requests.push(request);
      return Promise.resolve(requests.length === 1 ? { error: 'Retry manually' } : { bytes: new Uint8Array([1]), mime: 'image/png' });
    },
    cancelImageboardImage: id => { cancelled.push(id); return Promise.resolve(); },
  });
  const url = 'https://gita-pix.komica1.org/src/1792680000000.jpg';
  const firstCleanup = h.mount(url);
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  const errorView = h.render(url);
  errorView.props.children[1].props.onClick({ stopPropagation() {} });
  assert.equal(h.state[2], 1);
  firstCleanup();
  const secondCleanup = h.mount(url);
  await new Promise(setImmediate);
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].id, requests[1].id);
  assert.equal(h.created.length, 1);
  assert.equal(h.render(url).type, 'img');
  secondCleanup();
  assert.deepEqual(h.revoked, h.created);
  assert.deepEqual(cancelled, requests.map(request => request.id));
});
