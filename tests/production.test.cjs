const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-main.cjs');
const { runPublicChecks } = require('../scripts/check-public.cjs');
const { createV2exService } = load('v2ex');
const fixtureToken = 'fixture-not-a-real-credential';
const node = { name: 'python', title: 'Private title fixture' };
const topic = { id: 123, node, title: 'Private title fixture', content: 'Private article fixture', replies: 100, member: { username: 'Private author fixture' } };
const reply = id => ({ id, content: 'Private reply fixture', member: { username: 'Private author fixture' } });
const response = result => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify({ success: true, result })) });
function fixture(url) {
  if (url.endsWith('/nodes/python')) return response(node);
  if (url.endsWith('/nodes/python/topics?p=1')) return response([topic]);
  if (url.endsWith('/nodes/python/topics?p=2')) return response([{ ...topic, id: 124 }]);
  if (url.endsWith('/topics/123')) return response(topic);
  if (url.endsWith('/topics/123/replies?p=1')) return response([reply(1)]);
  if (url.endsWith('/topics/123/replies?p=2')) return response([reply(2)]);
  throw new Error('Unexpected fixture request');
}
test('V2EX readiness checks real adapters with six fresh reads and only returns safe counts', async () => {
  const calls = [];
  const service = createV2exService(() => ({ mode: 'authenticated', token: fixtureToken, revision: 0 }), { spacing: 0, request: async (url, limit, headers) => {
    calls.push(url); assert.equal(headers.Authorization, 'Bearer ' + fixtureToken); assert.equal(limit, 2 * 1024 * 1024); return fixture(url);
  } });
  const result = await service({ kind: 'verify', board: 'python' });
  assert.equal(result.verification.checks.length, 5);
  assert.ok(result.verification.checks.every(c => c.status === 'passed'));
  assert.equal(calls.length, 6);
  assert.ok(!JSON.stringify(result).includes('Private')); assert.ok(!JSON.stringify(result).includes(fixtureToken));
  assert.ok((await service({ kind: 'verify', board: 'python' })).verification);
  assert.equal(calls.length, 12);
});
test('readiness never calls empty second pages verified, and stops on rejected/repeated results', async () => {
  const empty = createV2exService(() => ({ mode: 'authenticated', token: fixtureToken, revision: 0 }), { spacing: 0, request: async url => url.endsWith('?p=2') ? response([]) : fixture(url) });
  const checks = (await empty({ kind: 'verify', board: 'python' })).verification.checks;
  assert.equal(checks.find(c => c.id === 'topicPages').status, 'not-tested');
  assert.equal(checks.find(c => c.id === 'replyPages').status, 'not-tested');
  let calls = 0;
  const repeated = createV2exService(() => ({ mode: 'authenticated', token: fixtureToken, revision: 0 }), { spacing: 0, request: async url => { calls++; return url.includes('/nodes/python/topics') ? response([topic]) : fixture(url); } });
  const result = (await repeated({ kind: 'verify', board: 'python' })).verification;
  assert.equal(result.checks[2].status, 'failed'); assert.equal(result.checks[3].status, 'not-tested'); assert.equal(calls, 3);
  const denied = createV2exService(() => ({ mode: 'authenticated', token: fixtureToken, revision: 0 }), { spacing: 0, request: async () => ({ ...response(fixtureToken), status: 401 }) });
  const failure = await denied({ kind: 'verify', board: 'python' });
  assert.equal(failure.verification.accessDenied, true); assert.equal(failure.verification.checks[0].status, 'failed');
  assert.ok(!JSON.stringify(failure).includes(fixtureToken));
});
test('readiness rejects invalid destinations and absent tokens without network', async () => {
  let calls = 0;
  for (const token of ['', fixtureToken]) {
    const service = createV2exService(() => ({ mode: 'authenticated', token, revision: 0 }), { spacing: 0, request: async () => { calls++; throw new Error(); } });
    for (const board of ['../private', 'python?token=x', 'https://evil.test', null]) assert.ok((await service({ kind: 'verify', board })).error);
    if (!token) assert.ok((await service({ kind: 'verify', board: 'python' })).error);
  }
  assert.equal(calls, 0);
});
test('readiness lock rejects overlapping runs and a changed credential discards the entire result', async () => {
  let release, revision = 0, calls = 0;
  const service = createV2exService(() => ({ mode: 'authenticated', token: fixtureToken, revision }), { spacing: 0, request: async url => {
    calls++; if (calls === 1) await new Promise(resolve => { release = resolve; }); return fixture(url);
  } });
  const first = service({ kind: 'verify', board: 'python' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match((await service({ kind: 'verify', board: 'python' })).error, /実行中/);
  revision++; release();
  assert.match((await first).error, /接続設定が変更/); assert.equal(calls, 1);
  assert.ok((await service({ kind: 'verify', board: 'python' })).verification.checks.every(c => c.status === 'passed'));
});
test('authentication checks verify the requested node identity', async () => {
  const service = createV2exService(() => ({ mode: 'authenticated', token: fixtureToken, revision: 0 }), { spacing: 0, request: async () => response({ ...node, name: 'wrong' }) });
  assert.match((await service({ kind: 'check' })).error, /一致しません/);
});
test('V2EX rejects malformed UTF-8 rather than silently altering article text', async () => {
  const body = Buffer.concat([Buffer.from('{"success":true,"result":{"name":"python","title":"'), Buffer.from([255]), Buffer.from('"}}')]);
  const service = createV2exService(() => ({ mode: 'authenticated', token: fixtureToken, revision: 0 }), { spacing: 0, request: async () => ({ status: 200, headers: {}, body }) });
  assert.match((await service({ kind: 'check' })).error, /読み取れません/);
});
test('public check opt-in is mandatory, output omits article content and never grants age consent', async () => {
  const run = require('node:child_process').spawnSync(process.execPath, ['scripts/check-public.cjs'], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 2); assert.match(run.stderr, /allow-network/);
  const seen = [];
  const report = await runPublicChecks({ pause: async () => {}, anonymousAuth: async () => ({ status: 401 }), v2ex: async () => ({ boards: [node] }), ptt: async r => {
    seen.push(r);
    if (r.kind === 'boards') return { boards: [node] };
    if (r.board === 'Beauty') return { status: 'age-confirmation-required' };
    if (r.kind === 'threads') return { threads: [{ threadId: r.cursor ? 'M.122.A.ABC' : 'M.123.A.ABC', sub: 'Private title fixture' }], nextCursor: r.cursor ? null : 'opaque' };
    return { posts: [{ com: 'Private article fixture', media: [] }] };
  } });
  assert.equal(report.checks.length, 7); assert.ok(report.checks.every(c => c.status === 'passed'));
  assert.ok(!JSON.stringify(report).includes('Private')); assert.ok(seen.every(r => ['boards', 'threads', 'posts'].includes(r.kind)));
});
test('public checks stop requesting a site after failure and never echo upstream errors', async () => {
  let calls = 0;
  const report = await runPublicChecks({ pause: async () => {}, anonymousAuth: async () => { throw new Error('must not run'); },
    v2ex: async () => ({ error: fixtureToken }), ptt: async () => { calls++; return { error: fixtureToken }; } });
  assert.equal(calls, 1); assert.equal(report.checks.filter(c => c.status === 'failed').length, 2);
  assert.ok(!JSON.stringify(report).includes(fixtureToken));
});

test('PTT-only checks never call V2EX and stop after any thrown PTT failure', async () => {
  for (let failAt = 1; failAt <= 5; failAt++) {
    let calls = 0, v2exCalls = 0;
    const report = await runPublicChecks({
      v2ex: async () => { v2exCalls++; throw new Error(); }, anonymousAuth: async () => { v2exCalls++; throw new Error(); },
      ptt: async r => {
        if (++calls === failAt) throw new Error(fixtureToken);
        if (r.kind === 'boards') return { boards: [node] };
        if (r.board === 'Beauty') return { status: 'age-confirmation-required' };
        if (r.kind === 'threads') return { threads: [{ threadId: r.cursor ? 'older' : 'first' }], nextCursor: r.cursor ? null : 'cursor' };
        return { posts: [{ com: 'Private article fixture' }] };
      },
    }, { pttOnly: true });
    assert.equal(calls, failAt); assert.equal(v2exCalls, 0); assert.equal(report.checks.length, 5);
    assert.equal(report.checks[failAt - 1].status, 'failed');
    assert.ok(report.checks.slice(failAt).every(c => c.status === 'not-tested'));
    assert.ok(!JSON.stringify(report).includes(fixtureToken)); assert.ok(!JSON.stringify(report).includes('Private'));
  }
});

test('PTT checks do not claim empty or repeated older pages are verified', async () => {
  for (const repeated of [true, false]) {
    let calls = 0;
    const report = await runPublicChecks({ ptt: async r => {
      calls++;
      if (r.kind === 'boards') return { boards: [node] };
      if (r.board === 'Beauty') return { status: 'age-confirmation-required' };
      if (r.kind === 'posts') return { posts: [{}] };
      return { threads: r.cursor && !repeated ? [] : [{ threadId: 'same' }], nextCursor: r.cursor ? null : 'cursor' };
    } }, { pttOnly: true });
    assert.equal(report.checks[2].status, repeated ? 'failed' : 'not-tested');
    assert.equal(calls, repeated ? 3 : 5);
  }
});

test('PTT live CLI rejects missing opt-in, duplicate flags and unknown arguments', () => {
  for (const args of [['--ptt'], ['--allow-network', '--ptt', '--ptt'], ['--allow-network', '--unknown']]) {
    const run = require('node:child_process').spawnSync(process.execPath, ['scripts/check-public.cjs', ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 2); assert.match(run.stderr, /allow-network/);
  }
});
