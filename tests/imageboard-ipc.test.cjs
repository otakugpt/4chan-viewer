const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { load } = require('./helpers/load-main.cjs');

test('imageboard IPC guards native consent, raw media, source spoofing and bounded batches', async () => {
  const handlers = {}; let win, reads = 0, prompts = 0, allow = false, navigate = false;
  const electron = {
    app: { setAppUserModelId() {}, isPackaged: true, whenReady: () => Promise.resolve(), on() {} },
    BrowserWindow: class extends EventEmitter {
      constructor() { super(); win = this; this.webContents = new EventEmitter(); Object.assign(this.webContents, {
        id: 401, mainFrame: {}, setWindowOpenHandler() {}, isDestroyed: () => false, send() {},
      }); }
      async loadFile(file) { this.webContents.mainFrame.url = require('node:url').pathToFileURL(file).href; }
    },
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    dialog: { showMessageBox: async options => {
      prompts++; assert.equal(options.title, 'Lainchanの閲覧確認'); assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
      assert.match(options.detail, /robots.txt/); assert.match(options.detail, /保証/);
      if (navigate) win.webContents.mainFrame.url = 'https://evil.test/';
      return { response: allow ? 1 : 0 };
    }, showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  };
  const network = load('network');
  load('main', { electron, fs: { ...fs, existsSync: () => true }, './network': {
    ...network, serialQueue: () => fn => fn(), getBytes: async () => { reads++; throw new Error('Unexpected network'); },
  } });
  await Promise.resolve();
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const original = event.senderFrame.url;
  const image = 'https://www.lainchan.org/sec/src/1608846305810.png';
  const request = { source: 'lainchan', kind: 'threads', board: 'sec' };
  assert.ok((await handlers['imageboard-request']({ ...event, senderFrame: null }, request)).error);
  assert.ok((await handlers['imageboard-consent']({ ...event, senderFrame: null }, { action: 'accept' })).error);
  assert.equal(prompts, 0);
  assert.equal((await handlers['imageboard-request'](event, request)).status, 'age-confirmation-required');
  assert.ok((await handlers['five-image'](event, image)).error); assert.equal(reads, 0);
  assert.equal((await handlers['imageboard-consent'](event, { action: 'accept' })).accepted, false);
  allow = true; navigate = true;
  assert.equal((await handlers['imageboard-consent'](event, { action: 'accept' })).accepted, false);
  event.senderFrame.url = original; navigate = false;
  assert.equal((await handlers['imageboard-consent'](event, { action: 'accept' })).accepted, true);
  assert.equal((await handlers['imageboard-consent'](event, { action: 'revoke' })).accepted, false);
  assert.ok((await handlers['five-image'](event, image)).error); assert.equal(reads, 0);
  assert.equal((await handlers['save-images'](event, [{ source: 'ptt', url: image }])).status, 'error');
  assert.equal((await handlers['save-images'](event, [{ source: 'komica', url: image }])).status, 'error');
  assert.equal((await handlers['save-images'](event, Array.from({ length: 101 }, () => ({ source: 'lainchan', url: image })))).status, 'error');
  assert.equal(reads, 0);
});
