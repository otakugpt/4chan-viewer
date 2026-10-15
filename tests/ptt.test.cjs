const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-main.cjs');
const f = require('./helpers/ptt-fixtures.cjs');
const parser = load('ptt-parser');
const { createPttService } = load('ptt');
const { parsePttUrl } = load('ptt-url');
const timestamp = '2026-10-15T03:00:00.000Z';

test('PTT URLs allow only canonical public board/article paths', () => {
  assert.deepEqual(parsePttUrl(`https://www.ptt.cc/bbs/Soft_Job/${f.id}.html`), { board: 'Soft_Job', thread: f.id, page: null });
  assert.equal(parsePttUrl('https://www.ptt.cc/bbs/C_Chat/index12.html').page, '12');
  for (const raw of ['https://www.ptt.cc.evil.test/bbs/Soft_Job/index.html', 'https://user@www.ptt.cc/bbs/Soft_Job/index.html', 'http://www.ptt.cc/bbs/Soft_Job/index.html', 'https://www.ptt.cc/bbs/Soft_Job/index.html?q=1', 'https://www.ptt.cc/bbs/a%2fb/index.html', 'https://www.ptt.cc:444/bbs/Soft_Job/index.html']) assert.equal(parsePttUrl(raw), null);
});
test('popular boards and validated older-page links parse; deleted articles are not invented', () => {
  assert.equal(parser.pttBoards(f.boards, false)[0].title, '工程師 & AI');
  const page = parser.pttThreads(f.listing(), 'Soft_Job', null, false);
  assert.equal(page.threads.length, 1); assert.equal(page.previous, '12');
  for (const bad of [f.listing('Other'), f.listing().replace('/bbs/Soft_Job/index12.html', 'https://evil.test/bbs/Soft_Job/index12.html'), f.listing('Soft_Job', '12')]) {
    assert.throws(() => parser.pttThreads(bad, 'Soft_Job', '12', false));
  }
  assert.throws(() => parser.pttThreads('<html>challenge</html>', 'Soft_Job', null, false));
});
test('PTT comments preserve reactions and duplicate comments; body/notes/signature stay separate', () => {
  const same = f.push('推', 'Same', 'identical');
  const posts = parser.pttPosts(f.article('Soft_Job', same + same + f.push('→', 'Other', 'last')), 'Soft_Job', f.id, false, timestamp);
  assert.equal(posts.length, 4);
  assert.equal(posts[1].reaction, '推');
  assert.notEqual(posts[1].postId, posts[2].postId);
  assert.equal(posts[3].date, '10/15 12:34');
  assert.match(posts[0].com, /中文 body &lt;code&gt; &amp;/);
  assert.match(posts[0].com, /【署名】/); assert.match(posts[0].com, /【発信・編集情報】/);
  assert.ok(posts[0].com.includes(timestamp));
  assert.ok(!JSON.stringify(posts).includes('evil.test')); assert.ok(!JSON.stringify(posts).includes('doNotRun'));
  assert.ok(!posts[0].com.includes('identical'));
  const updated = parser.pttPosts(f.article('Soft_Job', f.push('噓', 'New', 'insert') + same + same + f.push('→', 'Other', 'last')), 'Soft_Job', f.id, false, timestamp);
  assert.equal(updated[2].postId, posts[1].postId); assert.equal(updated[4].postId, posts[3].postId);
});
test('HTTP-200 gate hides posts and listing before consent; unknown gate changes fail closed', () => {
  assert.throws(() => parser.pttPosts(f.gate + f.article(), 'Soft_Job', f.id, false, timestamp), parser.PttGate);
  assert.throws(() => parser.pttThreads(f.gate + f.listing(), 'Soft_Job', null, false), parser.PttGate);
  assert.equal(parser.pttPosts(f.gate + f.article(), 'Soft_Job', f.id, true, timestamp).length, 4);
  for (const gate of ['<script>location="/ask/over18"</script>', '<script src="/ask/over18.js"></script>', '<script>location.replace("/verify")</script>', f.gate.replace('over18=1', 'over 18=1'), '<meta http-equiv="refresh" content="0;url=/ask/over18">', '<form action="/ask/over18"></form>']) {
    assert.throws(() => parser.pttPosts(gate + f.article(), 'Soft_Job', f.id, true, timestamp));
  }
});
test('article validation rejects missing metadata, malformed comments and excessive nesting', () => {
  for (const html of ['<div id="main-content">deleted</div>', f.article('Other'), f.article('Soft_Job', f.push('?', 'Name', 'bad')), f.article('Soft_Job', f.push('推', 'Name', 'bad', 'unknown')), '<div>'.repeat(150) + f.article() + '</div>'.repeat(150)]) {
    assert.throws(() => parser.pttPosts(html, 'Soft_Job', f.id, false, timestamp));
  }
});
test('PTT service confines requests, requires issued cursors, caches and coalesces reads', async () => {
  const calls = [];
  const s = createPttService({ spacing: 0, request: async (url, limit, headers) => {
    calls.push(url); assert.deepEqual(headers, {}); assert.equal(limit, 4 * 1024 * 1024);
    assert.ok(url.startsWith('https://www.ptt.cc/bbs/Soft_Job/'));
    return f.response(f.listing('Soft_Job', url.endsWith('index.html') ? '12' : '11'));
  } });
  const [one, two] = await Promise.all([s.request({ kind: 'threads', board: 'Soft_Job' }), s.request({ kind: 'threads', board: 'Soft_Job' })]);
  assert.equal(calls.length, 1); assert.equal(one.threads.length, two.threads.length);
  assert.ok((await s.request({ kind: 'threads', board: 'Other', cursor: one.nextCursor })).error);
  assert.ok((await s.request({ kind: 'threads', board: 'Soft_Job', cursor: '12' })).error);
  const next = await s.request({ kind: 'threads', board: 'Soft_Job', cursor: one.nextCursor });
  assert.equal(next.threads.length, 1); assert.ok(calls[1].endsWith('index12.html'));
  assert.ok((await s.request({ kind: 'posts', board: '../secret', thread: f.id })).error);
  assert.ok((await s.request({ kind: 'posts', board: 'Soft_Job', thread: '123' })).error);
  assert.equal(calls.length, 2);
});
test('age state is session-only; revoke rejects in-flight results and clears cache', async () => {
  const cookies = []; let release;
  const s = createPttService({ spacing: 0, request: async (_url, _limit, headers) => { cookies.push(headers.Cookie); return f.response(f.gate + f.article()); } });
  const input = { kind: 'posts', board: 'Soft_Job', thread: f.id };
  assert.deepEqual(await s.request(input), { status: 'age-confirmation-required' }); assert.equal(s.needsConsent(), true);
  s.setConsent(true); assert.equal((await s.request(input)).posts.length, 4); assert.deepEqual(cookies, [undefined, 'over18=1']);
  s.setConsent(false); assert.equal((await s.request(input)).status, 'age-confirmation-required'); assert.equal(cookies[2], undefined);
  assert.equal(createPttService().status().accepted, false);
  const pending = createPttService({ spacing: 0, request: async () => new Promise(resolve => { release = () => resolve(f.response(f.article())); }) });
  pending.setConsent(true); const request = pending.request(input); await new Promise(r => setImmediate(r));
  pending.setConsent(false); release(); assert.ok((await request).error);
});
test('PTT handles age redirects without following them, respects limits and redacts upstream errors', async () => {
  const gate = createPttService({ spacing: 0, request: async () => { throw Object.assign(new Error('private'), { code: 'REDIRECT', location: '/ask/over18?from=x' }); } });
  assert.equal((await gate.request({ kind: 'threads', board: 'Beauty' })).status, 'age-confirmation-required');
  for (const status of [403, 429, 404, 500]) {
    let calls = 0;
    const s = createPttService({ spacing: 0, request: async () => { calls++; return f.response('private', status, { 'retry-after': '120' }); } });
    const input = { kind: 'threads', board: 'Soft_Job' };
    const result = await s.request(input); assert.ok(result.error); assert.ok(!result.error.includes('private'));
    await s.request(input); if (status === 403 || status === 429) assert.equal(calls, 1);
  }
});

