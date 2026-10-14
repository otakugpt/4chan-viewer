const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('./helpers/load-main.cjs');
const { createV2exVault } = load('v2ex-credentials');
const { createV2exService } = load('v2ex');
const { parseV2exUrl } = load('v2ex-url');
// Non-credential fixture, deliberately unlike a production token.
const fixtureToken = 'fixture-not-a-real-credential';
const fakeCrypto = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from('encrypted:' + Buffer.from(value).toString('base64')),
  decryptString: value => { assert.ok(value.toString().startsWith('encrypted:')); return Buffer.from(value.toString().slice(10), 'base64').toString(); },
};
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rift-vault-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return path.join(dir, 'token.bin'); }
const response = (result, status = 200, headers = {}) => ({ status, headers, body: Buffer.from(JSON.stringify({ success: true, result })) });
const node = { name: 'python', title: 'Python' };
const root = { id: 123, title: 'API <code>', content: 'if (a < b) & 中文 [link](https://www.v2ex.com/t/124)', created: 1760000000, member: { username: 'Alice' }, node, replies: 3, supplements: [{ content: '追記 <img src=x>' }] };
const reply = id => ({ id, content: 'reply ' + id, created: 1760000001, member: { username: 'Bob' } });

test('vault persists encrypted bytes, never returns token, restores and deletes', t => {
  const file = temp(t);
  let vault = createV2exVault(file, fakeCrypto);
  assert.equal(vault.settings({ kind: 'status' }).configured, false);
  const result = vault.settings({ kind: 'set', token: fixtureToken, persist: true });
  assert.equal(result.persistent, true);
  assert.ok(!JSON.stringify(result).includes(fixtureToken));
  assert.ok(!fs.readFileSync(file).includes(fixtureToken));
  vault = createV2exVault(file, fakeCrypto);
  assert.equal(vault.snapshot().token, fixtureToken);
  assert.equal(vault.settings({ kind: 'set', token: fixtureToken + '-replacement', persist: true }).persistent, true);
  assert.equal(createV2exVault(file, fakeCrypto).snapshot().token, fixtureToken + '-replacement');
  assert.equal(vault.settings({ kind: 'clear' }).configured, false);
  assert.equal(fs.existsSync(file), false);
  assert.equal(vault.snapshot().revision, 2);
});
test('session-only replacement removes previously persisted token; rejects malformed secrets', t => {
  const file = temp(t), vault = createV2exVault(file, fakeCrypto);
  vault.settings({ kind: 'set', token: fixtureToken, persist: true });
  for (const token of ['', 'short', fixtureToken + '\nInjected: true', ' '.repeat(20), 'a'.repeat(513)]) {
    assert.ok(vault.settings({ kind: 'set', token, persist: true }).error);
    assert.equal(vault.snapshot().token, fixtureToken);
  }
  const revision = vault.snapshot().revision;
  vault.settings({ kind: 'set', token: fixtureToken + '-session', persist: false });
  assert.equal(vault.snapshot().revision, revision + 1);
  assert.equal(fs.existsSync(file), false);
  assert.equal(createV2exVault(file, fakeCrypto).snapshot().token, '');
});
test('vault refuses unsafe persistence and corrupt files, but allows recovery', t => {
  const file = temp(t);
  const unsafe = createV2exVault(file, { ...fakeCrypto, getSelectedStorageBackend: () => 'basic_text' });
  assert.ok(unsafe.settings({ kind: 'set', token: fixtureToken, persist: true }).error);
  assert.equal(fs.existsSync(file), false);
  assert.equal(unsafe.settings({ kind: 'set', token: fixtureToken, persist: false }).configured, true);
  fs.writeFileSync(file, 'corrupt');
  const recovered = createV2exVault(file, fakeCrypto);
  assert.ok(recovered.settings({ kind: 'status' }).error);
  assert.equal(recovered.settings({ kind: 'status' }).configured, false);
  assert.equal(recovered.settings({ kind: 'clear' }).error, undefined);
});
test('failed vault writes preserve the previous credential and revision', t => {
  const file = temp(t), vault = createV2exVault(file, { ...fakeCrypto, encryptString: () => { throw new Error(fixtureToken); } });
  vault.settings({ kind: 'set', token: fixtureToken, persist: false });
  const prior = vault.snapshot();
  const result = vault.settings({ kind: 'set', token: fixtureToken + '-new', persist: true });
  assert.ok(result.error);
  assert.ok(!JSON.stringify(result).includes(fixtureToken));
  assert.deepEqual(vault.snapshot(), prior);
});
test('V2EX URL parsing strictly confines internal navigation', () => {
  assert.deepEqual(parseV2exUrl('https://www.v2ex.com/t/123?p=2#reply12'), { board: null, thread: '123' });
  assert.deepEqual(parseV2exUrl('https://v2ex.com/go/machine-learning'), { board: 'machine-learning', thread: null });
  for (const value of [null, 'https://v2ex.com.evil.test/t/123', 'https://evil@v2ex.com/t/123', 'https://v2ex.com:123/t/123', 'https://v2ex.com/t/001', 'https://v2ex.com/go/%2fsecret', 'https://v2ex.com/t/123?token=secret', 'file:///t/123']) assert.equal(parseV2exUrl(value), null);
});
test('public nodes omit credentials, while authenticated endpoints use only fixed GET paths', async () => {
  const calls = [];
  const service = createV2exService(() => ({ token: fixtureToken, revision: 0 }), { spacing: 0, request: async (url, limit, headers) => {
    calls.push(url); assert.equal(limit, 2 * 1024 * 1024);
    if (url.endsWith('/api/nodes/all.json')) { assert.deepEqual(headers, {}); return { ...response([]), body: Buffer.from(JSON.stringify([node])) }; }
    assert.equal(headers.Authorization, 'Bearer ' + fixtureToken);
    assert.equal(url, 'https://www.v2ex.com/api/v2/nodes/python'); return response(node);
  } });
  assert.deepEqual((await service({ kind: 'boards' })).boards, [{ board: 'python', title: 'Python' }]);
  assert.deepEqual(await service({ kind: 'check' }), { connected: true });
  await service({ kind: 'check' }); assert.equal(calls.length, 3);
  for (const input of [{ kind: 'threads', board: '../secret' }, { kind: 'posts', board: 'python', thread: '1?x=2' }, { kind: 'resolve', url: 'https://evil.test/t/1' }, { kind: 'write', content: 'post' }]) assert.ok((await service(input)).error);
  assert.equal(calls.length, 3);
});
test('posts use stable distinct IDs, escaped plain text and opaque bound pagination', async () => {
  let calls = 0;
  const service = createV2exService(() => ({ token: fixtureToken, revision: 0 }), { spacing: 0, request: async url => {
    calls++;
    if (url.endsWith('/topics/123')) return response(root);
    if (url.endsWith('?p=1')) return response([reply(123), reply(124)]);
    if (url.endsWith('?p=2')) return response([reply(124), reply(125)]);
    return response([]);
  } });
  const first = await service({ kind: 'posts', board: 'python', thread: '123' });
  assert.deepEqual(first.posts.map(p => [p.postId, p.order]), [['topic:123', 1], ['reply:123', 2], ['reply:124', 3]]);
  assert.match(first.posts[0].com, /a &lt; b\) &amp; 中文/);
  assert.match(first.posts[0].com, /追記 &lt;img/);
  assert.equal(first.posts[0].media, undefined);
  assert.ok(first.nextCursor);
  assert.ok((await service({ kind: 'posts', board: 'other', thread: '123', cursor: first.nextCursor })).error);
  assert.equal(calls, 2);
  const next = await service({ kind: 'posts', board: 'python', thread: '123', cursor: first.nextCursor });
  assert.deepEqual(next.posts.map(p => [p.postId, p.order]), [['reply:125', 4]]);
  assert.equal((await service({ kind: 'posts', board: 'python', thread: '123', cursor: next.nextCursor })).nextCursor, null);
});
test('repeated pages stop safely and credentials invalidate old cursors and responses', async () => {
  let revision = 0, calls = 0;
  const service = createV2exService(() => ({ token: fixtureToken, revision }), { spacing: 0, request: async () => { calls++; return response([root]); } });
  const first = await service({ kind: 'threads', board: 'python' });
  assert.match((await service({ kind: 'threads', board: 'python', cursor: first.nextCursor })).error, /同じページ/);
  revision++;
  assert.ok((await service({ kind: 'threads', board: 'python', cursor: first.nextCursor })).error);
  assert.equal(calls, 2);
  const inflight = createV2exService(() => ({ token: fixtureToken, revision }), { spacing: 0, request: async () => { revision++; return response(node); } });
  assert.match((await inflight({ kind: 'check' })).error, /接続設定が変更/);
});
test('token absence and all error responses stay generic and exclude sensitive upstream text', async () => {
  const missing = createV2exService(() => ({ token: '', revision: 0 }), { spacing: 0, request: async () => { throw new Error('must not run'); } });
  assert.match((await missing({ kind: 'check' })).error, /トークン/);
  for (const status of [301, 401, 403, 404, 429, 500]) {
    const service = createV2exService(() => ({ token: fixtureToken, revision: 0 }), { spacing: 0, request: async () => response(fixtureToken, status) });
    const result = await service({ kind: 'check' }); assert.ok(result.error); assert.ok(!result.error.includes(fixtureToken));
  }
  for (const request of [async () => { throw new Error(fixtureToken); }, async () => ({ ...response(null), body: Buffer.from(fixtureToken) }), async () => ({ ...response(null), body: Buffer.from(JSON.stringify({ success: false, message: fixtureToken })) })]) {
    const service = createV2exService(() => ({ token: fixtureToken, revision: 0 }), { spacing: 0, request });
    assert.ok(!(await service({ kind: 'check' })).error.includes(fixtureToken));
  }
});
test('quota and Retry-After prevent requests until cooldown expires', async () => {
  let time = 1_000_000, calls = 0;
  const service = createV2exService(() => ({ token: fixtureToken, revision: 0 }), { spacing: 0, now: () => time, request: async () => { calls++; return response(null, 429, { 'retry-after': '120' }); } });
  assert.ok((await service({ kind: 'check' })).error);
  await service({ kind: 'check' }); assert.equal(calls, 1);
  time += 120_001; await service({ kind: 'check' }); assert.equal(calls, 2);
});
test('resolve uses topic canonical node, never fetches a link-supplied host', async () => {
  const service = createV2exService(() => ({ token: fixtureToken, revision: 0 }), { spacing: 0, request: async url => {
    assert.equal(url, 'https://www.v2ex.com/api/v2/topics/123'); return response(root);
  } });
  assert.deepEqual(await service({ kind: 'resolve', url: 'https://hk.v2ex.com/t/123#reply3' }), { board: 'python', thread: '123' });
  assert.match((await service({ kind: 'posts', board: 'wrong', thread: '123' })).error, /一致しません/);
});

