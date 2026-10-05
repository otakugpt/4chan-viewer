// Run after npm run build. The launcher hides the test window and isolates user data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), '4chan-viewer-smoke-'));
  const env = { ...process.env, NODE_ENV: 'production', DEEPL_API_KEY: 'test-placeholder', SMOKE_USER_DATA: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env, windowsHide: true, encoding: 'utf8', timeout: 90000,
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

const electron = require('electron');
const { app, session } = electron;
app.setPath('userData', process.env.SMOKE_USER_DATA);
app.disableHardwareAcceleration();
require('node:net').Server.prototype.listen = () => { throw new Error('Unexpected HTTP listener'); };
global.fetch = async (url, options) => {
  assert.equal(url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(options.headers.Authorization, 'DeepL-Auth-Key test-placeholder');
  return Response.json({ translations: [{ text: 'smoke translation' }] });
};
let fiveImageReads = 0;
const fivePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
let dialogCalls = 0;
let downloadCalls = 0;
let cancelSave = true;
const Module = require('node:module');
const originalLoad = Module._load;
class HiddenWindow extends electron.BrowserWindow {
  constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false } }); }
}
Module._load = function (name, ...args) {
  if (name === './network') return { ...originalLoad.call(this, name, ...args), getBytes: async url => {
    if (url === 'https://menu.5ch.io/bbsmenu.html') return { status: 200, headers: {}, body: Buffer.from('<a href="https://egg.5ch.io/software/">Software</a>') };
    if (url.endsWith('/software/subject.txt')) return { status: 200, headers: {}, body: Buffer.from('1608930977.dat<>RIFT fixture (3)\n') };
    if (url.endsWith('/software/dat/1608930977.dat')) return { status: 200, headers: {}, body: Buffer.from('Alice<><>2026 ID:ONE<>hello https://i.ibb.co/abc1234/fixture.png<>fixture\nBob<><>2026 ID:TWO<>&gt;&gt;1 second https://i.ibb.co/abc1234/fixture.png<>\nCarol<><>2026 ID:THREE<>last<>\n') };
    if (url === 'https://i.ibb.co/abc1234/fixture.png') { fiveImageReads++; return { status: 200, headers: { 'content-type': 'image/png' }, body: fivePng }; }
    throw new Error('Unexpected fixture URL');
  } };

  if (name === './services') return { ...originalLoad.call(this, name, ...args), downloadImage: async () => { downloadCalls++; if (downloadCalls <= 3) throw new Error('Fixture download failure'); } };
  return name === 'electron' ? { ...electron, BrowserWindow: HiddenWindow, dialog: { showOpenDialog: async () => { dialogCalls++; await new Promise(r => setTimeout(r, 100)); return { canceled: cancelSave, filePaths: cancelSave ? [] : [process.env.SMOKE_USER_DATA] }; } } } : originalLoad.call(this, name, ...args);
};
const timeout = setTimeout(() => { console.error('Smoke test timed out'); app.exit(1); }, 60000);
app.whenReady().then(() => {
  session.defaultSession.protocol.handle('https', async request => {
    const url = new URL(request.url);
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (url.hostname === 'a.4cdn.org') {
      if (url.pathname === '/boards.json') return new Response(JSON.stringify({ boards: [{ board: 'g', title: 'Technology' }, { board: 'a', title: 'Animation' }] }), { headers });
      const board = url.pathname.split('/')[1];
      const no = board === 'g' ? 100 : 200;
      if (url.pathname.endsWith('/catalog.json')) {
        await new Promise(r => setTimeout(r, board === 'g' ? 180 : 10));
        return new Response(JSON.stringify([{ threads: [{ no, sub: board + ' &amp; test', com: 'hello', tim: no }] }]), { headers });
      }
      if (url.pathname.endsWith('/archive.json')) return new Response('[]', { headers });
      return new Response(JSON.stringify({ posts: Array.from({ length: 16 }, (_, i) => ({ no: no + i, com: i === 0 ? 'hello' : 'A &amp; B<br>Read position fixture ' + i, tim: no + i, ext: '.jpg' })) }), { headers });
    }
    if (url.hostname === 'i.4cdn.org') return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#17394a"/><circle cx="320" cy="240" r="100" fill="#62ddff"/></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
    return new Response('', { status: 404 });
  });
  app.once('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      try {
        const result = await win.webContents.executeJavaScript(`(async () => ({
          rendered: document.getElementById('root').childElementCount > 0,
          isolated: typeof require === 'undefined' && typeof process === 'undefined',
          invalid: await window.electron.translate(''),
          translated: await window.electron.translate('hello')
        }))()`);
        assert.equal(result.rendered, true);
        assert.equal(result.isolated, true);
        assert.equal(result.invalid.error, 'Missing text');
        assert.deepEqual(result.translated, { translatedText: 'smoke translation' });
        const run = code => win.webContents.executeJavaScript(code);
        await run(`window.waitFor = async (test) => { const end = Date.now() + 8000; while (!test()) { if (Date.now() > end) throw new Error('UI wait timed out'); await new Promise(r => setTimeout(r, 25)); } }; true;`);
        await run(`(async () => {
          await waitFor(() => document.querySelectorAll('.board-item').length === 2);
          const board = name => [...document.querySelectorAll('.board-item')].find(b => b.textContent.includes('/' + name + '/'));
          board('g').click();
          await new Promise(r => setTimeout(r, 20));
          board('a').click();
          await waitFor(() => document.querySelector('.thread-card')?.textContent.includes('No.200'));
          await new Promise(r => setTimeout(r, 250));
          if (document.querySelector('.thread-card').textContent.includes('No.100')) throw new Error('Stale catalog');
          document.querySelector('.favorite-board').click();
          document.querySelector('.thread-card button').click();
          if (document.querySelector('.post-card')) throw new Error('Favorite selected thread');
          document.querySelector('.thread-card').click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 16);
          if (!document.querySelectorAll('.post-body')[1].textContent.includes('A & B')) throw new Error('Entity decoding');
          if (getComputedStyle(document.querySelector('.post-body')).marginTop !== '12px') throw new Error('Tailwind utility missing');
          document.querySelector('.post-image-link').click();
          await waitFor(() => document.querySelector('dialog[open]'));
          document.querySelector('dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
          await waitFor(() => document.querySelector('.viewer-toolbar').textContent.includes('2 / 16'));
        })()`);
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await run(`(async () => {
          await waitFor(() => !document.querySelector('dialog'));
          document.querySelector('.post-card .translate-block button').click();
          await waitFor(() => document.querySelector('.post-card .translate-result'));
          document.querySelector('.post-card .translate-block button').click();
          await waitFor(() => !document.querySelector('.post-card .translate-result'));
          document.querySelector('.post-card .ui-btn--primary').click();
          document.querySelector('.post-card .ui-btn--primary').click();
          await waitFor(() => document.querySelector('.status-bar')?.textContent.includes('キャンセル'));
          const pane = document.querySelector('.post-card').parentElement;
          pane.scrollTop = 900;
          pane.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 350));
          const data = JSON.parse(localStorage.getItem('rift.library.v2')).sites['4chan'];
          if (data.reads['a/200'].scroll < 800 || !data.threads.includes('a/200')) throw new Error('Reading persistence');
        })()`);
        assert.equal(dialogCalls, 1);
        cancelSave = false;
        await run(`(async () => {
          document.querySelector('.post-card .ui-btn--primary').click();
          await waitFor(() => document.querySelector('.status-bar button')?.textContent.includes('1 件だけ再試行'));
          document.querySelector('.status-bar button').click();
          await waitFor(() => document.querySelector('.status-bar')?.textContent.includes('1/1 件成功'));
          if (document.querySelector('.status-bar button')) throw new Error('Retry list not cleared');
        })()`);
        assert.equal(dialogCalls, 3);
        assert.equal(downloadCalls, 4);
        const outputDir = path.resolve(__dirname, '../.test-artifacts');
        fs.mkdirSync(outputDir, { recursive: true });
        win.setSize(1401, 901);
        await new Promise(r => setTimeout(r, 100));
        win.setSize(1400, 900);
        await new Promise(r => setTimeout(r, 250));
        fs.writeFileSync(path.join(outputDir, 'desktop.png'), (await win.webContents.capturePage()).toPNG());
        win.setSize(390, 844);
        await new Promise(r => setTimeout(r, 200));
        assert.equal(await run('document.documentElement.scrollWidth <= window.innerWidth'), true);
        fs.writeFileSync(path.join(outputDir, 'mobile.png'), (await win.webContents.capturePage()).toPNG());
        await run('document.querySelector(".post-card").scrollIntoView()');
        await new Promise(r => setTimeout(r, 200));
        fs.writeFileSync(path.join(outputDir, 'mobile-thread.png'), (await win.webContents.capturePage()).toPNG());
        win.setSize(1400, 900);
        await run(`(async () => {
          const pane = document.querySelector('.post-card').parentElement;
          pane.scrollTop = 900; pane.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 350));
        })()`);
        await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload(); });
        await run(`(async () => {
          const end = Date.now() + 8000;
          while (!document.querySelector('.post-card')) { if (Date.now() > end) throw new Error('Resume timeout'); await new Promise(r => setTimeout(r, 25)); }
          await new Promise(r => setTimeout(r, 300));
          if (!document.querySelector('.favorite-strip').textContent.includes('a/200')) throw new Error('Favorite not restored');
          if (document.querySelector('.post-card').parentElement.scrollTop < 500) throw new Error('Position not restored');
          window.confirm = () => true;
          [...document.querySelectorAll('button')].find(b => b.textContent.includes('閲覧データを消去')).click();
          await new Promise(r => setTimeout(r, 100));
          const cleared = JSON.parse(localStorage.getItem('rift.library.v2')).sites['4chan'];
          if (Object.keys(cleared.reads).length || cleared.threads.length) throw new Error('History deletion failed');
        })()`);
        await run(`window.waitFor = async (test) => { const end = Date.now() + 12000; while (!test()) { if (Date.now() > end) throw new Error('5ch UI wait timed out'); await new Promise(r => setTimeout(r, 25)); } }; true;`);
        await run(`(async () => {
          document.querySelector('[data-source="5ch"]').click();
          await waitFor(() => document.querySelector('.board-item')?.textContent.includes('software'));
          document.querySelector('.board-item').click();
          await waitFor(() => document.querySelector('.thread-card')?.textContent.includes('RIFT fixture'));
          document.querySelector('.thread-card').click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 3);
          if (document.querySelector('.post-card img')) throw new Error('Automatic remote image request');
          if (!document.querySelector('.reply-anchor')) throw new Error('Missing reference');
          document.querySelector('.reply-anchor').click();
          await waitFor(() => document.querySelector('.reply-preview')?.textContent.includes('hello'));
          [...document.querySelectorAll('.panel-header button')].find(b => b.textContent === 'Gallery').click();
          await waitFor(() => document.querySelectorAll('.gallery-card').length === 1);
          if (document.querySelector('.gallery-card img')) throw new Error('Remote image before consent');
        })()`);
        assert.equal(fiveImageReads, 0);
        await run(`(async () => {
          document.querySelector('.image-consent button').click();
          await waitFor(() => document.querySelector('.gallery-card img'));
          const img = document.querySelector('.gallery-card img');
          if (!img.src.startsWith('blob:')) throw new Error('Remote URL exposed to image element');
          document.querySelector('.gallery-meta .ui-btn').click();
          await waitFor(() => document.querySelector('.status-bar')?.textContent.includes('1/1 件成功'));
        })()`);
        // Wait for the real safe-image writer, rather than the previous save message.
        await new Promise(r => setTimeout(r, 1200));
        const savedImages = fs.readdirSync(process.env.SMOKE_USER_DATA).filter(name => /^[a-f0-9]{24}\.png$/.test(name));
        assert.equal(savedImages.length, 1);
        assert.deepEqual(fs.readFileSync(path.join(process.env.SMOKE_USER_DATA, savedImages[0])), fivePng);
        win.setSize(1401, 901); await new Promise(r => setTimeout(r, 100)); win.setSize(1400, 900); await new Promise(r => setTimeout(r, 200));
        fs.writeFileSync(path.join(outputDir, 'rift-5ch.png'), (await win.webContents.capturePage()).toPNG());
        assert.equal(await run("document.querySelector('.topbar').getBoundingClientRect().height <= 64"), true);
        win.setSize(390, 844); await new Promise(r => setTimeout(r, 200));
        assert.equal(await run('document.documentElement.scrollWidth <= window.innerWidth'), true);
        fs.writeFileSync(path.join(outputDir, 'rift-5ch-mobile.png'), (await win.webContents.capturePage()).toPNG());
        win.setSize(1400, 900); await new Promise(r => setTimeout(r, 200));
        await run(`(async () => {
          [...document.querySelectorAll('.panel-header button')].find(b => b.textContent === 'Thread').click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 3);
          [...document.querySelectorAll('.post-card button')].find(b => b.textContent === 'IDを非表示').click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 2);
          const opened = await window.electron.fiveRequest({ kind: 'resolve', url: 'https://egg.5ch.net/test/read.cgi/software/1608930977/l50' });
          if (opened.thread !== 1608930977) throw new Error('URL import failed');
          document.querySelector('[data-source="4chan"]').click();
          await waitFor(() => document.querySelectorAll('.board-item').length === 2);
          document.querySelector('[data-source="5ch"]').click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 2);
          if (!document.querySelector('.image-consent button').textContent.includes('読み込む')) throw new Error('Consent leaked across threads');
        })()`);
        await run(`(async () => {
          const initial = document.querySelectorAll('.reader-tab').length;
          document.querySelector('.thread-card').click();
          await new Promise(r => setTimeout(r, 100));
          if (document.querySelectorAll('.reader-tab').length !== initial) throw new Error('Duplicate tab');
          document.querySelector('[data-source="4chan"]').click();
          await waitFor(() => document.querySelectorAll('.board-item').length === 2);
          [...document.querySelectorAll('.board-item')].find(b => b.textContent.includes('/a/')).click();
          await waitFor(() => document.querySelector('.thread-card')?.textContent.includes('No.200'));
          document.querySelector('.thread-card').click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 16);
          const pane = document.querySelector('.post-card').parentElement;
          pane.scrollTop = 900; pane.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 350));
          [...document.querySelectorAll('.reader-tab > button:first-child')].find(b => b.textContent.includes('1608930977')).click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 2);
          [...document.querySelectorAll('.reader-tab > button:first-child')].find(b => b.textContent.includes('/ 200')).click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 16);
          await new Promise(r => setTimeout(r, 100));
          if (document.querySelector('.post-card').parentElement.scrollTop < 500) throw new Error('Tab position lost');
        })()`);
        const tabCount = await run("document.querySelectorAll('.reader-tab').length");
        await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload(); });
        await run(`(async () => {
          const end = Date.now() + 12000;
          while (document.querySelectorAll('.post-card').length !== 16) { if (Date.now() > end) throw new Error('Tab restore timed out'); await new Promise(r => setTimeout(r, 25)); }
          if (document.querySelectorAll('.reader-tab').length !== ${tabCount}) throw new Error('Tabs not restored');
          const count = document.querySelectorAll('.reader-tab').length;
          document.querySelector('.reader-tab--active button:last-child').click();
          await new Promise(r => setTimeout(r, 100));
          if (document.querySelectorAll('.reader-tab').length !== count - 1) throw new Error('Tab not closed');
          window.confirm = () => true;
          [...document.querySelectorAll('button')].find(b => b.textContent.includes('閲覧データを消去')).click();
          await new Promise(r => setTimeout(r, 100));
          if (document.querySelector('.reader-tab') || JSON.parse(localStorage.getItem('rift.tabs.v1')).tabs.length) throw new Error('Tab history not cleared');
        })()`);
        console.log('PASS: 4chan regression + RIFT 5ch boards/threads/posts, references, image consent/dedup/blob preview/safe save, ID filters, URL import and site isolation');
        clearTimeout(timeout);
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  });
  require('../dist-electron/main.js');
}).catch(error => { console.error(error); app.exit(1); });
