// Run after npm run build. The launcher hides the test window and isolates user data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), '4chan-viewer-smoke-'));
  const env = { ...process.env, NODE_ENV: 'production', DEEPL_API_KEY: 'test-placeholder', SMOKE_USER_DATA: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env, windowsHide: true, encoding: 'utf8', timeout: 120000,
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
const translatedTexts = [];
global.fetch = async (url, options) => {
  assert.equal(url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(options.headers.Authorization, 'DeepL-Auth-Key test-placeholder');
  assert.equal(options.headers.Cookie, undefined);
  translatedTexts.push(JSON.parse(options.body).text[0]);
  return Response.json({ translations: [{ text: 'smoke translation' }] });
};
let fiveImageReads = 0;
let networkReads = 0;
let publicReplyReads = 0;
let externalPrompts = 0, allowExternal = false;
let pttPrompts = 0, allowPtt = false;
let lainPrompts = 0, allowLain = false;
const imageboardReads = [], imageboardImageReads = [], unexpectedNetwork = [];
const cancellableImageUrl = 'https://x.1145141919810.org/ayu/src/1792677185722.png';
let delayedImageStarted = 0, delayedImageAborted = 0, releaseDelayedImage;
let largeImageSize = 0, largeImagePrompts = 0, allowLargeImage = false, largeImageReads = 0;
const pttCookies = [], pttFixture = require('./helpers/ptt-fixtures.cjs');
const externalOpened = [];
const fivePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
const imageboardFixtures = {
  '2333chan': { board: 'ayu', thread: '123', title: '2333chan smoke fixture', body: '2333chan synthetic body',
    list: 'https://x.1145141919810.org/ayu/catalog.json', url: 'https://x.1145141919810.org/ayu/res/123.html',
    image: 'https://x.1145141919810.org/ayu/src/1792677185721.png', thumb: 'https://x.1145141919810.org/ayu/thumb/1792677185721.png' },
  komica: { board: '00b', thread: '123', title: 'Komica smoke fixture', body: 'Komica synthetic body',
    list: 'https://gaia.komica1.org/00b/index.htm', url: 'https://gaia.komica1.org/00b/pixmicat.php?res=123',
    image: 'https://gita-pix.komica1.org/src/1792677185721.png', thumb: 'https://gita-pix.komica1.org/thumb/1792677185721s.png' },
  lainchan: { board: 'lambda', thread: '123', title: 'Lain smoke fixture', body: 'Lain synthetic body',
    list: 'https://www.lainchan.org/%CE%BB/catalog.json', url: 'https://www.lainchan.org/%CE%BB/res/123.html',
    image: 'https://www.lainchan.org/%CE%BB/src/1792677185721.png', thumb: 'https://www.lainchan.org/%CE%BB/thumb/1792677185721.png' },
};
function imageboardFixture(url, headers) {
  const source = Object.keys(imageboardFixtures).find(source => {
    const f = imageboardFixtures[source];
    return url === f.list || url === f.url || url === f.url.replace(/\.html$/, '.json') || url === f.image || url === f.thumb;
  });
  if (!source) return null;
  assert.equal(headers.Authorization, undefined, 'Imageboards must not receive API credentials');
  assert.equal(headers.Cookie, undefined, 'Imageboards must not receive age/session cookies');
  const f = imageboardFixtures[source];
  if (url === f.image || url === f.thumb) {
    imageboardImageReads.push(url);
    return { status: 200, headers: { 'content-type': 'image/png' }, body: fivePng };
  }
  imageboardReads.push(url);
  if (source === 'komica') {
    const html = `<div id="threads"><div class="thread" data-no="123"><div class="post threadpost" data-no="123" id="r123"><span class="title">${f.title}</span><span class="name">Synthetic author</span><span class="now">2026/10/23</span><a href="pixmicat.php?res=123">Reply</a><div class="quote">${f.body} &amp; safe text</div><div class="file-text"><a href="${f.image}"><img src="${f.thumb}" alt="fixture"></a></div></div><div class="post reply" data-no="124" id="r124"><div class="quote">Synthetic reply</div></div></div></div>`;
    return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(html) };
  }
  const op = { no: 123, resto: 0, sub: f.title, com: `<p>${f.body} &amp; safe text</p>`, name: 'Synthetic author', time: 1792677185, replies: 1, tim: 1792677185721, ext: '.png', tn_w: 1, tn_h: 1, thumb_ext: '.png' };
  const json = url === f.list ? [{ page: 1, threads: [op] }] : { posts: [op, { no: 124, resto: 123, com: 'Synthetic reply', time: 1792677186 }] };
  return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(json)) };
}
let dialogCalls = 0;
let downloadCalls = 0;
const downloadedUrls = [];
let cancelSave = true;
const Module = require('node:module');
const originalLoad = Module._load;
class HiddenWindow extends electron.BrowserWindow {
  constructor(options) { assert.ok(fs.existsSync(options.icon)); assert.equal(electron.nativeImage.createFromPath(options.icon).isEmpty(), false); super({ ...options, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false } }); }
}
Module._load = function (name, ...args) {
  // Fixture requests have no rate impact. Production still uses the 6.1-second queue.
  if (name === './v2ex') { const real = originalLoad.call(this, name, ...args); return { ...real, createV2exService: snapshot => real.createV2exService(snapshot, { spacing: 0 }) }; }
  if (name === './ptt') { const real = originalLoad.call(this, name, ...args); return { ...real, createPttService: () => real.createPttService({ spacing: 0 }) }; }
  if (name === './imageboards') { const real = originalLoad.call(this, name, ...args); return { ...real, createImageboardService: () => real.createImageboardService({ spacing: 0 }) }; }
  if (name === './network') return { ...originalLoad.call(this, name, ...args), getBytes: async (url, limit, headers = {}, signal) => {
    networkReads++;
    if (url === cancellableImageUrl) {
      assert.deepEqual(headers, {});
      delayedImageStarted++;
      assert.ok(signal && typeof signal.addEventListener === 'function', 'Cancellable IPC must supply a transport AbortSignal');
      return new Promise((resolve, reject) => {
        const abort = () => { delayedImageAborted++; signal.removeEventListener('abort', abort); reject(new Error('Synthetic image request aborted')); };
        releaseDelayedImage = () => { signal.removeEventListener('abort', abort); resolve({ status: 200, headers: { 'content-type': 'image/png' }, body: fivePng }); };
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      });
    }
    const fixture = imageboardFixture(url, headers);
    if (fixture) return fixture;
    if (url.startsWith('https://www.ptt.cc/')) {
      assert.equal(headers.Authorization, undefined); pttCookies.push(headers.Cookie);
      if (url.endsWith('/bbs/index.html')) return pttFixture.response(pttFixture.boards);
      const board = url.includes('/Beauty/') ? 'Beauty' : 'Soft_Job';
      const gate = board === 'Beauty' ? pttFixture.gate : '';
      if (url.endsWith('/index.html')) return pttFixture.response(gate + pttFixture.listing(board, '12', board === 'Beauty' ? 'Restricted fixture' : 'PTT fixture'));
      if (url.endsWith('/index12.html')) return pttFixture.response(gate + pttFixture.listing(board, null, 'Older PTT fixture').replaceAll(pttFixture.id, 'M.1789176237.A.A3E'));
      if (url.endsWith('/M.1789176237.A.A3E.html')) return pttFixture.response(pttFixture.article(board));
      if (url.endsWith('/' + pttFixture.id + '.html')) return pttFixture.response(gate + pttFixture.article(board).replace('fixture signature', 'fixture signature <a href="https://i.urusai.cc/RiftTest.png">image</a>'));
      throw new Error('Unexpected PTT fixture URL');
    }
    if (url.startsWith('https://www.v2ex.com/')) {
      const node = { name: 'python', title: 'Python fixture' };
      const publicFixture = require('./helpers/v2ex-public-fixtures.cjs');
      if (url.endsWith('/api/nodes/all.json')) { assert.deepEqual(headers, {}); return publicFixture.response([node]); }
      if (url.endsWith('/feed/python.json')) { assert.deepEqual(headers, {}); return publicFixture.response(publicFixture.feed('python', [publicFixture.item(321)])); }
      if (url.endsWith('/api/replies/show.json?topic_id=321')) { assert.deepEqual(headers, {}); publicReplyReads++; return publicFixture.response([{ ...publicFixture.replies[0], topic_id: 321 }]); }
      assert.equal(headers.Authorization, 'Bearer fixture-not-a-real-credential');
      assert.equal(limit, 2 * 1024 * 1024);
      let result;
      const topic = { id: 123, node, title: '中文 AI fixture', content: 'code <div> & 中文 [next](https://www.v2ex.com/t/124) ![image](https://i.ibb.co/abc1234/fixture.png)', member: { username: 'Alice' }, created: 1760000000, replies: 2 };
      const reply = id => ({ id, content: '中文 reply ' + id + (id === 124 ? '長'.repeat(4001) : ''), member: { username: 'Bob' }, created: 1760000001 });
      if (url.endsWith('/api/v2/nodes/python')) result = node;
      else if (url.endsWith('/nodes/python/topics?p=1')) result = [topic];
      else if (url.endsWith('/nodes/python/topics?p=2')) result = [];
      else if (url.endsWith('/topics/123')) result = topic;
      else if (url.endsWith('/topics/124')) result = { ...topic, id: 124, title: 'Next V2EX fixture' };
      else if (url.endsWith('/replies?p=1')) result = [reply(123)];
      else if (url.endsWith('/replies?p=2')) result = [reply(124)];
      else if (url.endsWith('/replies?p=3')) result = [];
      else throw new Error('Unexpected V2EX fixture path');
      return { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ success: true, result })) };
    }
    if (url === 'https://menu.5ch.io/bbsmenu.html') return { status: 200, headers: {}, body: Buffer.from('<a href="https://egg.5ch.io/software/">Software</a>') };
    if (url.endsWith('/software/subject.txt')) return { status: 200, headers: {}, body: Buffer.from('1608930977.dat<>RIFT fixture (3)\n') };
    if (url.endsWith('/software/dat/1608930976.dat')) return { status: 404, headers: {}, body: Buffer.alloc(0) };
    if (url.endsWith('/software/oyster/1608/1608930976.dat')) return { status: 200, headers: {}, body: Buffer.from('Archive<><>2026<>archived previous thread<>Previous fixture\nReply<><>2026<>https://egg.5ch.io/test/read.cgi/software/1608930977/<>\n') };
    if (url.endsWith('/software/dat/1608930977.dat')) return { status: 200, headers: {}, body: Buffer.from('Alice<><>2026 ID:ONE<>hello https://i.ibb.co/abc1234/fixture.png<>fixture\nBob<><>2026 ID:TWO<>&gt;&gt;1 second https://i.ibb.co/abc1234/fixture.png<>\nCarol<><>2026 ID:THREE<>last<>\n') };
    if (url === 'https://i.ibb.co/abc1234/fixture.png' || url === 'https://i.urusai.cc/RiftTest.png') {
      assert.deepEqual(headers, {}); fiveImageReads++;
      if (url === 'https://i.urusai.cc/RiftTest.png' && largeImageSize) {
        if (limit < largeImageSize) throw Object.assign(new Error('Fixture size limit'), { code: 'RESPONSE_TOO_LARGE', limit, size: largeImageSize, exact: true, status: 200 });
        assert.equal(limit, 100 * 1024 * 1024); largeImageReads++;
      }
      return { status: 200, headers: { 'content-type': 'image/png' }, body: fivePng };
    }
    unexpectedNetwork.push(url);
    throw new Error('Unexpected fixture URL: ' + url);
  } };

  if (name === './services') return { ...originalLoad.call(this, name, ...args), downloadImage: async url => { downloadedUrls.push(url); downloadCalls++; if (downloadCalls <= 3) throw new Error('Fixture download failure'); } };
  return name === 'electron' ? { ...electron, BrowserWindow: HiddenWindow, shell: { openExternal: async url => { externalOpened.push(url); } }, dialog: { showMessageBox: async options => { if (options.title === 'Lainchanの閲覧確認') { lainPrompts++; assert.equal(options.message, 'Lainchanは18歳以上の方のみ閲覧できます'); assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0); return { response: allowLain ? 1 : 0 }; } if (options.title === '大きい画像の取得確認') { largeImagePrompts++; assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0); assert.ok(options.detail.includes('100MB')); assert.ok(options.detail.includes('i.urusai.cc')); return { response: allowLargeImage ? 1 : 0 }; } if (options.message === '18歳以上であることを確認してください') { pttPrompts++; assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0); return { response: allowPtt ? 1 : 0 }; } assert.equal(options.message, "外部サイトへ遷移します"); externalPrompts++; return { response: allowExternal ? 1 : 0 }; }, showOpenDialog: async () => { dialogCalls++; await new Promise(r => setTimeout(r, 100)); return { canceled: cancelSave, filePaths: cancelSave ? [] : [process.env.SMOKE_USER_DATA] }; } } } : originalLoad.call(this, name, ...args);
};
const timeout = setTimeout(() => { console.error('Smoke test timed out'); app.exit(1); }, 90000);
app.whenReady().then(() => {
  session.defaultSession.protocol.handle('https', async request => {
    networkReads++;
    const url = new URL(request.url);
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (url.href === 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap')
      return new Response('', { headers: { 'Content-Type': 'text/css' } });
    if (url.hostname === 'a.4cdn.org') {
      if (url.pathname === '/boards.json') return new Response(JSON.stringify({ boards: [{ board: 'g', title: 'Technology' }, { board: 'a', title: 'Animation' }] }), { headers });
      const board = url.pathname.split('/')[1];
      const no = board === 'g' ? 100 : 200;
      if (url.pathname.endsWith('/catalog.json')) {
        await new Promise(r => setTimeout(r, board === 'g' ? 180 : 10));
        return new Response(JSON.stringify([{ threads: [{ no, sub: board + ' &amp; test', com: 'hello', tim: no }] }]), { headers });
      }
      if (url.pathname.endsWith('/archive.json')) return new Response('[]', { headers });
      return new Response(JSON.stringify({ posts: Array.from({ length: 16 }, (_, i) => ({ no: no + i, com: i === 0 ? 'hello https://example.test/thread?x=1&amp;y=2 https://egg.5ch.net/test/read.cgi/software/1608930976/' : 'A &amp; B<br>Read position fixture ' + i, tim: no + i, ext: '.jpg' })) }), { headers });
    }
    if (url.hostname === 'i.4cdn.org') return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#17394a"/><circle cx="320" cy="240" r="100" fill="#62ddff"/></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
    unexpectedNetwork.push(request.url);
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
        assert.equal(await win.webContents.executeJavaScript(`(async () => { const icon = document.querySelector('.app-icon'); await icon.decode(); return icon.naturalWidth === 48 && icon.getBoundingClientRect().width === 24 && document.querySelector('link[rel="icon"]').href.endsWith('/icons/rift-32.png'); })()`), true);
        assert.equal(result.isolated, true);
        assert.equal(result.invalid.error, 'Missing text');
        assert.deepEqual(result.translated, { translatedText: 'smoke translation' });
        const run = async code => {
          const result = await win.webContents.executeJavaScript('Promise.resolve().then(() => (0, eval)(' + JSON.stringify(code) + ')).then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error), stack: error.stack }))');
          if (!result.ok) throw new Error(result.error + '\n' + result.stack);
          return result.value;
        };
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
          await waitFor(() => JSON.parse(localStorage.getItem('rift.library.v3')).sites['4chan'].reads['a/200']?.scroll >= 800);
          const data = JSON.parse(localStorage.getItem('rift.library.v3')).sites['4chan'];
          if (data.reads['a/200'].scroll < 800 || !data.threads.includes('a/200')) throw new Error('Reading persistence: ' + JSON.stringify({ read: data.reads['a/200'], threads: data.threads, scroll: pane.scrollTop, height: pane.clientHeight, contentHeight: pane.scrollHeight }));
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
        cancelSave = true;
        await run(`(async () => {
          document.querySelector('.post-image-link').click();
          await waitFor(() => document.querySelector('dialog[open]'));
          document.querySelector('dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
          await waitFor(() => document.querySelector('.viewer-toolbar').textContent.includes('2 / 16'));
          document.querySelector('.viewer-save').click(); document.querySelector('.viewer-save').click();
          await waitFor(() => document.querySelector('.viewer-save-status')?.textContent.includes('キャンセル') && !document.querySelector('.viewer-save').disabled);
        })()`);
        assert.equal(dialogCalls, 4); assert.equal(downloadCalls, 4);
        cancelSave = false;
        await run(`(async () => {
          document.querySelector('.viewer-save').click();
          await waitFor(() => document.querySelector('.viewer-save').disabled);
          document.querySelector('dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
          await waitFor(() => document.querySelector('.viewer-toolbar').textContent.includes('3 / 16'));
          await waitFor(() => document.querySelector('.viewer-save-status')?.textContent.includes('1/1 件成功') && !document.querySelector('.viewer-save').disabled);
        })()`);
        assert.equal(downloadedUrls.at(-1), 'https://i.4cdn.org/a/201.jpg');
        assert.equal(dialogCalls, 5); assert.equal(downloadCalls, 5);
        await run(`(async () => {
          document.querySelector('.viewer-save').click();
          await waitFor(() => document.querySelector('.viewer-save').disabled);
          await waitFor(() => !document.querySelector('.viewer-save').disabled);
        })()`);
        assert.equal(downloadedUrls.at(-1), 'https://i.4cdn.org/a/202.jpg');
        assert.equal(dialogCalls, 6); assert.equal(downloadCalls, 6);
        const outputDir = path.resolve(__dirname, '../.test-artifacts');
        fs.mkdirSync(outputDir, { recursive: true });
        win.setSize(1401, 901); await new Promise(r => setTimeout(r, 100)); win.setSize(1400, 900); await new Promise(r => setTimeout(r, 200));
        fs.writeFileSync(path.join(outputDir, 'rift-viewer-save.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        win.setSize(390, 844); await new Promise(r => setTimeout(r, 200));
        assert.equal(await run('document.querySelector("dialog").scrollWidth <= document.querySelector("dialog").clientWidth'), true);
        fs.writeFileSync(path.join(outputDir, 'rift-viewer-save-mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        win.setSize(1400, 900);
        await run("document.querySelector('dialog .viewer-actions button:last-child').click()");
        win.setSize(1401, 901);
        await new Promise(r => setTimeout(r, 100));
        win.setSize(1400, 900);
        await new Promise(r => setTimeout(r, 250));
        fs.writeFileSync(path.join(outputDir, 'desktop.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        win.setSize(390, 844);
        await new Promise(r => setTimeout(r, 200));
        assert.equal(await run('document.documentElement.scrollWidth <= window.innerWidth'), true);
        fs.writeFileSync(path.join(outputDir, 'mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        await run('document.querySelector(".post-card").scrollIntoView()');
        await new Promise(r => setTimeout(r, 200));
        fs.writeFileSync(path.join(outputDir, 'mobile-thread.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
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
          if (!JSON.parse(localStorage.getItem('rift.library.v3')).sites['4chan'].threads.includes('a/200')) throw new Error('Favorite not restored');
          if (document.querySelector('.post-card').parentElement.scrollTop < 500) throw new Error('Position not restored');
          window.confirm = () => true;
          [...document.querySelectorAll('button')].find(b => b.textContent.includes('閲覧データを消去')).click();
          await new Promise(r => setTimeout(r, 100));
          const cleared = JSON.parse(localStorage.getItem('rift.library.v3')).sites['4chan'];
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
          document.querySelector('.gallery-link').click();
          await waitFor(() => document.querySelector('dialog .viewer-content img'));
          if (!document.querySelector('dialog .viewer-content img').src.startsWith('blob:')) throw new Error('Viewer remote image was not validated');
          document.querySelector('.viewer-save').click();
          await waitFor(() => document.querySelector('.viewer-save').disabled);
          await waitFor(() => document.querySelector('.viewer-save-status')?.textContent.includes('1/1 件成功') && !document.querySelector('.viewer-save').disabled);
          document.querySelector('dialog .viewer-actions button:last-child').click();
        })()`);
        // Wait for the real safe-image writer, rather than the previous save message.
        await new Promise(r => setTimeout(r, 1200));
        const savedImages = fs.readdirSync(process.env.SMOKE_USER_DATA).filter(name => /^[a-f0-9]{24}\.png$/.test(name));
        assert.equal(savedImages.length, 1);
        assert.deepEqual(fs.readFileSync(path.join(process.env.SMOKE_USER_DATA, savedImages[0])), fivePng);
        win.setSize(1401, 901); await new Promise(r => setTimeout(r, 100)); win.setSize(1400, 900); await new Promise(r => setTimeout(r, 200));
        fs.writeFileSync(path.join(outputDir, 'rift-5ch.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        assert.equal(await run("document.querySelector('.topbar').getBoundingClientRect().height <= 64"), true);
        win.setSize(390, 844); await new Promise(r => setTimeout(r, 200));
        assert.equal(await run('document.documentElement.scrollWidth <= window.innerWidth'), true);
        fs.writeFileSync(path.join(outputDir, 'rift-5ch-mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
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
        const assertTabSizes = async () => {
          assert.equal(await run(`(() => {
            const tabs = [...document.querySelectorAll('.reader-tab')];
            return tabs.length >= 2 && tabs.every(tab => {
              const rect = tab.getBoundingClientRect();
              const close = tab.querySelector('button:last-child').getBoundingClientRect();
              const label = tab.querySelector('button:first-child');
              return rect.width === 240 && rect.height === 32 && close.width === 30 &&
                Math.abs(rect.right - close.right - 1) < 0.5 &&
                getComputedStyle(label).textOverflow === 'ellipsis' && Boolean(label.title);
            });
          })()`), true, 'Tabs must have uniform dimensions and fixed close buttons');
        };
        await assertTabSizes();
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
          if (document.querySelector('.reader-tab') || JSON.parse(localStorage.getItem('rift.tabs.v2')).tabs.length) throw new Error('Tab history not cleared');
        })()`);
        await run(`window.waitFor = async (test) => { const end = Date.now() + 12000; while (!test()) { if (Date.now() > end) throw new Error('Library UI timeout'); await new Promise(r => setTimeout(r, 25)); } }; true;`);
        await run(`(async () => {
          document.querySelector('[data-source="5ch"]').click();
          await waitFor(() => document.querySelector('.board-item')?.textContent.includes('software'));
          document.querySelector('.favorite-board').click();
          await waitFor(() => document.querySelector('.library-board-link'));
          document.querySelector('.library-board-link').click();
          await waitFor(() => document.querySelector('.thread-card'));
          document.querySelector('.thread-card').click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 3);
          [...document.querySelectorAll('.panel-header button')].find(b => b.textContent === 'お気に入り').click();
          document.querySelectorAll('.library-nav-item')[0].click();
          await waitFor(() => document.querySelector('.saved-thread-open')?.textContent.includes('fixture'));
          if (document.querySelectorAll('.post-card').length !== 3) throw new Error('Library navigation replaced reader');
          const count = document.querySelectorAll('.reader-tab').length;
          document.querySelector('.saved-thread-open').click();
          await new Promise(r => setTimeout(r, 100));
          if (document.querySelectorAll('.reader-tab').length !== count) throw new Error('Library duplicated tab');
          const input = document.querySelector('[aria-label="保存スレッドを検索"]');
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, 'not-a-title'); input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitFor(() => !document.querySelector('.saved-thread'));
          setter.call(input, 'fixture'); input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitFor(() => document.querySelector('.saved-thread'));
        })()`);
        win.setSize(1401, 901); await new Promise(r => setTimeout(r, 100)); win.setSize(1400, 900); await new Promise(r => setTimeout(r, 200));
        fs.writeFileSync(path.join(outputDir, 'rift-library.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        win.setSize(390, 844); await new Promise(r => setTimeout(r, 200));
        assert.equal(await run('document.documentElement.scrollWidth <= window.innerWidth'), true);
        await assertTabSizes();
        fs.writeFileSync(path.join(outputDir, 'rift-library-mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        win.setSize(1400, 900);
        await run(`(async () => {
          document.querySelectorAll('.library-nav-item')[1].click();
          await waitFor(() => document.querySelector('.history-day'));
          [...document.querySelectorAll('.saved-thread-actions button')].find(b => b.textContent === '履歴削除').click();
          await waitFor(() => !document.querySelector('.saved-thread'));
          const pane = document.querySelector('.post-card').parentElement;
          pane.scrollTop = 200; pane.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 350));
          const saved = JSON.parse(localStorage.getItem('rift.library.v3')).sites['5ch'];
          if (Object.keys(saved.history).length || !saved.threads.includes('software/1608930977')) throw new Error('History deletion affected favorites or resurrected history');
          document.querySelector('.history-options').open = true;
          document.querySelector('.history-options input').click();
          await waitFor(() => JSON.parse(localStorage.getItem('rift.library.v3')).historyEnabled === false);
          document.querySelector('[data-source="4chan"]').click();
          document.querySelector('[data-source="5ch"]').click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 3);
          await new Promise(r => setTimeout(r, 100));
          if (Object.keys(JSON.parse(localStorage.getItem('rift.library.v3')).sites['5ch'].history).length) throw new Error('Paused history recorded visit');
          document.querySelectorAll('.library-nav-item')[0].click();
          await waitFor(() => document.querySelector('.saved-thread'));
        })()`);
        await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload(); });
        await run(`(async () => {
          const end = Date.now() + 12000;
          while (!document.querySelector('.post-card')) { if (Date.now() > end) throw new Error('Library reload timeout'); await new Promise(r => setTimeout(r, 25)); }
          if (!document.querySelector('.library-board-link')) throw new Error('Favorite board not restored');
          document.querySelectorAll('.library-nav-item')[0].click();
          await new Promise(r => setTimeout(r, 100));
          if (!document.querySelector('.saved-thread-open').textContent.includes('fixture')) throw new Error('Favorite title not restored');
          if (JSON.parse(localStorage.getItem('rift.library.v3')).historyEnabled !== false) throw new Error('History setting not restored');
        })()`);

        await run(`window.waitFor = async (test) => { const end = Date.now() + 12000; while (!test()) { if (Date.now() > end) throw new Error('Saved UI timeout'); await new Promise(r => setTimeout(r, 25)); } }; window.confirm = () => true; true;`);
        await run(`(async () => {
          if (document.querySelector('.library-board-row').getBoundingClientRect().height > 40) throw new Error('Favorite board not compact');
          document.querySelector('.save-thread-text').click();
          await waitFor(() => document.querySelectorAll('.library-nav-item')[2].textContent.includes('1'));
          await waitFor(() => !document.querySelector('.save-thread-text').disabled);
          document.querySelector('.save-thread-text').click();
          await waitFor(() => !document.querySelector('.save-thread-text').disabled);
          document.querySelectorAll('.library-nav-item')[2].click();
          await waitFor(() => document.querySelector('.saved-thread-open'));
          if (document.querySelectorAll('.saved-thread').length !== 1) throw new Error('Snapshot overwrite duplicated entry');
        })()`);
        const readsBeforeOffline = networkReads;
        await run(`(async () => {
          document.querySelector('.saved-thread-open').click();
          await waitFor(() => document.querySelector('.offline-thread'));
          if (document.querySelectorAll('.offline-thread .post-card').length !== 3 || document.querySelector('.offline-thread img')) throw new Error('Offline snapshot content');
          if (!document.querySelector('.offline-thread').textContent.includes('hello')) throw new Error('Offline text missing');
          document.querySelector('.offline-thread .external-link').click();
        })()`);
        await new Promise(r => setTimeout(r, 150));
        assert.equal(networkReads, readsBeforeOffline);
        assert.equal(externalPrompts, 1); assert.equal(externalOpened.length, 0);
        allowExternal = true;
        await run("document.querySelector('.offline-thread .external-link').click()");
        await new Promise(r => setTimeout(r, 150));
        assert.equal(externalPrompts, 2); assert.deepEqual(externalOpened, ['https://i.ibb.co/abc1234/fixture.png']);
        assert.ok((await run("window.electron.openExternal('file:///C:/private')")).error);
        assert.equal(externalPrompts, 2);
        win.setSize(1401, 901); await new Promise(r => setTimeout(r, 100)); win.setSize(1400, 900); await new Promise(r => setTimeout(r, 200));
        fs.writeFileSync(path.join(outputDir, 'rift-saved-thread.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        win.setSize(390, 844); await new Promise(r => setTimeout(r, 150));
        assert.equal(await run('document.documentElement.scrollWidth <= window.innerWidth'), true);
        fs.writeFileSync(path.join(outputDir, 'rift-saved-thread-mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        win.setSize(1400, 900);
        await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload(); });
        await run(`(async () => {
          window.waitFor = async test => { const end = Date.now() + 12000; while (!test()) { if (Date.now() > end) throw new Error('Saved restore timeout'); await new Promise(r => setTimeout(r, 25)); } };
          window.confirm = () => true;
          await waitFor(() => document.querySelectorAll('.library-nav-item')[2]?.textContent.includes('1'));
          document.querySelectorAll('.library-nav-item')[2].click();
          await waitFor(() => document.querySelector('.saved-thread-open'));
          document.querySelector('.saved-thread-open').click();
          await waitFor(() => document.querySelector('.offline-thread'));
          document.querySelector('.saved-thread-actions button').click();
          await waitFor(() => !document.querySelector('.saved-thread') && !document.querySelector('.offline-thread'));
          await waitFor(() => document.querySelector('.save-thread-text'));
          document.querySelector('.save-thread-text').click();
          await waitFor(() => document.querySelectorAll('.library-nav-item')[2].textContent.includes('1'));
          [...document.querySelectorAll('button')].find(b => b.textContent.includes('閲覧データを消去')).click();
          await waitFor(() => !document.querySelector('.reader-tab') && document.querySelectorAll('.library-nav-item')[2].textContent.includes('0'));
          const db = await new Promise((resolve, reject) => { const r = indexedDB.open('rift.saved-threads.v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
          const count = await new Promise(resolve => { const r = db.transaction('threads').objectStore('threads').count(); r.onsuccess = () => resolve(r.result); });
          db.close(); if (count !== 0) throw new Error('Clear left saved bodies behind');
          document.querySelector('[data-source="4chan"]').click();
          await waitFor(() => document.querySelector('.board-item')?.textContent.includes('/g/'));
          document.querySelector('.board-item').click();
          await waitFor(() => document.querySelector('.thread-card'));
          document.querySelector('.thread-card').click();
          await waitFor(() => document.querySelector('.save-thread-text'));
          if (!document.querySelector('.post-body .external-link').href.includes('x=1&y=2')) throw new Error('4chan URL decoding');
          document.querySelector('.save-thread-text').click();
          await waitFor(() => document.querySelectorAll('.library-nav-item')[2].textContent.includes('1'));
          document.querySelectorAll('.library-nav-item')[2].click();
          await waitFor(() => document.querySelector('.saved-thread-open'));
          document.querySelector('.saved-thread-open').click();
          await waitFor(() => document.querySelector('.offline-thread'));
          if (document.querySelectorAll('.offline-thread .post-card').length !== 16 || !document.querySelectorAll('.offline-thread .post-body')[1].textContent.includes('A & B')) throw new Error('4chan snapshot encoding');

        })()`);
        const promptsBeforeInternal = externalPrompts, openedBeforeInternal = externalOpened.length;
        await run(`(async () => {
          document.querySelector('.offline-thread .internal-thread-link').click();
          await waitFor(() => !document.querySelector('.offline-thread') && document.querySelectorAll('.post-card').length === 2);
          if (!document.querySelector('.thread-heading').parentElement.textContent.includes('公式過去ログ')) throw new Error('Archive label missing');
          if (!document.querySelector('.post-body').textContent.includes('archived previous thread')) throw new Error('Wrong archive content');
          if (document.querySelector('[data-source="5ch"]').getAttribute('aria-pressed') !== 'true') throw new Error('5ch link opened wrong site');
          const tabs = document.querySelectorAll('.reader-tab').length;
          document.querySelector('.post-body .internal-thread-link').click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 3);
          if (document.querySelectorAll('.reader-tab').length !== tabs + 1) throw new Error('Normal linked thread not added');
          [...document.querySelectorAll('.reader-tab > button:first-child')].find(b => b.textContent.includes('1608930976')).click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 2);
          document.querySelector('.post-body .internal-thread-link').click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 3);
          if (document.querySelectorAll('.reader-tab').length !== tabs + 1) throw new Error('Internal link duplicated tab');
        })()`);
        assert.equal(externalPrompts, promptsBeforeInternal); assert.equal(externalOpened.length, openedBeforeInternal);
        console.log('PASS: 5ch internal links from saved 4chan text, official archive fallback, live link navigation, tab reuse, no external browser');
        console.log('PASS: individual viewer save, cancellation/duplicate prevention, captured target during navigation, 5ch safe writer and mobile layout');
        console.log('PASS: offline save/overwrite/reload/delete/clear, no offline network, compact boards, confirmed external links, mobile layout');
        console.log('PASS: library favorites/history/search/delete/pause/restore + 4chan regression + RIFT 5ch boards/threads/posts, references, image consent/dedup/blob preview/safe save, ID filters, URL import and site isolation');
        const legacyLibrary = JSON.stringify({ version: 2, currentSource: '4chan', historyEnabled: false, boardOrder: ['4chan/g'], sites: {
          '4chan': { version: 2, boards: ['g'], threads: ['g/100'], history: { 'g/100': 1000 }, reads: { 'g/100': { post: 100, scroll: 0, updated: 1000 } }, metadata: { 'g/100': { title: 'Legacy favorite fixture', added: 1000 } }, last: { board: 'g', thread: 100 } },
        } });
        const legacyTabs = JSON.stringify({ version: 1, tabs: [{ source: '4chan', board: 'g', thread: 100 }] });
        const legacyDoc = { key: '4chan/g/777', source: '4chan', board: 'g', thread: 777, title: 'Legacy offline fixture', savedAt: 1000, posts: [{ no: 777, name: 'Legacy author', date: '', id: 'AUTHOR', com: 'Legacy preserved body' }] };
        await run(`(async () => {
          const doc = ${JSON.stringify(legacyDoc)};
          const db = await new Promise((resolve, reject) => { const r = indexedDB.open('rift.saved-threads.v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
          await new Promise((resolve, reject) => {
            const tx = db.transaction(['threads', 'summaries'], 'readwrite');
            tx.oncomplete = resolve; tx.onabort = reject;
            tx.objectStore('threads').put(doc);
            const { posts, ...info } = doc;
            tx.objectStore('summaries').put({ ...info, count: posts.length, bytes: new TextEncoder().encode(JSON.stringify(doc)).length });
          });
          db.close();
          window.addEventListener('beforeunload', () => {
            localStorage.setItem('rift.library.v2', ${JSON.stringify(legacyLibrary)});
            localStorage.setItem('rift.tabs.v1', ${JSON.stringify(legacyTabs)});
            localStorage.removeItem('rift.library.v3'); localStorage.removeItem('rift.tabs.v2');
          }, { once: true });
        })()`);
        await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload(); });
        await run(`(async () => {
          window.waitFor = async test => { const end = Date.now() + 8000; while (!test()) { if (Date.now() > end) throw new Error('Migration wait timed out'); await new Promise(r => setTimeout(r, 25)); } };
          await waitFor(() => document.querySelectorAll('.post-card').length === 16 && document.querySelectorAll('.board-item').length === 2);
          await waitFor(() => localStorage.getItem('rift.library.v3') && localStorage.getItem('rift.tabs.v2'));
          if (localStorage.getItem('rift.library.v2') !== ${JSON.stringify(legacyLibrary)}) throw new Error('Legacy library was overwritten');
          if (localStorage.getItem('rift.tabs.v1') !== ${JSON.stringify(legacyTabs)}) throw new Error('Legacy tabs were overwritten');
          const library = JSON.parse(localStorage.getItem('rift.library.v3'));
          if (library.version !== 3 || library.historyEnabled !== false || library.sites['4chan'].last.thread !== '100') throw new Error('Library migration shape');
          if (!library.sites['4chan'].threads.includes('g/100') || library.sites['4chan'].reads['g/100'].post !== 100) throw new Error('Legacy library entries lost');
          if (document.querySelectorAll('.reader-tab').length !== 1 || !document.querySelector('.post-card .meta').textContent.includes('既読')) throw new Error('Legacy tab/reading state lost');
          if (!document.querySelector('[data-source="v2ex"]') || !document.querySelector('[data-source="ptt"]')) throw new Error('Incorrect site exposure');
          document.querySelectorAll('.library-nav-item')[2].click();
          await waitFor(() => [...document.querySelectorAll('.saved-thread-open')].some(button => button.textContent.includes('Legacy offline fixture')));
        })()`);
        const readsBeforeLegacyOffline = networkReads;
        await run(`(async () => {
          [...document.querySelectorAll('.saved-thread-open')].find(button => button.textContent.includes('Legacy offline fixture')).click();
          await waitFor(() => document.querySelector('.offline-thread'));
          if (!document.querySelector('.offline-thread').textContent.includes('Legacy preserved body')) throw new Error('Legacy snapshot unreadable');
          const db = await new Promise((resolve, reject) => { const r = indexedDB.open('rift.saved-threads.v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
          const value = await new Promise(resolve => { const r = db.transaction('threads').objectStore('threads').get('4chan/g/777'); r.onsuccess = () => resolve(r.result); });
          db.close();
          if (JSON.stringify(value) !== ${JSON.stringify(JSON.stringify(legacyDoc))}) throw new Error('Reading rewrote the legacy snapshot');
        })()`);
        assert.equal(networkReads, readsBeforeLegacyOffline);
        console.log('PASS: actual legacy localStorage/IndexedDB migration, preserved originals, string IDs, read state and offline access');
        const externalBeforeV2ex = externalPrompts;
        // Hidden windows can suspend entry animations. Use reduced motion for deterministic captures.
        await win.webContents.insertCSS('.animate-enter { animation: none !important; }');
        await run(`(async () => {
          window.confirm = () => true;
          window.clickText = text => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === text); if (!button) throw new Error('Missing button: ' + text); button.click(); };
          document.querySelector('[data-source="v2ex"]').click();
          await waitFor(() => document.querySelector('.board-item')?.textContent.includes('/python/'));
          document.querySelector('.board-item').click();
          await waitFor(() => document.querySelector('.thread-card')?.textContent.includes('Public AI fixture'));
          document.querySelector('.thread-card').click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 1);
          if (!document.querySelector('.post-body').textContent.includes('Public <code> & 中文') || document.querySelector('.post-body script') || document.querySelector('.image-consent')) throw new Error('Unsafe public rendering');
          if (![...document.querySelectorAll('.reader-notice')].some(e => e.textContent.includes('トークン不要'))) throw new Error('Public mode missing');
          window.confirm = () => false;
          clickText('公開返信を試験取得');
          await new Promise(r => setTimeout(r, 100));
          if (document.querySelectorAll('.post-card').length !== 1) throw new Error('Public reply consent ignored');
        })()`);
        assert.equal(publicReplyReads, 0);
        await run(`(async () => {
          window.confirm = () => true;
          clickText('公開返信を試験取得');
          await waitFor(() => document.querySelectorAll('.post-card').length === 2);
          if ([...document.querySelectorAll('button')].some(b => b.textContent === '続きの投稿を読み込む')) throw new Error('Public reply pagination exposed');
          if (!document.querySelector('.reader-notice').parentElement.textContent.includes('全件とは限りません')) throw new Error('Reply completeness disclosure missing');
        })()`);
        assert.equal(publicReplyReads, 1);
        win.setSize(1401, 901); await new Promise(r => setTimeout(r, 100)); win.setSize(1400, 900);
        await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await new Promise(r => setTimeout(r, 300));
        fs.writeFileSync(path.join(outputDir, 'v2ex-public.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        win.setSize(390, 844); await new Promise(r => setTimeout(r, 200));
        assert.equal(await run('document.documentElement.scrollWidth <= window.innerWidth'), true);
        fs.writeFileSync(path.join(outputDir, 'v2ex-public-mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        console.log('PASS: default token-free feed reader, inert HTML, explicit bounded replies, unknown reply count, public limitations and mobile layout');
        win.setSize(1400, 900);
        await run(`(async () => {
          clickText('V2EX接続設定');
          await waitFor(() => document.querySelector('#v2ex-token') && !document.querySelector('#v2ex-token').disabled);
          const input = document.querySelector('#v2ex-token');
          if (input.type !== 'password') throw new Error('Unmasked token field');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'fixture-not-a-real-credential');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent === '設定する' && !b.disabled));
          clickText('設定する');
          await waitFor(() => document.querySelector('.connection-message')?.textContent.includes('設定しました'));
          if (input.value !== '') throw new Error('Token input retained secret');
          if (JSON.stringify(localStorage).includes('fixture-not-a-real-credential')) throw new Error('Token stored in localStorage');
          const status = await window.electron.v2exSettings({ kind: 'status' });
          if (!status.configured || JSON.stringify(status).includes('fixture-not-a-real-credential')) throw new Error('Unsafe status');
          if (status.mode !== 'public' || ![...document.querySelectorAll('button')].find(b => b.textContent === '接続を確認').disabled) throw new Error('Token silently enabled authenticated mode');
          document.querySelectorAll('input[name="v2ex-mode"]')[1].click();
          await waitFor(() => document.querySelector('.connection-message')?.textContent.includes('閲覧モードを保存しました'));
          if (!(await window.electron.v2exSettings({ kind: 'status' })).mode.includes('authenticated')) throw new Error('Mode selection not saved');
          clickText('接続を確認');
          await waitFor(() => document.querySelector('.connection-message')?.textContent.includes('接続を確認しました'));
          let disclosure = '';
          window.confirm = message => { disclosure = message; return false; };
          clickText('読み取り動作を確認');
          await new Promise(r => setTimeout(r, 50));
          if (!disclosure.includes('最大6要求') || document.querySelector('.verification-report')) throw new Error('Readiness consent not respected');
          window.confirm = () => true;
          clickText('読み取り動作を確認');
          await waitFor(() => document.querySelector('.verification-report'));
          const report = document.querySelector('.verification-report');
          if (!report.querySelector('[data-check="connection"]').textContent.includes('確認済み') || !report.querySelector('[data-check="topicPages"]').textContent.includes('未確認')) throw new Error('Readiness statuses are misleading');
          if (!report.querySelector('[data-check="replyPages"]').textContent.includes('確認済み') || report.textContent.includes('code <div>') || report.textContent.includes('fixture-not-a-real-credential')) throw new Error('Readiness report leaked content');
          if (JSON.parse(localStorage.getItem('rift.library.v3')).sites.v2ex.reads['python/123']) throw new Error('Readiness recorded reading history');
        })()`);
        win.setSize(1401, 901); await new Promise(r => setTimeout(r, 100)); win.setSize(1400, 900);
        await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await new Promise(r => setTimeout(r, 500));
        fs.writeFileSync(path.join(__dirname, '../.test-artifacts/v2ex-settings.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        await run("document.querySelector('.verification-report').scrollIntoView({block:'end'})");
        await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await new Promise(r => setTimeout(r, 300));
        fs.writeFileSync(path.join(outputDir, 'v2ex-verification.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        const encryptedFile = path.join(process.env.SMOKE_USER_DATA, 'v2ex-token.bin');
        const connectionStatus = await run('window.electron.v2exSettings({ kind: "status" })');
        if (connectionStatus.persistent) {
          const encrypted = fs.readFileSync(encryptedFile);
          assert.equal(encrypted.includes('fixture-not-a-real-credential'), false);
          assert.equal(electron.safeStorage.decryptString(encrypted), 'fixture-not-a-real-credential');
        }
        await run(`(async () => {
          clickText('閉じる');
          await waitFor(() => document.querySelector('.thread-card')?.textContent.includes('中文 AI fixture'));
          document.querySelector('.favorite-board').click();
          document.querySelector('.thread-card button').click();
          document.querySelector('.thread-card').click();
          await waitFor(() => document.querySelectorAll('.post-card').length === 2);
          if (!document.querySelector('.post-body').textContent.includes('code <div> & 中文')) throw new Error('Plain content altered');
          if (document.querySelector('.post-body img') || !document.querySelector('.post-card .translate-block')) throw new Error('Unexpected remote content or missing translation control');
          clickText('続きの投稿を読み込む');
          await waitFor(() => document.querySelectorAll('.post-card').length === 3);
          if (!document.querySelector('[data-post-id="reply:124"] .translate-block button').disabled || !document.querySelector('[data-post-id="reply:124"]').textContent.includes('4,000文字')) throw new Error('Long translation not bounded');
          if (document.querySelectorAll('[data-post-id="reply:123"]').length !== 1) throw new Error('Duplicate replies');
          clickText('続きの投稿を読み込む');
          await waitFor(() => ![...document.querySelectorAll('button')].some(b => b.textContent === '続きの投稿を読み込む'));
          clickText('本文を保存');
          await waitFor(() => document.body.textContent.includes('本文を保存しました'));
        })()`);
        const exerciseChineseMedia = async source => {
          const beforeTranslations = translatedTexts.length, beforeImages = fiveImageReads;
          await run(`(async () => {
            const translation = document.querySelector('.post-card .translate-block button');
            if (document.querySelector('.translate-result')) throw new Error('Automatic translation');
            let prompted = 0;
            window.confirm = message => { if (!message.includes('DeepL')) throw new Error('Missing translation disclosure'); prompted++; return false; };
            translation.click(); await new Promise(r => setTimeout(r, 50));
            if (prompted !== 1 || document.querySelector('.translate-result')) throw new Error('Translation cancel ignored');
            window.confirm = message => { if (!message.includes('IPアドレス')) throw new Error('Missing image disclosure'); return false; };
            if (${source === 'PTT'}) {
              if (!document.querySelector('.image-consent').textContent.includes('対応画像 1 件') || !document.querySelector('.ptt-image-help')) throw new Error('PTT image discovery missing');
              document.querySelector('.post-media-open').click(); await new Promise(r => setTimeout(r, 50));
              if (!document.querySelector('.post-body') || document.querySelector('.gallery-thumb')) throw new Error('Post image consent cancellation ignored');
              clickText('画像を読み込む'); await new Promise(r => setTimeout(r, 50));
              if (!document.querySelector('.post-body')) throw new Error('Image cancellation changed reading mode');
            }
            clickText('${source === 'PTT' ? '画像一覧 (1)' : 'Gallery'}'); await waitFor(() => document.querySelector('.media-placeholder'));
            if (document.querySelector('.gallery-thumb') || ![...document.querySelectorAll('button')].find(b => b.textContent === '${source === 'PTT' ? '画像をすべて保存' : 'Save all'}').disabled) throw new Error('Images before consent');
            clickText('画像を読み込む'); await new Promise(r => setTimeout(r, 50));
            if (document.querySelector('.gallery-thumb')) throw new Error('Image cancel ignored');
          })()`);
          assert.equal(translatedTexts.length, beforeTranslations); assert.equal(fiveImageReads, beforeImages);
          cancelSave = false;
          const savesBefore = dialogCalls;
          await run(`(async () => {
            clickText('Thread'); await waitFor(() => document.querySelector('.post-body'));
            window.confirm = () => true;
            clickText('画像を読み込む');
            await waitFor(() => document.querySelector('.gallery-thumb')?.src.startsWith('blob:'));
            if (document.querySelector('.post-body')) throw new Error('Accepted images did not open gallery');
            document.querySelector('.gallery-link').click();
            await waitFor(() => document.querySelector('.media-viewer img')?.src.startsWith('blob:'));
            document.querySelector('.viewer-save').click();
            await waitFor(() => document.querySelector('.viewer-save').disabled);
            await waitFor(() => !document.querySelector('.viewer-save').disabled && document.querySelector('.viewer-save-status')?.textContent.includes('保存完了: 1/1'));
          })()`);
          assert.equal(dialogCalls, savesBefore + 1);
          win.setSize(430, 850);
          await run(`(async () => {
            await waitFor(() => innerWidth < 500);
            const box = document.querySelector('.media-viewer').getBoundingClientRect();
            if (box.left < 0 || box.right > innerWidth || box.height > innerHeight || document.documentElement.scrollWidth > innerWidth) throw new Error('Chinese media mobile overflow');
          })()`);
          await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await new Promise(r => setTimeout(r, 300));
          fs.writeFileSync(path.join(outputDir, source.toLowerCase() + '-media-mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
          win.setSize(1400, 900);
          await run(`(async () => {
            clickText('閉じる (Esc)');
            if (${source === 'PTT'}) {
              const saveAndWait = async button => {
                button.click();
                await waitFor(() => button.disabled);
                await waitFor(() => !button.disabled && document.querySelector('.status-bar').textContent.includes('保存完了: 1/1'));
              };
              await saveAndWait(document.querySelector('.gallery-meta button'));
              document.querySelector('.gallery-meta input').click();
              await waitFor(() => !document.querySelector('.gallery-tools button').disabled);
              await saveAndWait(document.querySelector('.gallery-tools button'));
              await saveAndWait([...document.querySelectorAll('button')].find(b => b.textContent === '画像をすべて保存'));
            }
            clickText('画像の表示を停止');
            await waitFor(() => document.querySelector('.media-placeholder') && !document.querySelector('.gallery-thumb'));
            clickText('Thread'); await waitFor(() => document.querySelector('.post-card .translate-block button'));
            if (${source === 'PTT'}) {
              document.querySelector('.post-media-open').click();
              await waitFor(() => document.querySelector('.gallery-thumb')?.src.startsWith('blob:'));
              clickText('画像の表示を停止');
              await waitFor(() => !document.querySelector('.gallery-thumb'));
              clickText('Thread'); await waitFor(() => document.querySelector('.post-body'));
            }
            const original = document.querySelector('.post-body').textContent;
            document.querySelector('.post-card .translate-block button').click();
            await waitFor(() => document.querySelector('.post-card .translate-result')?.textContent.includes('smoke translation'));
            if (document.querySelector('.post-body').textContent !== original) throw new Error('Translation replaced original');
            document.querySelector('.post-card .translate-block button').click();
            await waitFor(() => !document.querySelector('.post-card .translate-result'));
            document.querySelector('.post-card .translate-block button').click();
            await waitFor(() => document.querySelector('.post-card .translate-result'));
          })()`);
          assert.equal(translatedTexts.length, beforeTranslations + 1);
          if (source === 'PTT') assert.equal(dialogCalls, savesBefore + 4);
          assert.ok(fiveImageReads > beforeImages);
          assert.ok(fs.readdirSync(process.env.SMOKE_USER_DATA).some(file => /^[a-f0-9]{24}(?:_\d+)?\.png$/.test(file)));
          console.log('PASS: ' + source + ' explicit translation/image consent and cancellation, original retention, cached toggle, safe blob viewer/save, stop display');
        };
        await exerciseChineseMedia('V2EX');
        await new Promise(r => setTimeout(r, 250));
        await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        fs.writeFileSync(path.join(__dirname, '../.test-artifacts/v2ex-desktop.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        await run(`(async () => {
          document.querySelector('.post-body .internal-thread-link').click();
          await waitFor(() => document.querySelector('.thread-heading')?.textContent.includes('Next V2EX fixture'));
          if (!JSON.parse(localStorage.getItem('rift.tabs.v2')).tabs.some(t => t.source === 'v2ex' && t.thread === '124')) throw new Error('V2EX tab missing');
          clickText('V2EX接続設定');
          await waitFor(() => document.querySelector('#v2ex-token') && !document.querySelector('#v2ex-token').disabled);
          clickText('トークンを削除');
          await waitFor(() => document.querySelector('.connection-message')?.textContent.includes('削除しました'));
          clickText('閉じる');
          await waitFor(() => document.querySelectorAll('.post-card').length === 0);
          const status = await window.electron.v2exSettings({ kind: 'status' });
          if (status.configured) throw new Error('Token removal failed');
          document.querySelectorAll('.library-nav-item')[2].click();
          await waitFor(() => [...document.querySelectorAll('.saved-thread-open')].some(b => b.textContent.includes('中文 AI fixture')));
          [...document.querySelectorAll('.saved-thread-open')].find(b => b.textContent.includes('中文 AI fixture')).click();
          await waitFor(() => document.querySelector('.offline-thread')?.textContent.includes('中文 reply 124'));
          if (JSON.stringify(localStorage).includes('fixture-not-a-real-credential')) throw new Error('Secret persisted in renderer');
        })()`);
        assert.equal(fs.existsSync(encryptedFile), false);
        assert.equal(externalPrompts, externalBeforeV2ex);
        win.setSize(430, 850);
        await run(`(async () => {
          clickText('V2EX接続設定');
          await waitFor(() => document.querySelector('#v2ex-token') && !document.querySelector('#v2ex-token').disabled);
          const box = document.querySelector('.connection-dialog').getBoundingClientRect();
          if (box.left < 0 || box.right > innerWidth || box.height > innerHeight) throw new Error('Settings overflow on mobile');
        })()`);
        await new Promise(r => setTimeout(r, 250));
        await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        fs.writeFileSync(path.join(__dirname, '../.test-artifacts/v2ex-mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        console.log('PASS: V2EX settings/masked token/OS encryption, API connection, nodes/topics/paging, favorites/tabs, plain Chinese text, internal links, offline save and credential deletion');
        win.setSize(1400, 900);
        await run(`(async () => {
          clickText('閉じる');
          document.querySelector('[data-source="ptt"]').click();
          await waitFor(() => [...document.querySelectorAll('.board-item')].some(b => b.textContent.includes('/Soft_Job/')));
          const guide = document.querySelector('.ptt-guide');
          if (!guide || guide.open) throw new Error('PTT guide must start collapsed');
          guide.querySelector('summary').click();
          if (!guide.textContent.includes('公開Web版のみ')) throw new Error('PTT guide safety information');
          const search = document.querySelector('[aria-label="板を検索"]');
          const searchFor = async value => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, value);
            search.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 50));
          };
          for (const invalid of ['../private', 'https://evil.test', 'constructor']) {
            await searchFor(invalid);
            if (document.querySelector('.ptt-direct-board')) throw new Error('Invalid direct PTT board offered');
          }
          await searchFor('Not_In_Popular');
          if (document.querySelector('.board-item') || !document.querySelector('.ptt-direct-board')) throw new Error('PTT unlisted board entry missing');
          await searchFor(' Soft_Job ');
          document.querySelector('.ptt-direct-board').click();
          await waitFor(() => document.querySelector('.thread-card')?.textContent.includes('PTT fixture'));
          await searchFor('');
          guide.querySelector('summary').click();
          document.querySelector('.favorite-board').click();
          document.querySelector('.thread-card button').click();
          document.querySelector('.thread-card').click();
          await waitFor(() => document.querySelectorAll('.ptt-reaction').length === 3);
          if ([...document.querySelectorAll('.ptt-reaction')].map(e => e.textContent).join('') !== '推噓→') throw new Error('PTT reactions');
          if (!document.querySelector('.post-body').textContent.includes('【署名】') || !document.querySelector('.post-body').textContent.includes('【出典】')) throw new Error('PTT body metadata');
          clickText('次のページを読み込む');
          await waitFor(() => document.querySelectorAll('.thread-card').length === 2);
          const tabs = document.querySelectorAll('.reader-tab').length;
          document.querySelector('.post-body .internal-thread-link').click();
          await new Promise(r => setTimeout(r, 100));
          if (document.querySelectorAll('.reader-tab').length !== tabs) throw new Error('PTT duplicate tab');
          clickText('本文を保存');
          await waitFor(() => document.body.textContent.includes('本文を保存しました'));
        })()`);
        await exerciseChineseMedia('PTT');
        largeImageSize = 21 * 1024 * 1024;
        await run(`(async () => {
          window.confirm = () => true;
          clickText('画像を読み込む');
          await waitFor(() => document.querySelector('.media-error')?.textContent.includes('キャンセル'));
          if (document.querySelector('.gallery-thumb')) throw new Error('Large image displayed without native consent');
        })()`);
        assert.equal(largeImagePrompts, 1); assert.equal(largeImageReads, 0);
        allowLargeImage = true;
        await run(`(async () => {
          document.querySelector('.media-error button').click();
          await waitFor(() => document.querySelector('.gallery-thumb')?.src.startsWith('blob:'));
        })()`);
        assert.equal(largeImagePrompts, 2); assert.equal(largeImageReads, 1);
        allowLargeImage = false;
        await run(`(async () => {
          document.querySelector('.gallery-meta button').click();
          await waitFor(() => document.querySelector('.gallery-meta button').disabled);
          await waitFor(() => !document.querySelector('.gallery-meta button').disabled && document.querySelector('.status-bar').textContent.includes('0/1'));
        })()`);
        assert.equal(largeImagePrompts, 3); assert.equal(largeImageReads, 1);
        allowLargeImage = true;
        await run(`(async () => {
          document.querySelector('.gallery-meta button').click();
          await waitFor(() => document.querySelector('.gallery-meta button').disabled);
          await waitFor(() => !document.querySelector('.gallery-meta button').disabled && document.querySelector('.status-bar').textContent.includes('保存完了: 1/1'));
          clickText('画像の表示を停止');
          await waitFor(() => !document.querySelector('.gallery-thumb'));
        })()`);
        assert.equal(largeImagePrompts, 4); assert.equal(largeImageReads, 2);
        largeImageSize = 101 * 1024 * 1024;
        await run(`(async () => {
          clickText('画像を読み込む');
          await waitFor(() => document.querySelector('.media-error')?.textContent.includes('100MB'));
          clickText('画像の表示を停止');
          clickText('Thread');
          await waitFor(() => document.querySelector('.post-body'));
        })()`);
        assert.equal(largeImagePrompts, 4); assert.equal(largeImageReads, 2);
        largeImageSize = 0;
        console.log('PASS: native large-image warning, cancellation without retry, one-time approval for display and save, and 100 MiB hard ceiling');
        const beforeEmptyImages = fiveImageReads;
        await run(`(async () => {
          document.querySelectorAll('.thread-card')[1].click();
          await waitFor(() => document.querySelector('.image-consent')?.textContent.includes('対応画像は0件'));
          let prompts = 0; window.confirm = () => { prompts++; return true; };
          clickText('画像を読み込む');
          if (prompts || ![...document.querySelectorAll('button')].find(b => b.textContent === '画像を読み込む').disabled) throw new Error('Empty images offered network consent');
          clickText('画像一覧 (0)');
          await waitFor(() => document.querySelector('.empty-state')?.textContent.includes('未対応の画像URL'));
          document.querySelectorAll('.thread-card')[0].click();
          await waitFor(() => document.querySelector('.post-body') && document.querySelector('.image-consent')?.textContent.includes('対応画像 1 件'));
          if (document.querySelector('.gallery-thumb') || ![...document.querySelectorAll('button')].find(b => b.textContent === '画像をすべて保存').disabled) throw new Error('Image consent survived thread switch');
        })()`);
        assert.equal(fiveImageReads, beforeEmptyImages);
        await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await new Promise(r => setTimeout(r, 500));
        fs.writeFileSync(path.join(__dirname, '../.test-artifacts/ptt-desktop.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        await run(`(async () => {
          const input = document.querySelector('[aria-label="PTTの板名またはURL"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'https://www.ptt.cc/bbs/Beauty/${pttFixture.id}.html');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 50)); document.querySelector('.url-bar').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          await waitFor(() => document.querySelectorAll('.ptt-age-notice').length === 2);
          if (document.querySelector('.post-card') || document.querySelector('.thread-card') || document.querySelector('.translate-block') || document.querySelector('.image-consent') || document.body.textContent.includes('Restricted fixture')) throw new Error('Age gate leaked content');
          const before = await window.electron.pttConsent({ kind: 'status' }); if (before.accepted) throw new Error('Implicit consent');
          clickText('年齢確認を開く');
          await waitFor(() => document.body.textContent.includes('同意していません'));
          if (document.querySelector('.post-card')) throw new Error('Cancelled consent exposed posts');
        })()`);
        assert.equal(pttPrompts, 1); assert.ok(pttCookies.every(c => c === undefined));
        allowPtt = true;
        await run(`(async () => {
          clickText('年齢確認を開く');
          await waitFor(() => document.querySelectorAll('.ptt-reaction').length === 3 && document.querySelector('.thread-card'));
          if (!(await window.electron.pttConsent({ kind: 'status' })).accepted) throw new Error('Native confirmation did not apply');
          clickText('PTT年齢確認を解除');
          await waitFor(() => document.querySelectorAll('.ptt-age-notice').length === 2);
          if (document.querySelector('.post-card') || document.querySelector('.thread-card')) throw new Error('Revoked consent left live body');
          if (JSON.stringify(localStorage).includes('over18=1') || document.cookie.includes('over18')) throw new Error('Consent persisted in renderer');
        })()`);
        assert.equal(pttPrompts, 2); assert.ok(pttCookies.includes('over18=1')); assert.equal(pttCookies.at(-1), undefined);
        win.setSize(430, 850);
        await new Promise(r => setTimeout(r, 250)); await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        fs.writeFileSync(path.join(__dirname, '../.test-artifacts/ptt-age-mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        const readsBeforeGuide = networkReads;
        await run(`(async () => {
          const guide = document.querySelector('.ptt-guide');
          guide.querySelector('summary').click();
          const search = document.querySelector('[aria-label="板を検索"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'A'.repeat(64));
          search.dispatchEvent(new Event('input', { bubbles: true }));
          await waitFor(() => document.querySelector('.ptt-direct-board'));
          const direct = document.querySelector('.ptt-direct-board');
          direct.scrollIntoView({ block: 'center' });
          if (direct.scrollWidth > direct.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth) throw new Error('PTT guide/direct board overflow on mobile');
        })()`);
        await new Promise(r => setTimeout(r, 250)); await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        fs.writeFileSync(path.join(__dirname, '../.test-artifacts/ptt-guide-mobile.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        assert.equal(networkReads, readsBeforeGuide, 'Guide and board-name typing must not fetch');
        await run(`(async () => {
          document.querySelectorAll('.library-nav-item')[2].click();
          await waitFor(() => [...document.querySelectorAll('.saved-thread-open')].some(b => b.textContent.includes('PTT fixture')));
          [...document.querySelectorAll('.saved-thread-open')].find(b => b.textContent.includes('PTT fixture')).click();
          await waitFor(() => document.querySelector('.offline-thread')?.textContent.includes('噓 中文 bad'));
          if (!document.querySelector('.offline-thread').textContent.includes('https://www.ptt.cc/bbs/Soft_Job/')) throw new Error('Saved PTT provenance missing');
          if (JSON.parse(localStorage.getItem('rift.library.v3')).sites.ptt.metadata['Beauty/${pttFixture.id}']) throw new Error('Gated title entered history');
        })()`);
        console.log('PASS: PTT compact guide, validated direct board entry, popular boards, older pages, Chinese body/reactions, favorites, internal links, offline save, native age confirmation/cancel/revoke and no gated content leak');
        win.setSize(1400, 900);
        const assertLainBlocked = async phase => {
          const before = networkReads, prompts = lainPrompts;
          const f = imageboardFixtures.lainchan;
          const requests = [
            { source: 'lainchan', kind: 'boards' },
            { source: 'lainchan', kind: 'threads', board: f.board },
            { source: 'lainchan', kind: 'posts', board: f.board, thread: f.thread },
            { source: 'lainchan', kind: 'resolve', url: f.url },
          ];
          for (const request of requests) {
            const result = await run(`window.electron.imageboardRequest(${JSON.stringify(request)})`);
            assert.ok(result.error || result.status === 'age-confirmation-required', phase + ': direct ' + request.kind + ' must be blocked');
            for (const key of ['boards', 'threads', 'posts', 'board']) assert.equal(result[key], undefined);
          }
          for (const url of [f.thumb, f.image]) {
            const image = await run(`window.electron.fiveImage(${JSON.stringify(url)})`);
            assert.ok(image.error, phase + ': direct media must be blocked, including cached bytes');
            assert.equal(image.bytes, undefined);
            const cancellable = await run(`window.electron.imageboardImage({ id: crypto.randomUUID(), url: ${JSON.stringify(url)} })`);
            assert.ok(cancellable.error, phase + ': cancellable image IPC must enforce the same age gate');
            assert.equal(cancellable.bytes, undefined);
          }
          cancelSave = false;
          const filesBefore = fs.readdirSync(process.env.SMOKE_USER_DATA).filter(file => /\.png$/.test(file));
          const save = await run(`window.electron.saveImages([{ source: 'lainchan', url: ${JSON.stringify(f.image)} }])`);
          assert.equal(save.saved, 0, phase + ': direct image save must be blocked');
          assert.deepEqual(fs.readdirSync(process.env.SMOKE_USER_DATA).filter(file => /\.png$/.test(file)), filesBefore);
          assert.equal(networkReads, before, phase + ': gated IPC must not contact any host');
          assert.equal(lainPrompts, prompts, phase + ': reading must not implicitly open an age prompt');
        };
        assert.deepEqual(await run(`window.electron.imageboardConsent({ action: 'status', accepted: true })`), { accepted: false });
        await assertLainBlocked('Before native confirmation');
        const beforeLainNavigation = networkReads;
        await run(`(async () => {
          document.querySelector('[data-source="lainchan"]').click();
          await waitFor(() => document.querySelector('.ptt-age-notice')?.textContent.includes('Lainchan'));
          if (document.querySelector('.board-item') || document.querySelector('.thread-card')) throw new Error('Lain listing exposed before confirmation');
          window.confirm = () => true;
          clickText('18歳以上・利用条件の確認を開く');
          // A consent revision can remount the notice; verify access rather than transient local text.
          await new Promise(r => setTimeout(r, 75));
          await waitFor(() => document.querySelector('.ptt-age-notice button:not(:disabled)'));
          if ((await window.electron.imageboardConsent({ action: 'status' })).accepted) throw new Error('Renderer confirmation bypassed native cancellation');
          if (document.querySelector('.board-item') || document.querySelector('.thread-card') || document.querySelector('.post-card')) throw new Error('Cancelled Lain confirmation exposed content');
        })()`);
        assert.equal(lainPrompts, 1);
        assert.equal(networkReads, beforeLainNavigation, 'Lain navigation/native cancellation must not fetch');

        const exerciseImageboard = async source => {
          const f = imageboardFixtures[source], beforeImages = imageboardImageReads.length;
          const beforeTranslations = translatedTexts.length;
          await run(`(async () => {
            const f = ${JSON.stringify(f)};
            document.querySelector('[data-source="${source}"]').click();
            await waitFor(() => [...document.querySelectorAll('.board-item')].some(b => b.textContent.includes('/' + f.board + '/')));
            const board = [...document.querySelectorAll('.board-item')].find(b => b.textContent.includes('/' + f.board + '/'));
            board.parentElement.querySelector('.favorite-board').click();
            board.click();
            await waitFor(() => document.querySelector('.thread-card')?.textContent.includes(f.title));
            document.querySelector('.thread-card button').click();
            document.querySelector('.thread-card').click();
            await waitFor(() => document.querySelectorAll('.post-card').length === 2 && document.querySelector('.post-body')?.textContent.includes(f.body));
            if (document.querySelector('.post-body img') || document.querySelector('.translate-block')) throw new Error('Unexpected embedded image or unsupported translation');
            const library = JSON.parse(localStorage.getItem('rift.library.v3')).sites['${source}'];
            if (!library.boards.includes(f.board) || !library.threads.includes(f.board + '/' + f.thread)) throw new Error('Imageboard favorites not persisted separately');
            clickText('本文を保存');
            await waitFor(() => document.body.textContent.includes('本文を保存しました'));
            clickText('Gallery');
            await waitFor(() => document.querySelector('.media-placeholder'));
            if (document.querySelector('.gallery-thumb')) throw new Error('Automatic imageboard image request');
            window.confirm = () => false;
            clickText('画像を読み込む');
            await new Promise(r => setTimeout(r, 75));
            if (document.querySelector('.gallery-thumb')) throw new Error('Imageboard image cancellation ignored');
          })()`);
          assert.equal(imageboardImageReads.length, beforeImages, source + ': no images before explicit consent');
          assert.equal(translatedTexts.length, beforeTranslations);
          cancelSave = false;
          const savesBefore = dialogCalls;
          const filesBefore = fs.readdirSync(process.env.SMOKE_USER_DATA).filter(file => /\.png$/.test(file));
          await run(`(async () => {
            window.confirm = () => true;
            clickText('画像を読み込む');
            await waitFor(() => document.querySelector('.gallery-thumb')?.src.startsWith('blob:'));
          })()`);
          assert.deepEqual(imageboardImageReads.slice(beforeImages), [f.thumb], source + ': gallery must fetch only the thumbnail');
          if (source === '2333chan') {
            win.setSize(1401, 901); await new Promise(r => setTimeout(r, 100));
            win.setSize(1400, 900); await new Promise(r => setTimeout(r, 250));
            await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
            await new Promise(r => setTimeout(r, 1000));
            fs.writeFileSync(path.join(outputDir, 'imageboards-smoke.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
          }
          await run(`(async () => {
            document.querySelector('.gallery-link').click();
            await waitFor(() => document.querySelector('.media-viewer img')?.src.startsWith('blob:'));
            document.querySelector('.viewer-save').click();
            await waitFor(() => document.querySelector('.viewer-save').disabled);
            await waitFor(() => !document.querySelector('.viewer-save').disabled && document.querySelector('.viewer-save-status')?.textContent.includes('保存完了: 1/1'));
            clickText('閉じる (Esc)');
            clickText('画像の表示を停止');
            await waitFor(() => !document.querySelector('.gallery-thumb'));
            clickText('Thread');
            await waitFor(() => document.querySelector('.post-body'));
          })()`);
          assert.equal(dialogCalls, savesBefore + 1);
          const newFiles = fs.readdirSync(process.env.SMOKE_USER_DATA).filter(file => /\.png$/.test(file) && !filesBefore.includes(file));
          assert.equal(newFiles.length, 1, source + ': viewer must write exactly one image');
          assert.deepEqual(fs.readFileSync(path.join(process.env.SMOKE_USER_DATA, newFiles[0])), fivePng);
          assert.ok(imageboardImageReads.slice(beforeImages).includes(f.image), source + ': fixed-host media route not exercised');
          const resolved = await run(`window.electron.imageboardRequest({ source: '${source}', kind: 'resolve', url: ${JSON.stringify(f.url)} })`);
          assert.deepEqual(resolved, { source, board: f.board, thread: f.thread });
          await run(`(async () => {
            const f = ${JSON.stringify(f)};
            const input = document.querySelector('.url-bar input');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, f.url);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 50));
            document.querySelector('.url-bar').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await new Promise(r => setTimeout(r, 50));
            await waitFor(() => !document.querySelector('.url-bar button').disabled);
            if (document.querySelector('.url-bar [role="alert"]')) throw new Error('Imageboard URL import failed');
            document.querySelectorAll('.library-nav-item')[0].click();
            await waitFor(() => [...document.querySelectorAll('.saved-thread-open')].some(b => b.textContent.includes(f.title)));
            const tabs = document.querySelectorAll('.reader-tab').length;
            [...document.querySelectorAll('.saved-thread-open')].find(b => b.textContent.includes(f.title)).click();
            await waitFor(() => document.querySelector('.post-body')?.textContent.includes(f.body));
            if (document.querySelectorAll('.reader-tab').length !== tabs) throw new Error('Favorite duplicated imageboard tab');
            document.querySelectorAll('.library-nav-item')[2].click();
            await waitFor(() => [...document.querySelectorAll('.saved-thread-open')].some(b => b.textContent.includes(f.title)));
          })()`);
          const beforeOffline = networkReads;
          await run(`(async () => {
            const f = ${JSON.stringify(f)};
            [...document.querySelectorAll('.saved-thread-open')].find(b => b.textContent.includes(f.title)).click();
            await waitFor(() => document.querySelector('.offline-thread')?.textContent.includes(f.body));
            if (document.querySelector('.offline-thread img') || document.querySelector('.offline-thread .translate-block')) throw new Error('Offline imageboard initiated remote content');
          })()`);
          assert.equal(networkReads, beforeOffline, source + ': saved thread must remain offline');
          console.log('PASS: ' + source + ' boards/catalog/posts, favorites, resolve, consent-only blob gallery/viewer/save, and offline saved thread');
        };
        await exerciseImageboard('2333chan');
        await exerciseImageboard('komica');
        allowLain = true;
        await run(`(async () => {
          document.querySelector('[data-source="lainchan"]').click();
          await waitFor(() => document.querySelector('.ptt-age-notice')?.textContent.includes('Lainchan'));
          clickText('18歳以上・利用条件の確認を開く');
          await waitFor(() => document.querySelector('.board-item'));
          if (!(await window.electron.imageboardConsent({ action: 'status' })).accepted) throw new Error('Native Lain confirmation missing');
        })()`);
        assert.equal(lainPrompts, 2);
        await exerciseImageboard('lainchan');
        await run(`(async () => {
          clickText('通常の閲覧に戻る');
          await waitFor(() => !document.querySelector('.offline-thread') && document.querySelector('.image-consent'));
          clickText('画像を読み込む');
          await waitFor(() => document.querySelector('.gallery-thumb')?.src.startsWith('blob:'));
          document.querySelector('.gallery-link').click();
          await waitFor(() => document.querySelector('.media-viewer img')?.src.startsWith('blob:'));
          clickText('Lainchan同意を解除');
          await waitFor(() => !document.querySelector('.media-viewer') && !document.querySelector('.gallery-thumb'));
        })()`);
        await assertLainBlocked('After revoking an open image viewer');
        await run(`(async () => {
          clickText('18歳以上・利用条件の確認を開く');
          await waitFor(() => document.querySelector('.board-item'));
          const savedNav = document.querySelectorAll('.library-nav-item')[2];
          if (savedNav.getAttribute('aria-pressed') !== 'true') savedNav.click();
          await waitFor(() => [...document.querySelectorAll('.saved-thread-open')].some(b => !b.disabled && b.textContent.includes('Lain smoke fixture')));
          [...document.querySelectorAll('.saved-thread-open')].find(b => b.textContent.includes('Lain smoke fixture')).click();
          await waitFor(() => document.querySelector('.offline-thread')?.textContent.includes('Lain synthetic body'));
        })()`);
        assert.equal(lainPrompts, 3);
        const beforeRevoke = networkReads;
        allowLain = false;
        await run(`(async () => {
          clickText('Lainchan同意を解除');
          await waitFor(() => !document.querySelector('.offline-thread') && document.querySelector('.ptt-age-notice'));
          if ((await window.electron.imageboardConsent({ action: 'status' })).accepted) throw new Error('Lain revocation did not reach main process');
          if (document.querySelector('.media-viewer') || document.querySelector('.gallery-thumb') || document.body.textContent.includes('Lain smoke fixture') || document.body.textContent.includes('Lain synthetic body')) throw new Error('Revoked Lain body/title/media still exposed');
          for (const index of [0, 1, 2]) {
            document.querySelectorAll('.library-nav-item')[index].click();
            await new Promise(r => setTimeout(r, 75));
            if (document.body.textContent.includes('Lain smoke fixture') || document.body.textContent.includes('Lain synthetic body')) throw new Error('Library leaked revoked Lain title/body');
          }
        })()`);
        assert.equal(networkReads, beforeRevoke, 'Revocation and gated library views must not fetch');
        await assertLainBlocked('After revocation with populated caches');
        const beforeInvalid = networkReads, dialogsBeforeInvalid = dialogCalls;
        for (const target of [
          { source: 'komica', url: imageboardFixtures.lainchan.image },
          { source: 'lainchan', url: imageboardFixtures.komica.image },
          { source: '2333chan', url: imageboardFixtures.komica.image },
          { source: 'komica', url: 'https://evil.test/fixture.png' },
        ]) {
          const result = await run(`window.electron.saveImages([${JSON.stringify(target)}])`);
          assert.equal(result.status, 'error'); assert.equal(result.saved, 0);
        }
        assert.equal(dialogCalls, dialogsBeforeInvalid, 'Invalid source/host combinations must fail before folder selection');
        assert.equal(networkReads, beforeInvalid);
        assert.equal(lainPrompts, 3, 'No request may implicitly grant or prompt for age consent');
        const beforeCancellation = networkReads;
        try {
          await run(`window.smokeImageId = crypto.randomUUID(); window.smokeImagePending = window.electron.imageboardImage({ id: window.smokeImageId, url: ${JSON.stringify(cancellableImageUrl)} }); true;`);
          const deadline = Date.now() + 3000;
          while (!delayedImageStarted && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
          assert.equal(delayedImageStarted, 1, 'Delayed image must reach the synthetic transport');
          await run('window.electron.cancelImageboardImage(window.smokeImageId)');
          const cancelled = await run(`Promise.race([window.smokeImagePending, new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 3000))])`);
          assert.equal(cancelled.timeout, undefined, 'Cancelled IPC must settle promptly');
          assert.ok(cancelled.error, 'Cancelled IPC must return an error instead of image bytes');
          assert.equal(cancelled.bytes, undefined);
          assert.equal(delayedImageAborted, 1, 'Cancellation must abort the transport, not just hide the result');
          assert.equal(networkReads, beforeCancellation + 1, 'Cancellation must not retry or request another image');
        } finally { releaseDelayedImage?.(); }
        assert.deepEqual(unexpectedNetwork, [], 'Every network request must match a synthetic fixture');
        console.log('PASS: Lain native cancellation/accept/revoke, gated lists/favorites/saved bodies, direct IPC and cached-media denial, and image source allowlist');
        console.log('PASS: cancellable image IPC aborts an in-flight synthetic transport and returns no bytes');
        clearTimeout(timeout);
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  });
  require('../dist-electron/main.js');
}).catch(error => { console.error(error); app.exit(1); });
