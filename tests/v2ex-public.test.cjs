const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { load } = require('./helpers/load-main.cjs');
const { createV2exService } = load('v2ex');
const { createV2exVault } = load('v2ex-credentials');
const { parsePublicFeed, publicHtmlText, publicReplies } = load('v2ex-public');
const f = require('./helpers/v2ex-public-fixtures.cjs');
const token = 'fixture-not-a-real-credential';
const threads = { kind: 'threads', board: 'python' };
const posts = { kind: 'posts', board: 'python', thread: '123' };
const make = (request, extra = {}, snapshot = () => ({ token, revision: 0 })) => createV2exService(snapshot, { spacing: 0, request, ...extra });

test('public is the default even with a saved token; only explicit replies access the old API', async () => {
  const calls = [];
  const service = make(async (url, limit, headers) => {
    assert.equal(limit, 2 * 1024 * 1024); assert.deepEqual(headers, {}); calls.push(url);
    if (url === 'https://www.v2ex.com/feed/python.json') return f.response(f.feed());
    assert.equal(url, 'https://www.v2ex.com/api/replies/show.json?topic_id=123'); return f.response(f.replies);
  });
  const listing = await service(threads);
  assert.equal(listing.publicOnly, true); assert.equal(listing.nextCursor, null); assert.equal(listing.threads[0].replies, undefined);
  const root = await service(posts);
  assert.equal(root.posts.length, 1); assert.ok(root.nextCursor); assert.equal(calls.length, 1);
  assert.deepEqual(root.posts[0].media, []); assert.match(root.posts[0].com, /&lt;code&gt; &amp;/);
  assert.ok(!root.posts[0].com.includes('secretScript')); assert.ok(!root.posts[0].com.includes('evil.test'));
  const result = await service({ ...posts, cursor: root.nextCursor });
  assert.equal(result.posts.length, 1); assert.equal(result.posts[0].postId, 'reply:10'); assert.equal(result.nextCursor, null);
  assert.equal(calls.length, 2);
  await service({ ...posts, cursor: root.nextCursor }); assert.equal(calls.length, 2);
});

test('public mode never checks authenticated API, resolves unknown topics, or follows a supplied cursor', async () => {
  let calls = 0;
  const service = make(async () => { calls++; return f.response(f.feed()); });
  for (const request of [{ kind: 'check' }, { kind: 'verify', board: 'python' }, { ...threads, board: '../private' },
    { ...threads, cursor: 'p=2' }, { ...posts, thread: '1?token=x' }, { ...posts, cursor: '123' },
    { kind: 'resolve', url: 'https://www.v2ex.com/t/999' }, { kind: 'resolve', url: 'https://evil.test/go/python' }]) assert.ok((await service(request)).error);
  assert.equal(calls, 0);
  await service(threads);
  assert.deepEqual(await service({ kind: 'resolve', url: 'https://www.v2ex.com/t/123' }), { board: 'python', thread: '123' });
  assert.ok((await service({ ...posts, thread: '999' })).error); assert.equal(calls, 1);
});

test('reply cursors are bound to board, topic, generation and expiry', async () => {
  let calls = 0, time = 1_000_000, revision = 0;
  const service = make(async () => { calls++; return f.response(f.feed()); }, { now: () => time }, () => ({ token: '', revision, mode: 'public' }));
  const first = await service(posts);
  for (const bad of [{ board: 'other' }, { thread: '124' }, { kind: 'threads' }]) assert.ok((await service({ ...posts, cursor: first.nextCursor, ...bad })).error);
  assert.equal(calls, 1);
  time += 600_001; assert.ok((await service({ ...posts, cursor: first.nextCursor })).error); assert.equal(calls, 1);
  const second = await service(posts); revision++;
  assert.ok((await service({ ...posts, cursor: second.nextCursor })).error); assert.equal(calls, 2);
});

test('cache lasts ten minutes, coalesces requests, and does not retain expired article membership', async () => {
  let calls = 0, time = 1_000_000;
  const service = make(async () => f.response(f.feed('python', ++calls === 1 ? [f.item()] : [])), { now: () => time });
  await Promise.all([service(threads), service(threads)]); assert.equal(calls, 1);
  time += 599_999; await service(posts); assert.equal(calls, 1);
  time += 2; assert.ok((await service(posts)).error); assert.equal(calls, 2);
  assert.ok((await service({ kind: 'resolve', url: 'https://www.v2ex.com/t/123' })).error);
});

test('in-flight mode changes discard the response; auth rejection has no public fallback', async () => {
  let revision = 0, mode = 'public', calls = 0;
  const service = make(async () => { calls++; revision++; mode = 'authenticated'; return f.response(f.feed()); }, {}, () => ({ revision, mode, token }));
  assert.match((await service(threads)).error, /接続設定が変更/); assert.equal(calls, 1);
  calls = 0;
  const denied = make(async url => { calls++; assert.ok(url.includes('/api/v2/')); return f.response({}, 403); }, {}, () => ({ revision: 0, mode: 'authenticated', token }));
  assert.equal((await denied(threads)).accessDenied, true); assert.equal(calls, 1);
});