test('PTT rejects non-HTML, malformed UTF-8 and foreign redirects without leaking raw data', async () => {
  for (const request of [async () => f.response('private', 200, { 'content-type': 'application/json' }), async () => ({ ...f.response(''), body: Buffer.from([0xff, 0xfe]) }), async () => { throw Object.assign(new Error('private'), { code: 'REDIRECT', location: 'https://evil.test/ask/over18' }); }]) {
    const s = createPttService({ spacing: 0, request });
    const r = await s.request({ kind: 'threads', board: 'Soft_Job' }); assert.ok(r.error); assert.ok(!JSON.stringify(r).includes('private')); assert.equal(s.needsConsent(), false);
  }
});

test('PTT pagination tokens expire and are invalidated by consent changes', async () => {
  let time = 1000, calls = 0;
  const s = createPttService({ spacing: 0, now: () => time, request: async () => { calls++; return f.response(f.listing()); } });
  const first = await s.request({ kind: 'threads', board: 'Soft_Job' });
  time += 1_800_001;
  assert.ok((await s.request({ kind: 'threads', board: 'Soft_Job', cursor: first.nextCursor })).error);
  const second = await s.request({ kind: 'threads', board: 'Soft_Job' });
  s.setConsent(false);
  assert.ok((await s.request({ kind: 'threads', board: 'Soft_Job', cursor: second.nextCursor })).error);
  assert.equal(calls, 2);
});
