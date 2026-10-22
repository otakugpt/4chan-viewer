const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-main.cjs');
const policy = load('imageboard-policy');
const parser = load('imageboard-parser');
const { createImageboardService } = load('imageboards');
const base = 'https://x.1145141919810.org/ayu/';
const lain = 'https://www.lainchan.org/%CE%BB/';
const image = base + 'src/1608846305810.png';
const lainImage = lain + 'src/1608846305810.png';
const komicaImage = 'https://gita-pix.komica1.org/src/1792677185721.jpg';
const response = (value, status = 200, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
const rows = (no = 1, extra = {}) => ({ posts: [{ no, resto: 0, com: '<p>hello &amp; safe</p>', ...extra }, { no: no + 1, resto: no, com: 'reply' }] });
const catalog = [{ page: 1, threads: [{ no: 1, sub: 'Test', com: '<p>body</p>', replies: 2 }] }];
const input = (extra = {}) => ({ source: '2333chan', kind: 'posts', board: 'ayu', thread: '1', ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));
const komicaPost = (id, op = false, body = 'Body', file = '') => `<div class="post ${op ? 'threadpost' : 'reply'}" data-no="${id}" id="r${id}"><span class="title">Title</span><span class="name">Anon</span><span class="now">2026/10/23</span><input type="checkbox" name="${id}" value="delete"><span class="qlink" data-no="${id}">No.${id}</span>${op ? `<a href="pixmicat.php?res=${id}">Reply</a>` : ''}<div class="quote">${body}</div>${file}<div class="category"><a href="pixmicat.php?mode=category&amp;c=games">Games</a></div></div>`;
const komicaFile = `<div class="file-text"><a href="${komicaImage}">file</a></div><a class="file-thumb" href="thumb_click.php?img=x" data-expanded-image-url="${komicaImage}"><img src="https://gita-pix.komica1.org/thumb/1792677185721s.jpg"></a>`;
const komicaHtml = (next = '1.htm?') => `<div id="threads"><div class="thread" data-no="1">${komicaPost(1, true, 'Body', komicaFile)}${komicaPost(2)}</div></div><a href="${next}">Next</a>`;

test('static allowlists use exact verified hosts, ASCII IDs and board labels', () => {
  assert.equal(policy.IMAGEBOARD_ORIGINS['2333chan'], 'https://x.1145141919810.org');
  assert.equal(policy.IMAGEBOARD_ORIGINS.lainchan, 'https://www.lainchan.org');
  assert.deepEqual(policy.IMAGEBOARD_BOARDS['2333chan'].map(b => b.board), ['ayu','mizuka','kotori','news','pic','saya','TK','int','kyousuke','makoto','yumemi','komari','pani','kud','akane','shiori','haruka','mio','kagari']);
  assert.equal(policy.IMAGEBOARD_BOARDS['2333chan'][0].title, '\u516c\u544a\u30fb\u30d8\u30eb\u30d7');
  assert.ok(Object.isFrozen(policy.IMAGEBOARD_BOARDS['2333chan']));
  for (const [board, path] of [['lambda', '\u03bb'], ['delta', '\u0394'], ['omega', '\u03a9']]) {
    assert.equal(policy.imageboardBoard('lainchan', board).path, path);
    assert.equal(policy.parseImageboardUrl(`https://www.lainchan.org/${path}/res/123.html`).board, board);
  }
});

test('URL policy rejects excluded boards, credentials, redirects, queries and traversal', () => {
  assert.deepEqual(policy.parseImageboardUrl(base + 'res/1.html'), { source: '2333chan', board: 'ayu', thread: '1' });
  for (const anchor of ['#123', '#r123']) {
    assert.equal(policy.parseImageboardUrl(base + 'res/1.html' + anchor).thread, '1');
    assert.equal(policy.parseImageboardUrl('https://gaia.komica1.org/00b/pixmicat.php?res=123' + anchor).thread, '123');
    assert.equal(policy.parseImageboardUrl(base + anchor), null);
  }
  for (const anchor of ['#random', '#r0', '#r01', '#r9007199254740992', '#javascript:evil']) assert.equal(policy.parseImageboardUrl(base + 'res/1.html' + anchor), null);
  assert.deepEqual(policy.parseImageboardUrl('https://gaia.komica1.org/00b/pixmicat.php?res=123'), { source: 'komica', board: '00b', thread: '123' });
  const denied = ['int22','Yui','giru','lucia','hhhh','masato','chihaya','unknown'];
  for (const board of denied) assert.equal(policy.parseImageboardUrl(`https://x.1145141919810.org/${board}/`), null);
  for (const raw of ['https://x.998fun.com/ayu/', base + '?a=1', base + '#', base + '../ayu/', base + '%2e%2e/ayu/', base + 'res/01.html', base + 'res/9007199254740992.html', base.replace('https:', 'http:'), base.replace('https://', 'https://user@'), base.replace('.org/', '.org:443/'), base.replace('.org/', '.org.evil/'), base + 'res/1.json', 'https://gaia.komica1.org/00b/index.htm?', 'https://gaia.komica1.org/00b/pixmicat.php?res=1&mode=admin', 'https://gaia.komica1.org/00b/pixmicat.php?res=1&res=2', 'https://gaia.komica1.org/00b/pixmicat.php?mode=category&c=games', 'https://gita.komica1.org/00b/index.htm']) assert.equal(policy.parseImageboardUrl(raw), null, raw);
});

test('media policy canonicalizes only fixed board paths and timestamp image names', () => {
  assert.equal(policy.normalizeImageboardImage(image), image);
  assert.equal(policy.normalizeImageboardImage(base + 'src/1608846305810-12.webp'), base + 'src/1608846305810-12.webp');
  assert.equal(policy.sourceForImage(lainImage), 'lainchan');
  assert.equal(policy.boardForImage(lainImage), 'lambda');
  assert.equal(policy.boardForImage(komicaImage), '00b');
  assert.equal(policy.normalizeImageboardImage(lainImage.replace('www.', '')), lainImage);
  for (const raw of [null, {}, image + '?download=1', image + '#', image.replace('/ayu/', '/masato/'), image.replace('.png', '.svg'), image.replace('.png', '.webm'), image.replace('1608846305810', 'abc'), image.replace('/src/', '/other/'), image.replace('.org/', '.org:443/'), image.replace('.org/', '.org.evil/'), image.replace('/ayu/', '/ayu/../ayu/'), 'https://gita-pix.komica1.org/other/1792677185721.jpg', 'https://evil.test/src/1792677185721.jpg']) assert.equal(policy.normalizeImageboardImage(raw), null);
});

test('vichan parses multi-file attachments and escaped comments, excludes spoilers', () => {
  const value = rows(1, { sub: '<b>Title &amp;</b>', name: '<b>A</b>', time: 1700000000,
    com: '<script>secret()</script><style>bad</style><p>Hello &lt;img&gt;<br><a href="javascript:bad()">label</a></p>',
    tim: 1608846305810, ext: '.png', tn_w: 100, tn_h: 100,
    extra_files: [{ tim: '1608846305811-2', ext: '.jpg', tn_w: 20, tn_h: 20, thumb_ext: '.jpg' }, { tim: 1608846305812, ext: '.png', spoiler: 1, tn_w: 20, tn_h: 20 }, { tim: 1608846305813, ext: '.webm' }] });
  const [post] = parser.parseVichanPosts(value, '2333chan', 'ayu', '1');
  assert.equal(post.postId, '1'); assert.equal(post.order, 1); assert.equal(post.name, 'A');
  assert.match(post.com, /Hello &lt;img&gt;\nlabel/);
  assert.doesNotMatch(JSON.stringify(post), /secret|javascript|1608846305812|1608846305813/);
  assert.deepEqual(post.media, [image, base + 'src/1608846305811-2.jpg']);
  assert.equal(post.mediaThumbs[image], base + 'thumb/1608846305810.png');
  assert.equal(post.mediaThumbs[base + 'src/1608846305811-2.jpg'], base + 'thumb/1608846305811-2.jpg');
  assert.equal(post.spoiler, true); assert.equal(post.tim, undefined); assert.equal(post.ext, undefined);
});

test('comment links preserve safe destinations, fixed-base relatives and bounded counts', () => {
  const com = '<a href="res/9.html">previous</a> <a href="https://example.test/a?x=1&amp;y=2">external</a> <a href="https://user:pass@example.test/">private</a><a href="data:text/html,evil">bad</a>';
  const [post] = parser.parseVichanPosts(rows(1, { com }), '2333chan', 'ayu', '1');
  assert.match(post.com, /previous https:\/\/x\.1145141919810\.org\/ayu\/res\/9\.html/);
  assert.match(post.com, /external https:\/\/example\.test\/a\?x=1&amp;y=2/);
  assert.doesNotMatch(post.com, /user:pass|data:text/);
  const bounded = parser.safeImageboardComment('<a href="https://example.test/">label</a>'.repeat(150), base);
  assert.equal((bounded.match(/https:/g) || []).length, 100);
  assert.doesNotMatch(parser.safeImageboardComment(`<a href="https://example.test/${'x'.repeat(2100)}">long</a>`, base), /https:/);
  const kp = parser.parseKomicaPosts(`<div id="threads">${komicaPost(1, true, '<a href="pixmicat.php?res=9">previous</a>')}</div>`, '1')[0];
  assert.match(kp.com, /previous https:\/\/gaia\.komica1\.org\/00b\/pixmicat\.php\?res=9/);
});

test('numeric identity validation, deduplication and shape bounds fail closed', () => {
  const duplicate = rows(); duplicate.posts.push({ ...duplicate.posts[1] });
  assert.equal(parser.parseVichanPosts(duplicate, '2333chan', 'ayu', '1').length, 2);
  assert.equal(parser.parseVichanThreads([{ threads: [catalog[0].threads[0], catalog[0].threads[0]] }], '2333chan', 'ayu').length, 1);
  for (const bad of [-1, 1.5, 0, '01', '1e2', '9007199254740992', null]) assert.throws(() => parser.parseVichanPosts({ posts: [{ no: bad }] }, '2333chan', 'ayu', '1'));
  assert.throws(() => parser.parseVichanPosts(rows(2), '2333chan', 'ayu', '1'));
  assert.throws(() => parser.parseVichanPosts({ posts: [{ no: 1 }, { no: 2, resto: 3 }] }, '2333chan', 'ayu', '1'));
  assert.throws(() => parser.parseVichanThreads({}, '2333chan', 'ayu'));
  assert.throws(() => parser.parseVichanThreads([{ threads: [{ no: 1, resto: 2 }] }], '2333chan', 'ayu'));
  assert.throws(() => parser.parseVichanPosts(rows(1, { extra_files: {} }), '2333chan', 'ayu', '1'));
  assert.throws(() => parser.safeImageboardComment('<div>'.repeat(140) + 'body' + '</div>'.repeat(140)));
});

test('Komica handles actual post classes, categories, thumbnails and numeric paging', () => {
  const result = parser.parseKomicaThreads(komicaHtml());
  assert.equal(result.nextCursor, '1'); assert.equal(result.threads.length, 1);
  assert.deepEqual(result.threads[0].categories, ['Games']);
  assert.deepEqual(result.threads[0].media, [komicaImage]);
  assert.equal(result.threads[0].mediaThumbs[komicaImage], 'https://gita-pix.komica1.org/thumb/1792677185721s.jpg');
  assert.equal(parser.parseKomicaThreads(komicaHtml('https://evil.test/1.htm')).nextCursor, null);
  assert.equal(parser.parseKomicaThreads(komicaHtml('1.htm?mode=delete')).nextCursor, null);
  assert.equal(parser.parseKomicaThreads(komicaHtml('3.htm'), '2').nextCursor, '3');
  assert.equal(parser.parseKomicaThreads(komicaHtml('199.htm'), '199').nextCursor, null);
  assert.equal(parser.parseKomicaThreads(komicaHtml('index.htm') + '<form action="1.htm"></form>').nextCursor, '1');
  const posts = parser.parseKomicaPosts(komicaHtml(), '1');
  assert.deepEqual(posts.map(p => p.postId), ['1', '2']);
  assert.deepEqual(posts.map(p => p.order), [1, 2]);
});

test('Komica rejects gates, mismatched IDs and missing markup; hides spoilers', () => {
  for (const html of ['<html>challenge</html>', '<meta http-equiv="refresh" content="0;url=/login">' + komicaHtml(), '<title>Just a moment</title>' + komicaHtml(), komicaHtml().replace('id="r1"', 'id="r99"'), komicaHtml().replace('pixmicat.php?res=1', 'pixmicat.php?res=99')]) assert.throws(() => parser.parseKomicaThreads(html));
  assert.throws(() => parser.parseKomicaPosts(komicaHtml(), '99'));
  const hidden = parser.parseKomicaPosts(`<div id="threads">${komicaPost(1, true, 'body', komicaFile + '<span class="file-spoiler">spoiler</span>')}</div>`, '1')[0];
  assert.deepEqual(hidden.media, []); assert.equal(hidden.spoiler, true); assert.equal(hidden.mediaThumbs, undefined);
  const quoteFile = parser.parseKomicaPosts(`<div id="threads">${komicaPost(1, true, `<a href="${komicaImage}">inline link</a>`)}</div>`, '1')[0];
  assert.deepEqual(quoteFile.media, []);
});

test('static boards and resolve make no requests; all Lain data requires consent', async () => {
  let calls = 0;
  const s = createImageboardService({ request: async () => { calls++; throw Error('unexpected'); } });
  assert.equal((await s.request(input({ kind: 'boards' }))).boards.length, 19);
  assert.equal((await s.request(input({ kind: 'resolve', url: base + 'res/1.html' }))).thread, '1');
  for (const kind of ['boards', 'threads', 'posts', 'resolve']) assert.deepEqual(await s.request(input({ source: 'lainchan', board: 'lambda', kind, url: lain + 'res/1.html' })), { status: 'age-confirmation-required' });
  assert.throws(() => s.assertMediaAccess(lainImage));
  await assert.rejects(s.readMedia(lainImage, 100));
  assert.equal(calls, 0);
  s.setConsent(true); assert.equal(s.status().accepted, true); assert.equal(s.generation(), 1);
  assert.ok((await s.request({ source: 'lainchan', kind: 'boards' })).boards.length);
  assert.equal(calls, 0); s.setConsent(false); assert.equal(s.generation(), 2);
});

test('service validates input before transport and denies cross-source resolve', async () => {
  let calls = 0;
  const s = createImageboardService({ spacing: 0, request: async () => { calls++; return response(catalog); } });
  for (const value of [null, [], {}, input({ source: 'evil' }), input({ board: 'masato' }), input({ thread: '01' }), input({ kind: 'post' }), input({ cursor: '0' }), input({ kind: 'threads', cursor: '0' }), input({ kind: 'resolve', url: 'https://gaia.komica1.org/00b/index.htm' }), { source: 'komica', kind: 'threads', board: '00b', cursor: '../admin' }]) assert.equal((await s.request(value)).accessDenied, true);
  for (const value of ['https://evil.test/src/1608846305810.png', image + '?x=1']) await assert.rejects(s.readMedia(value, 100));
  for (const limit of [0, -1, NaN, Infinity, 100 * 1024 * 1024 + 1]) await assert.rejects(s.readMedia(image, limit));
  assert.equal(calls, 0);
});

test('text cache coalesces reads, has source TTLs and does not expose mutable shared results', async () => {
  let time = 1000, calls = 0;
  const s = createImageboardService({ spacing: 0, now: () => time, request: async (_url, limit, headers) => {
    calls++; assert.equal(limit, 8 * 1024 * 1024); assert.deepEqual(headers, {}); return response(rows());
  } });
  const [one, two] = await Promise.all([s.request(input()), s.request(input())]);
  assert.equal(calls, 1); one.posts[0].com = 'mutated'; assert.notEqual(two.posts[0].com, 'mutated');
  time += 59_999; await s.request(input()); assert.equal(calls, 1);
  time++; await s.request(input()); assert.equal(calls, 2);
  s.setConsent(true); const request = input({ source: 'lainchan', board: 'lambda' });
  await s.request(request); assert.equal(calls, 3);
  time += 119_999; await s.request(request); assert.equal(calls, 3);
  time++; await s.request(request); assert.equal(calls, 4);
});

test('content cache evicts beyond 16 entries and caps total UTF-16 storage', async () => {
  let calls = 0;
  const s = createImageboardService({ spacing: 0, request: async url => { calls++; return response(rows(Number(/res\/(\d+)/.exec(url)[1]))); } });
  for (let n = 1; n <= 17; n++) await s.request(input({ thread: String(n) }));
  await s.request(input()); assert.equal(calls, 18);
  calls = 0;
  const big = createImageboardService({ spacing: 0, request: async url => { calls++; return response({ ...rows(Number(/res\/(\d+)/.exec(url)[1])), padding: 'x'.repeat(2 * 1024 * 1024) }); } });
  for (let n = 1; n <= 5; n++) assert.ok((await big.request(input({ thread: String(n) }))).posts);
  await big.request(input()); assert.equal(calls, 6);
});

test('per-source serialization and default 5s/10s spacing cover text and media together', async () => {
  let time = 1000, active = 0, maximum = 0; const events = [], sleeps = [];
  const s = createImageboardService({ now: () => time, sleep: async ms => { sleeps.push(ms); time += ms; }, request: async url => {
    active++; maximum = Math.max(maximum, active); events.push([url, time]); await tick(); active--;
    return response(url.includes('.json') ? rows() : 'image');
  } });
  await Promise.all([s.request(input()), s.readMedia(image, 100)]);
  assert.equal(maximum, 1); assert.equal(events[1][1] - events[0][1], 5000);
  await s.readMedia(komicaImage, 100); assert.equal(sleeps.length, 1);
  s.setConsent(true); await s.readMedia(lainImage, 100); await s.readMedia(lainImage, 100);
  assert.equal(sleeps.at(-1), 10000);
});

test('same media URL coalesces only in flight, never caches, and large attempts queue separately', async () => {
  let calls = 0; const limits = [];
  const s = createImageboardService({ spacing: 0, request: async (_url, limit) => { calls++; limits.push(limit); await tick(); return response('image'); } });
  await Promise.all([s.readMedia(image, 100), s.readMedia(image, 100)]); assert.equal(calls, 1);
  await s.readMedia(image, 100); assert.equal(calls, 2);
  await Promise.all([s.readMedia(image, 100), s.readMedia(image, 200)]);
  assert.deepEqual(limits, [100, 100, 100, 200]);
});

test('queue accepts 16 pending work items and rejects overflow without fetching', async () => {
  let release, calls = 0;
  const s = createImageboardService({ spacing: 0, request: async url => {
    calls++; if (calls === 1) await new Promise(resolve => { release = resolve; });
    return response(rows(Number(/res\/(\d+)/.exec(url)[1])));
  } });
  const pending = Array.from({ length: 17 }, (_, i) => s.request(input({ thread: String(i + 1) })));
  await tick(); assert.equal(calls, 1); release();
  const result = await Promise.all(pending);
  assert.equal(result.filter(r => r.posts).length, 16); assert.equal(result[16].accessDenied, true); assert.equal(calls, 16);
});

test('consent revision rejects in-flight and queued Lain work, draining without sleeps', async () => {
  let release, calls = 0, sleeps = 0;
  const s = createImageboardService({ sleep: async () => { sleeps++; }, request: async () => { calls++; return new Promise(resolve => { release = () => resolve(response(rows())); }); } });
  s.setConsent(true); const generation = s.generation();
  const first = s.request(input({ source: 'lainchan', board: 'lambda' }));
  const next = s.readMedia(lainImage, 100).catch(error => error);
  await tick(); s.setConsent(false); release();
  assert.equal((await first).accessDenied, true); assert.ok((await next) instanceof Error);
  assert.equal(calls, 1); assert.equal(sleeps, 0);
  s.setConsent(true); assert.throws(() => s.assertMediaAccess(lainImage, generation));
});

test('403/429/503 establish source-wide 5-minute cooldown across text and images', async () => {
  for (const status of [403, 429, 503]) {
    let time = 1000, calls = 0;
    const s = createImageboardService({ spacing: 0, now: () => time, request: async () => { calls++; return response(rows(), calls === 1 ? status : 200); } });
    assert.equal((await s.request(input())).accessDenied, true);
    await assert.rejects(s.readMedia(image, 100)); assert.throws(() => s.assertMediaAccess(image));
    time += 299_999; await s.request(input()); assert.equal(calls, 1);
    time++; assert.ok((await s.request(input())).posts); assert.equal(calls, 2);
  }
});

test('Retry-After dates, seconds and overflow remain finite and fail closed', async () => {
  for (const retry of ['600', new Date(601000).toUTCString(), '9'.repeat(400)]) {
    let time = 1000, calls = 0;
    const s = createImageboardService({ spacing: 0, now: () => time, request: async () => { calls++; return response(rows(), calls === 1 ? 429 : 200, { 'Retry-After': retry }); } });
    await s.request(input()); time = 600999; await s.request(input()); assert.equal(calls, 1);
    time = 601000; await s.request(input()); assert.equal(calls, retry.length > 100 ? 1 : 2);
    if (retry.length > 100) { time = 1e12; await s.request(input()); assert.equal(calls, 1); }
  }
});

test('oversized access-denial errors honor Retry-After before consent revocation checks', async () => {
  let release, calls = 0, time = 1000;
  const s = createImageboardService({ spacing: 0, now: () => time, request: async () => {
    calls++; return new Promise((_resolve, reject) => { release = () => reject(Object.assign(new Error('private'), { code: 'RESPONSE_TOO_LARGE', status: 403, headers: { 'retry-after': '900' }, limit: 100, size: 101, exact: true })); });
  } });
  s.setConsent(true); const work = s.readMedia(lainImage, 100).catch(e => e);
  await tick(); s.setConsent(false); release(); await work; s.setConsent(true);
  time += 899999; await assert.rejects(s.readMedia(lainImage, 100)); assert.equal(calls, 1);
});

test('cooldown drains queued work before spacing and remains source isolated', async () => {
  let calls = 0, sleeps = 0;
  const s = createImageboardService({ sleep: async () => { sleeps++; }, request: async url => { calls++; return response('denied', url.includes('gita-pix') ? 200 : 503); } });
  const works = Array.from({ length: 8 }, (_, i) => s.request(input({ thread: String(i + 1) })));
  await Promise.all(works); assert.equal(calls, 1); assert.equal(sleeps, 0);
  await s.readMedia(komicaImage, 100); assert.equal(calls, 2);
});

test('only status-200 structured size errors survive media transport handling', async () => {
  const good = createImageboardService({ spacing: 0, request: async (_url, limit) => { throw Object.assign(new Error('private'), { code: 'RESPONSE_TOO_LARGE', status: 200, limit, size: 101, exact: false }); } });
  await assert.rejects(good.readMedia(image, 100), error => error.code === 'RESPONSE_TOO_LARGE' && error.status === 200 && error.limit === 100 && error.size === 101 && error.exact === false && !error.message.includes('private'));
  for (const status of [302, 404, 403]) {
    const s = createImageboardService({ spacing: 0, request: async (_url, limit) => { throw Object.assign(new Error('private'), { code: 'RESPONSE_TOO_LARGE', status, limit, size: 101, exact: true }); } });
    await assert.rejects(s.readMedia(image, 100), error => error.code !== 'RESPONSE_TOO_LARGE' && !error.message.includes('private'));
  }
});

test('oversize returned bodies, MIME, UTF-8, malformed JSON and redirects fail closed', async () => {
  const bad = [() => response(rows(), 302, { location: 'https://evil.test' }), () => response(rows(), 200, { 'content-type': 'text/html' }), () => ({ ...response(''), body: Buffer.from([255]) }), () => response('{bad'), () => response('x'.repeat(8 * 1024 * 1024 + 1)), () => response(rows(), 200, { 'content-encoding': 'gzip' })];
  for (const make of bad) {
    let calls = 0;
    const s = createImageboardService({ spacing: 0, request: async () => { calls++; return make(); } });
    const result = await s.request(input()); assert.equal(result.accessDenied, true); assert.equal(calls, 1);
  }
  const s = createImageboardService({ spacing: 0, request: async () => response('x'.repeat(101)) });
  await assert.rejects(s.readMedia(image, 100), error => error.code === 'RESPONSE_TOO_LARGE' && error.status === 200);
});

test('Komica service follows only bounded numeric board paging and thread GET URLs', async () => {
  const urls = [];
  const s = createImageboardService({ spacing: 0, getBytes: async (url, _limit, headers) => { urls.push(url); assert.deepEqual(headers, {}); return response(komicaHtml(), 200, { 'content-type': 'text/html; charset=utf-8' }); } });
  const req = { source: 'komica', kind: 'threads', board: '00b' };
  assert.equal((await s.request(req)).nextCursor, '1');
  assert.ok((await s.request({ ...req, cursor: '1' })).threads);
  assert.ok((await s.request({ ...req, kind: 'posts', thread: '1' })).posts);
  assert.deepEqual(urls, ['https://gaia.komica1.org/00b/index.htm', 'https://gaia.komica1.org/00b/1.htm', 'https://gaia.komica1.org/00b/pixmicat.php?res=1']);
  for (const cursor of ['01', '-1', '200', '1?mode=admin']) assert.equal((await s.request({ ...req, cursor })).accessDenied, true);
  assert.equal(urls.length, 3);
});

test('consent changes actively abort Lain text and media and rotate the transport signal', async () => {
  for (const kind of ['text', 'media']) {
    let signal, calls = 0, aborts = 0;
    const s = createImageboardService({ spacing: 0, request: async (_url, _limit, _headers, cancel) => {
      calls++; signal = cancel;
      assert.ok(cancel instanceof AbortSignal); assert.equal(cancel.aborted, false);
      if (calls > 1) return response(rows());
      return new Promise((_resolve, reject) => cancel.addEventListener('abort', () => {
        aborts++; reject(new Error('private transport abort detail'));
      }, { once: true }));
    } });
    s.setConsent(true);
    const start = () => kind === 'text' ? s.request(input({ source: 'lainchan', board: 'lambda' })) : s.readMedia(lainImage, 1000);
    const work = start().catch(error => error);
    await tick(); const oldSignal = signal; s.setConsent(false);
    assert.equal(oldSignal.aborted, true); assert.equal(aborts, 1);
    const result = await work;
    assert.ok(kind === 'text' ? result.accessDenied : result instanceof Error);
    assert.doesNotMatch(kind === 'text' ? result.error : result.message, /private transport/);
    s.setConsent(true); await start(); assert.notEqual(signal, oldSignal); assert.equal(signal.aborted, false);
  }
});

test('consumer cancellation reaches active media transport and combines with Lain consent', async () => {
  for (const url of [image, lainImage]) {
    const caller = new AbortController(); let signal, aborts = 0;
    const s = createImageboardService({ spacing: 0, request: async (_url, _limit, _headers, cancel) => {
      signal = cancel;
      return new Promise((_resolve, reject) => cancel.addEventListener('abort', () => { aborts++; reject(cancel.reason); }, { once: true }));
    } });
    s.setConsent(true);
    const work = s.readMedia(url, 100, caller.signal).catch(error => error);
    await tick(); caller.abort(new Error('private caller reason'));
    const result = await work;
    assert.equal(signal.aborted, true); assert.equal(aborts, 1); assert.ok(result instanceof Error);
    assert.doesNotMatch(result.message, /private caller/); assert.equal(s.status().accepted, true);
  }
  const caller = new AbortController(); let signal;
  const s = createImageboardService({ spacing: 0, request: async (_url, _limit, _headers, cancel) => {
    signal = cancel;
    return new Promise((_resolve, reject) => cancel.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  s.setConsent(true); const work = s.readMedia(lainImage, 100, caller.signal).catch(error => error);
  await tick(); s.setConsent(false); await work;
  assert.equal(signal.aborted, true); assert.equal(caller.signal.aborted, false);
});

test('cancellable callers never share transfers with each other or uncancelled reads', async () => {
  for (const secondHasSignal of [false, true]) {
    const first = new AbortController(), second = new AbortController(); let calls = 0;
    const s = createImageboardService({ spacing: 0, request: async (_url, _limit, _headers, cancel) => {
      calls++;
      if (calls === 1) return new Promise((_resolve, reject) => cancel.addEventListener('abort', () => reject(Error('cancelled')), { once: true }));
      assert.equal(cancel?.aborted ?? false, false); return response('image');
    } });
    const one = s.readMedia(image, 100, first.signal).catch(error => error);
    const two = s.readMedia(image, 100, secondHasSignal ? second.signal : undefined);
    await tick(); first.abort();
    assert.ok((await one) instanceof Error); assert.equal((await two).status, 200);
    assert.equal(calls, 2); assert.equal(second.signal.aborted, false);
  }
});

test('pre-aborted and queued cancelled media never reach the transport', async () => {
  let calls = 0, release;
  const s = createImageboardService({ spacing: 0, request: async () => {
    calls++; return new Promise(resolve => { release = () => resolve(response('image')); });
  } });
  const pre = new AbortController(); pre.abort();
  await assert.rejects(s.readMedia(image, 100, pre.signal)); assert.equal(calls, 0);
  const active = s.readMedia(image, 100);
  const queued = new AbortController();
  const work = s.readMedia(image, 100, queued.signal).catch(error => error);
  await tick(); queued.abort(); release();
  await active; assert.ok((await work) instanceof Error); assert.equal(calls, 1);
});

test('cancellation interrupts default throttle timers and releases the queue promptly', { timeout: 2000 }, async () => {
  for (const url of [image, lainImage]) {
    let calls = 0;
    const s = createImageboardService({ spacing: 60_000, request: async () => { calls++; return response('image'); } });
    s.setConsent(true); await s.readMedia(url, 100);
    const caller = new AbortController();
    const work = s.readMedia(url, 100, caller.signal).catch(error => error);
    await tick();
    if (url === lainImage) s.setConsent(false); else caller.abort();
    assert.ok((await work) instanceof Error); assert.equal(calls, 1);
  }
});

test('aborted 403 errors retain Retry-After before cancellation is redacted', async () => {
  let time = 1000, calls = 0;
  const s = createImageboardService({ spacing: 0, now: () => time, request: async (_url, _limit, _headers, signal) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error('private aborted response'), {
      status: 403, headers: { 'retry-after': '900' },
    })), { once: true }));
  } });
  const caller = new AbortController();
  const work = s.readMedia(image, 100, caller.signal).catch(error => error);
  await tick(); caller.abort(); const error = await work;
  assert.doesNotMatch(error.message, /private aborted response/);
  time += 899999; await assert.rejects(s.readMedia(image, 100)); assert.equal(calls, 1);
});