test('public denials, redirects, HTML challenges and malformed JSON stop later public reads, including cached data', async () => {
  const bad = [f.response({}, 401), f.response({}, 403), f.response({}, 302), f.response('<html>captcha</html>', 200, { 'content-type': 'text/html' }),
    { ...f.response({}), body: Buffer.from('not json') }, { ...f.response({}), body: Buffer.from([255]) }, Object.assign(new Error('private'), { code: 'REDIRECT' })];
  for (const response of bad) {
    let calls = 0;
    const service = make(async () => { if (++calls === 1) return f.response(f.feed()); if (response instanceof Error) throw response; return response; });
    const root = await service(posts);
    assert.ok((await service({ ...posts, cursor: root.nextCursor })).error);
    assert.ok((await service(threads)).error); assert.equal(calls, 2);
  }
});

test('public rate limits honor long numeric or HTTP-date Retry-After without capping the wait', async () => {
  for (const retryAfter of ['7200', new Date(1_000_000 + 7_200_000).toUTCString()]) {
    let time = 1_000_000, calls = 0;
    const service = make(async () => { calls++; return calls === 1 ? f.response({}, 429, { 'retry-after': retryAfter }) : f.response(f.feed()); }, { now: () => time });
    assert.ok((await service(threads)).error); time += 3_600_001;
    assert.ok((await service(threads)).error); assert.equal(calls, 1);
    time += 3_600_000; assert.ok((await service(threads)).threads); assert.equal(calls, 2);
  }
});

test('feed validation rejects mismatched IDs, nodes, duplicates and unbounded or invalid data', () => {
  for (const invalid of [{ ...f.feed(), home_page_url: 'https://evil.test/go/python' }, { ...f.feed(), feed_url: 'https://evil.test/feed/python.json' },
    { ...f.feed(), version: 'unknown' }, f.feed('python', [f.item(), f.item()]), f.feed('python', [{ ...f.item(), url: 'https://www.v2ex.com/t/124' }]),
    f.feed('python', [{ ...f.item(), deleted: true }]), f.feed('python', [{ ...f.item(), date_published: 'invalid' }]),
    f.feed('python', [{ ...f.item(), content_html: 'x'.repeat(200_001) }]), f.feed('python', Array(201).fill(f.item()))]) assert.throws(() => parsePublicFeed(invalid, 'python'));
  assert.equal(parsePublicFeed(f.feed('python', [{ ...f.item(), id: 'https://www.v2ex.com/t/123', content_html: '' }]), 'python').posts.size, 1);
});

test('HTML conversion is inert, preserves code/newlines and safe link text, and bounds tree complexity', () => {
  const value = publicHtmlText('<p>&lt;b&gt; &amp;</p><p><a href="/t/123">next</a></p><a href="javascript:alert(1)">label</a><form>hidden</form><svg>hidden</svg><iframe>hidden</iframe>');
  assert.match(value, /<b> &\n/); assert.match(value, /https:\/\/www.v2ex.com\/t\/123/);
  assert.ok(!/hidden|javascript/.test(value));
  assert.throws(() => publicHtmlText('<div>'.repeat(110) + 'deep' + '</div>'.repeat(110)));
});

test('public reply parsing rejects foreign topics and duplicates without exposing raw upstream text', async () => {
  for (const invalid of [[{ ...f.replies[0], topic_id: 999 }], [f.replies[0], f.replies[0]], [{ ...f.replies[0], content: null }], [{ ...f.replies[0], created: 'bad' }]]) assert.throws(() => publicReplies(invalid, '123'));
  const service = make(async () => { throw new Error(token); });
  assert.ok(!(await service(threads)).error.includes(token));
});

test('mode is persisted separately from credentials; token setting/clearing never changes it', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rift-public-vault-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'token.bin'), crypto = { isEncryptionAvailable: () => false };
  const vault = createV2exVault(file, crypto);
  assert.equal(vault.settings({ kind: 'status' }).mode, 'public');
  assert.equal(vault.settings({ kind: 'set', token, persist: false }).mode, 'public');
  assert.equal(vault.settings({ kind: 'mode', mode: 'authenticated' }).mode, 'authenticated');
  assert.equal(createV2exVault(file, crypto).settings({ kind: 'status' }).mode, 'authenticated');
  assert.equal(vault.settings({ kind: 'clear' }).mode, 'authenticated');
  assert.ok(!fs.readFileSync(file + '.mode.json', 'utf8').includes(token));
  assert.equal(vault.settings({ kind: 'mode', mode: 'public' }).mode, 'public');
  assert.ok(vault.settings({ kind: 'mode', mode: 'invalid' }).error);
  fs.writeFileSync(file + '.mode.json', 'corrupt');
  assert.equal(createV2exVault(file, crypto).settings({ kind: 'status' }).mode, 'public');
});
