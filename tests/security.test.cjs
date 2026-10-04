const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');

function load(name, overrides = {}) {
  const filename = path.resolve(__dirname, '../electron', name + '.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const run = vm.runInThisContext('(function(require,module,exports,__dirname){' + source + '\n})', { filename });
  run(id => Object.hasOwn(overrides, id) ? overrides[id] : require(id), module, module.exports, path.dirname(filename));
  return module.exports;
}

const services = load('services');

test('download URL allowlist rejects credentials, foreign hosts and unexpected paths', () => {
  assert.equal(services.normalizeDownloadUrl('https://i.4cdn.org/g/123.jpg'), 'https://i.4cdn.org/g/123.jpg');
  for (const url of [null, {}, 'http://i.4cdn.org/g/123.jpg', 'https://i.4cdn.org.evil.test/g/123.jpg',
    'https://user:pass@i.4cdn.org/g/123.jpg', 'https://i.4cdn.org:444/g/123.jpg',
    'https://i.4cdn.org/g/123.jpg?q=x', 'https://i.4cdn.org/g/123.jpg#x',
    'https://i.4cdn.org/g/123.html', 'https://i.4cdn.org/g/../secret']) {
    assert.equal(services.normalizeDownloadUrl(url), null);
  }
});

test('trusted document accepts hash only, not another path, query or host', () => {
  const expected = 'file:///D:/app/dist/index.html';
  assert.equal(services.isTrustedDocument(expected + '#gallery', expected), true);
  for (const actual of ['file:///D:/app/dist/other.html', expected + '?x=1', 'https://evil.test', 'invalid']) {
    assert.equal(services.isTrustedDocument(actual, expected), false);
  }
  assert.equal(services.isTrustedDocument('http://localhost:5173/', 'http://localhost:5173/'), true);
  assert.equal(services.isTrustedDocument('http://localhost:5173.evil.test/', 'http://localhost:5173/'), false);
});

test('invalid translation requests never make a network request', async () => {
  const request = () => { throw new Error('must not be called'); };
  for (const value of [null, {}, '', '  ', 'x'.repeat(4001)]) {
    assert.ok((await services.translateText(value, 'test-placeholder', request)).error);
  }
  assert.match((await services.translateText('hello', undefined, request)).error, /not set/);
});

test('translation uses fixed HTTPS endpoint, server-side auth and redirect refusal', async () => {
  const result = await services.translateText(' hello ', ' test-placeholder ', async (url, options) => {
    assert.equal(url, 'https://api-free.deepl.com/v2/translate');
    assert.equal(options.headers.Authorization, 'DeepL-Auth-Key test-placeholder');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), { text: ['hello'], target_lang: 'JA' });
    return Response.json({ translations: [{ text: 'translated' }] });
  });
  assert.deepEqual(result, { translatedText: 'translated' });
});

test('upstream errors and malformed responses do not disclose credentials', async () => {
  for (const request of [
    async () => { throw new Error('test-placeholder private details'); },
    async () => new Response('test-placeholder', { status: 403 }),
    async () => new Response('test-placeholder', { status: 429 }),
    async () => new Response('test-placeholder', { status: 456 }),
    async () => new Response('invalid json'),
    async () => Response.json({ translations: [] }),
  ]) {
    const result = await services.translateText('hello', 'test-placeholder', request);
    assert.ok(result.error);
    assert.equal(JSON.stringify(result).includes('test-placeholder'), false);
  }
});

test('downloads preserve existing files, clean incomplete files and recover after errors', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '4chan-viewer-test-'));
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }); });
  const target = path.join(dir, 'image.jpg');
  const url = 'https://i.4cdn.org/g/123.jpg';
  global.fetch = async (_url, options) => {
    assert.equal(options.redirect, 'error');
    return new Response('image');
  };
  await services.downloadImage(url, target);
  assert.equal(fs.readFileSync(target, 'utf8'), 'image');
  await assert.rejects(services.downloadImage(url, target), /EEXIST/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'image');
  const broken = path.join(dir, 'broken.jpg');
  global.fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('interrupted body')); },
  }));
  await assert.rejects(services.downloadImage(url, broken), /interrupted/);
  assert.equal(fs.existsSync(broken), false);
  global.fetch = async () => new Response('recovered');
  await services.downloadImage(url, broken);
  assert.equal(fs.readFileSync(broken, 'utf8'), 'recovered');
});

