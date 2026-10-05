const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(name, overrides = {}) {
  const filename = path.resolve('electron', name + '.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const run = vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename });
  run(id => Object.hasOwn(overrides, id) ? overrides[id] : id.startsWith('./') ? load(id.slice(2), overrides) : require(id), module, module.exports);
  return module.exports;
}
const media = load('five-media');
const five = load('five');
const row = (body = 'hello', date = '2026/10/04 ID:ABC') => `name<>sage<>${date}<>${body}<>title\n`;

test('5ch menu admits only official host/board paths', () => {
  const menu = five.parseMenu('<A HREF=https://egg.5ch.io/software/>Software</A><a href="http://agree.5ch.io/operate/">Operate</a><a href="https://evil.test/software/">evil</a><a href="https://user:pass@egg.5ch.io/bad/">bad</a><a href="https://egg.5ch.io/test/path/">bad</a>');
  assert.deepEqual(menu.map(b => b.board), ['software', 'operate']);
  assert.equal(five.parseFiveUrl('https://egg.5ch.net/test/read.cgi/software/1608930977/l50').thread, 1608930977);
  for (const url of ['https://egg.5ch.io.evil.test/software/', 'file:///software', 'https://egg.5ch.io:444/software/', 'https://egg.5ch.io/software/?url=http://localhost']) assert.equal(five.parseFiveUrl(url), null);
});
test('subject and DAT parsing preserve numbering and extract safe unique images', () => {
  assert.deepEqual(five.parseSubjects('1608930977.dat<>A &amp; B (12)\ninvalid'), [{ no: 1608930977, sub: 'A &amp; B', replies: 12 }]);
  const posts = five.parseDat(row('>>2 https://i.imgur.com/abc1234.png https://i.imgur.com/abc1234.png https://evil.test/image.png') + 'broken\n' + row('あぼーん'));
  assert.equal(posts.length, 3);
  assert.equal(posts[0].id, 'ABC');
  assert.deepEqual(posts[0].media, ['https://i.imgur.com/abc1234.png']);
  assert.equal(posts[2].no, 3);
  assert.throws(() => five.parseDat('<html>challenge</html>'));
});
test('image URL, MIME and signature checks reject redirects targets, SVG and fake images', () => {
  assert.equal(media.normalizeFiveImage('https://i.imgur.com/abc1234.png'), 'https://i.imgur.com/abc1234.png');
  assert.ok(media.normalizeFiveImage('https://i.postimg.cc/abcdefgh/file-name.jpg'));
  for (const u of ['http://i.imgur.com/abc1234.png', 'https://i.imgur.com/abc1234.svg', 'https://i.imgur.com@127.0.0.1/a.png', 'https://i.imgur.com/abc1234.png?x=1', 'https://imgur.com/abc1234', 'https://i.imgur.com:444/abc1234.png']) assert.equal(media.normalizeFiveImage(u), null);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
  assert.doesNotThrow(() => media.validateImage(png, 'image/png', 'https://i.imgur.com/abc1234.png'));
  assert.throws(() => media.validateImage(Buffer.from('<html>'), 'image/png', 'https://i.imgur.com/abc1234.png'));
  assert.throws(() => media.validateImage(png, 'text/html', 'https://i.imgur.com/abc1234.png'));
  const huge = Buffer.from(png); huge.writeUInt32BE(100000, 16);
  assert.throws(() => media.validateImage(huge, 'image/png', 'https://i.imgur.com/abc1234.png'));
  assert.match(media.imageFilename('https://i.imgur.com/abc1234.png'), /^[a-f0-9]{24}\.png$/);
});
test('SSRF protection rejects private and reserved IPv4 before opening a socket', async () => {
  const net = load('network', { 'node:dns/promises': { lookup: async () => [{ address: '127.0.0.1', family: 4 }] } });
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.2', '172.16.1.1', '100.64.1.1', '0.0.0.0', '::1']) assert.equal(net.isPublicIPv4(ip), false);
  assert.equal(net.isPublicIPv4('8.8.8.8'), true);
  await assert.rejects(net.getBytes('https://i.imgur.com/a.png', 8), /Private/);
});
test('5ch cache coalesces repeated reads and validates range updates', async () => {
  const originalNow = Date.now;
  let now = originalNow(); Date.now = () => now;
  const first = Buffer.from(row());
  const second = Buffer.from(row('second'));
  let requests = 0;
  const service = load('five', { './network': { serialQueue: () => work => work(), getBytes: async (url, limit, headers) => {
    requests++;
    assert.equal(limit, 4 * 1024 * 1024);
    if (url.endsWith('bbsmenu.html')) return { status: 200, headers: {}, body: Buffer.from('<a href="https://egg.5ch.io/software/">Software</a>') };
    if (!headers.Range) return { status: 200, headers: {}, body: first };
    assert.equal(headers.Range, `bytes=${first.length - 1}-`);
    return { status: 206, headers: { 'content-range': `bytes ${first.length - 1}-${first.length + second.length - 1}/${first.length + second.length}` }, body: Buffer.concat([Buffer.from('\n'), second]) };
  } } });
  try {
    assert.equal((await service.fiveRequest({ kind: 'posts', board: 'software', thread: 1608930977 })).posts.length, 1);
    await service.fiveRequest({ kind: 'posts', board: 'software', thread: 1608930977 });
    assert.equal(requests, 2);
    now += 11000;
    assert.equal((await service.fiveRequest({ kind: 'posts', board: 'software', thread: 1608930977 })).posts.length, 2);
    assert.equal(requests, 3);
    assert.ok((await service.fiveRequest({ kind: 'posts', board: '../bad', thread: 1 })).error);
    assert.equal(requests, 3);
  } finally { Date.now = originalNow; }
});


test('migration recovery uses only the refreshed official menu and retries once', async () => {
  const calls = []; let menus = 0;
  const service = load('five', { './network': { serialQueue: () => work => work(), getBytes: async url => {
    calls.push(url);
    if (url.endsWith('bbsmenu.html')) return { status: 200, headers: {}, body: Buffer.from('<a href="https://' + (++menus === 1 ? 'old' : 'new') + '.5ch.io/software/">Software</a>') };
    if (url.includes('old.')) throw Object.assign(new Error('Redirect rejected'), { code: 'REDIRECT' });
    assert.equal(new URL(url).hostname, 'new.5ch.io');
    return { status: 200, headers: {}, body: Buffer.from(row()) };
  } } });
  const result = await service.fiveRequest({ kind: 'posts', board: 'software', thread: 1608930977 });
  assert.equal(result.posts.length, 1); assert.equal(menus, 2); assert.equal(calls.length, 4);
});

test('5ch failures distinguish status and do not infer deletion or follow unknown redirects', async () => {
  for (const [status, code] of [[404, 'THREAD_UNAVAILABLE'], [410, 'THREAD_UNAVAILABLE'], [403, 'FORBIDDEN'], [429, 'RATE_LIMITED'], [503, 'SERVER_ERROR'], [302, 'MOVE_UNCONFIRMED']]) {
    let menus = 0;
    const service = load('five', { './network': { serialQueue: () => work => work(), getBytes: async url => {
      if (url.endsWith('bbsmenu.html')) { menus++; return { status: 200, headers: {}, body: Buffer.from('<a href="https://egg.5ch.io/software/">Software</a>') }; }
      if (status === 302) throw Object.assign(new Error('Redirect rejected'), { code: 'REDIRECT' });
      return { status, headers: {}, body: Buffer.alloc(0) };
    } } });
    const result = await service.fiveRequest({ kind: 'posts', board: 'software', thread: 1608930977 });
    assert.equal(result.code, code);
    assert.equal(menus, [404, 410, 302].includes(status) ? 2 : 1);
    await service.fiveRequest({ kind: 'posts', board: 'software', thread: 1608930978 });
    assert.equal(menus, [404, 410, 302].includes(status) ? 2 : 1);
  }
});

test('ImgBB direct images pass the existing allowlist without admitting viewer pages or other hosts', () => {
  const url = 'https://i.ibb.co/w04Prt6/c1f64245afb2.gif';
  assert.equal(media.normalizeFiveImage(url), url);
  assert.deepEqual(media.extractImages(url + ' ' + url), [url]);
  for (const bad of ['https://ibb.co/w04Prt6', 'https://i.ibb.co.evil.test/w04Prt6/a.png', url + '?key=x', url + '#x', 'http://i.ibb.co/w04Prt6/a.png', 'https://i.ibb.co/w04Prt6/a.svg']) assert.equal(media.normalizeFiveImage(bad), null);
});