test('expired cursors reject before network access, duplicate requests coalesce', async () => {
  let time = 1000, calls = 0;
  const service = createV2exService(() => ({ token: fixtureToken, revision: 0 }), { spacing: 0, now: () => time, request: async () => { calls++; return response([root]); } });
  const results = await Promise.all([service({ kind: 'threads', board: 'python' }), service({ kind: 'threads', board: 'python' })]);
  assert.equal(calls, 1);
  assert.ok(results[0].nextCursor);
  time += 1_800_001;
  assert.match((await service({ kind: 'threads', board: 'python', cursor: results[0].nextCursor })).error, /期限/);
  assert.equal(calls, 1);
});

test('malformed topic identity and mismatched node fail closed; auth failure carries access denial', async () => {
  for (const invalid of [{ ...root, id: [123] }, { ...root, node: { name: '../x', title: 'bad' } }, { ...root, content: null }]) {
    const service = createV2exService(() => ({ token: fixtureToken, revision: 0 }), { spacing: 0, request: async () => response(invalid) });
    assert.ok((await service({ kind: 'posts', board: 'python', thread: '123' })).error);
  }
  const denied = createV2exService(() => ({ token: fixtureToken, revision: 0 }), { spacing: 0, request: async () => response(null, 403) });
  assert.equal((await denied({ kind: 'check' })).accessDenied, true);
});

test('explicit connection checks never report cached authentication success', async () => {
  let calls = 0;
  const service = createV2exService(() => ({ token: fixtureToken, revision: 0 }), { spacing: 0, request: async () => ++calls === 1 ? response(node) : response(null, 401) });
  assert.equal((await service({ kind: 'check' })).connected, true);
  assert.equal((await service({ kind: 'check' })).accessDenied, true);
  assert.equal(calls, 2);
});