test('main IPC checks window, document and main frame and serializes translations', async () => {
  const handlers = {};
  let win;
  let finish;
  let calls = 0;
  const electron = {
    app: { isPackaged: true, whenReady: () => Promise.resolve(), on() {} },
    BrowserWindow: class extends EventEmitter {
      constructor() {
        super(); win = this;
        this.webContents = new EventEmitter();
        Object.assign(this.webContents, { id: 1, mainFrame: {}, setWindowOpenHandler() {} });
      }
      async loadFile(file) { this.webContents.mainFrame.url = require('node:url').pathToFileURL(file).href; }
    },
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; }, on: (channel, fn) => { handlers[channel] = fn; } },
    dialog: { showOpenDialog() { throw new Error('untrusted save reached dialog'); } },
    shell: {},
  };
  load('main', { electron, fs: { ...fs, existsSync: () => true }, './services': { ...services, translateText: async () => {
    calls++;
    return new Promise(resolve => { finish = resolve; });
  } } });
  await Promise.resolve();
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const invoke = handlers['translate-text'];
  assert.match((await invoke({ ...event, senderFrame: null }, 'hello')).error, /Unauthorized/);
  assert.match((await invoke({ ...event, senderFrame: { url: event.senderFrame.url } }, 'hello')).error, /Unauthorized/);
  assert.match((await invoke({ ...event, sender: { id: 999 } }, 'hello')).error, /Unauthorized/);
  const actual = event.senderFrame.url;
  event.senderFrame.url = 'https://evil.test/';
  assert.match((await invoke(event, 'hello')).error, /Unauthorized/);
  await handlers['save-images'](event, [{ url: 'https://i.4cdn.org/g/123.jpg' }]);
  event.senderFrame.url = actual;
  await handlers['save-images'](event, [{ url: 'https://evil.test/image.jpg' }]);
  await handlers['save-images'](event, [{ url: 'https://i.4cdn.org/g/123.jpg', filename: '../123.jpg' }]);
  const pending = invoke(event, 'hello');
  assert.match((await invoke(event, 'hello')).error, /in progress/);
  assert.equal(calls, 1);
  finish({ translatedText: 'ok' });
  assert.deepEqual(await pending, { translatedText: 'ok' });
  const next = invoke(event, 'hello');
  finish({ translatedText: 'again' });
  await next;
  assert.equal(calls, 2);
  win.emit('closed');
  assert.match((await invoke(event, 'hello')).error, /Unauthorized/);
});

test('preload exposes scoped operations and never forwards Electron events', async () => {
  let api;
  const ipcRenderer = new EventEmitter();
  ipcRenderer.invoke = async (...args) => args;
  load('preload', { electron: { ipcRenderer, contextBridge: { exposeInMainWorld: (_key, value) => { api = value; } } } });
  assert.deepEqual(await api.translate('hello'), ['translate-text', 'hello']);
  assert.equal(api.invoke, undefined);
  assert.deepEqual(await api.saveImages([]), ['save-images', []]);
  for (const [method, channel] of [['onProgress', 'save-progress']]) {
    let args;
    const remove = api[method]((...values) => { args = values; });
    ipcRenderer.emit(channel, { sender: 'privileged' }, { total: 1 });
    assert.deepEqual(args, [{ total: 1 }]);
    remove();
    assert.equal(ipcRenderer.listenerCount(channel), 0);
  }
});

test('save IPC returns cancellation, prevents overlap, releases locks and identifies failed targets', async () => {
  const handlers = {};
  let win, resolveDialog;
  let mode = 'pending';
  const calls = [];
  const electron = {
    app: { isPackaged: true, whenReady: () => Promise.resolve(), on() {} },
    BrowserWindow: class extends EventEmitter {
      constructor() {
        super(); win = this; this.webContents = new EventEmitter();
        Object.assign(this.webContents, { id: 11, mainFrame: {}, setWindowOpenHandler() {}, isDestroyed: () => false, send() {} });
      }
      async loadFile(file) { this.webContents.mainFrame.url = require('node:url').pathToFileURL(file).href; }
    },
    ipcMain: { handle: (c, fn) => { handlers[c] = fn; } },
    dialog: { async showOpenDialog() {
      if (mode === 'pending') return new Promise(resolve => { resolveDialog = resolve; });
      if (mode === 'error') throw new Error('private filesystem details');
      return { canceled: false, filePaths: [os.tmpdir()] };
    } }, shell: {},
  };
  load('main', { electron, fs: { ...fs, existsSync: () => true, promises: { access: async () => { throw new Error('absent'); } } }, './services': {
    ...services, downloadImage: async url => { calls.push(url); if (url.endsWith('456.jpg')) throw new Error('network'); },
  } });
  await Promise.resolve();
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const save = handlers['save-images'];
  const good = { url: 'https://i.4cdn.org/g/123.jpg' }, bad = { url: 'https://i.4cdn.org/g/456.jpg' };
  const pending = save(event, [good]);
  assert.equal((await save(event, [good])).status, 'busy');
  resolveDialog({ canceled: true, filePaths: [] });
  assert.equal((await pending).status, 'cancelled');
  mode = 'error';
  const error = await save(event, [good]);
  assert.equal(error.status, 'error');
  assert.equal(error.error.includes('private'), false);
  mode = 'save';
  const result = await save(event, [good, bad]);
  assert.equal(result.status, 'complete');
  assert.equal(result.saved, 1);
  assert.deepEqual(result.failedTargets, [bad]);
  assert.equal(calls.length, 4);
});
