const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
const { load } = require('./helpers/load-main.cjs');
const url = 'https://x.1145141919810.org/ayu/src/1608846305810.png';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
const response = () => ({ status: 200, headers: { 'content-type': 'image/png' }, body: png });
const normal = 20 * 1024 * 1024, hard = 100 * 1024 * 1024;
const policy = { normalizeImageboardImage: raw => raw === url ? url : null };
function setup(readMedia, overrides = {}) {
  let revision = 0, allowed = true;
  const service = { generation: () => revision, assertMediaAccess: (_url, rev) => {
    if (!allowed || rev !== undefined && rev !== revision) throw new Error('Access revoked');
  }, readMedia };
  const { createImageboardMedia } = load('imageboard-media', { './imageboard-policy': policy, ...overrides });
  return { media: createImageboardMedia(service), revoke() { allowed = false; revision++; }, grant() { allowed = true; revision++; } };
}
function tooLarge(limit, size = normal + 1, exact = true) { return Object.assign(new Error('oversize'), { code: 'RESPONSE_TOO_LARGE', status: 200, limit, size, exact }); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const aborted = { name: 'AbortError' };

test('imageboard images coalesce normal reads and reuse bounded small-image cache', async () => {
  let calls = 0;
  const { media } = setup(async (u, limit) => { calls++; assert.equal(u, url); assert.equal(limit, normal); return response(); });
  const [one, two] = await Promise.all([media.read(url), media.read(url)]);
  assert.equal(calls, 1); assert.deepEqual(one, two);
  await media.read(url); assert.equal(calls, 1);
  media.clear(); await media.read(url); assert.equal(calls, 2);
  await assert.rejects(media.read('https://127.0.0.1/p.png')); assert.equal(calls, 2);
});

test('revoked access blocks cached and in-flight image results', async () => {
  const cached = setup(async () => response());
  await cached.media.read(url); cached.revoke(); await assert.rejects(cached.media.read(url));
  let release;
  const running = setup(() => new Promise(resolve => { release = resolve; }));
  const task = running.media.read(url); running.revoke(); release(response());
  await assert.rejects(task); running.grant();
});

test('large image approval is per caller, never cached, with a 100MiB hard limit', async () => {
  const calls = [], approvals = [];
  const { media } = setup(async (_url, limit) => { calls.push(limit); if (limit === normal) throw tooLarge(limit, normal + 5, false); return response(); });
  await assert.rejects(media.read(url)); assert.deepEqual(calls, [normal]);
  await media.read(url, async info => { approvals.push(info); return true; });
  assert.equal(approvals[0].exact, false); assert.equal(approvals[0].size, normal + 5);
  await assert.rejects(media.read(url, async () => false));
  assert.deepEqual(calls, [normal, normal, hard, normal]);
  let prompts = 0;
  const huge = setup(async (_u, limit) => { throw tooLarge(limit, hard + 1); });
  await assert.rejects(huge.media.read(url, async () => { prompts++; return true; })); assert.equal(prompts, 0);
  const growing = setup(async (_u, limit) => { throw tooLarge(limit, limit + 1); });
  await assert.rejects(growing.media.read(url, async () => true), /100MB/);
});

test('consent revocation while a large-image warning is open prevents its retry', async () => {
  let calls = 0;
  const f = setup(async (_u, limit) => { calls++; throw tooLarge(limit); });
  await assert.rejects(f.media.read(url, async () => { f.revoke(); return true; }));
  assert.equal(calls, 1);
});

test('image signatures, MIME, dimensions and status remain enforced', async () => {
  for (const bad of [
    { ...response(), status: 403 },
    { ...response(), headers: { 'content-type': 'text/html' } },
    { ...response(), body: Buffer.from('<html>challenge</html>') },
  ]) await assert.rejects(setup(async () => bad).media.read(url));
  const giant = Buffer.from(png); giant.writeUInt32BE(17000, 16);
  await assert.rejects(setup(async () => ({ ...response(), body: giant })).media.read(url));
});

test('image saves exclusively create files and check access again before writing', async () => {
  let writes = 0, removed = 0;
  let f;
  f = setup(async () => response(), { 'node:fs/promises': { open: async (_path, flags) => {
    assert.equal(flags, 'wx'); f.revoke();
    return { writeFile: async () => { writes++; }, close: async () => {} };
  }, unlink: async () => { removed++; } } });
  await assert.rejects(f.media.download(url, 'fixture.png'));
  assert.equal(writes, 0); assert.equal(removed, 1);
});

test('aborting one consumer promptly rejects it without stopping another consumer', { timeout: 2000 }, async () => {
  const fetch = deferred(), first = new AbortController(), second = new AbortController();
  let calls = 0, transportSignal;
  const { media } = setup((_url, limit, cancel) => {
    calls++; assert.equal(limit, normal); transportSignal = cancel; return fetch.promise;
  });
  const one = media.read(url, undefined, first.signal);
  const two = media.read(url, undefined, second.signal);
  const rejected = assert.rejects(one, aborted);
  first.abort(); await rejected;
  assert.equal(calls, 1); assert.equal(transportSignal.aborted, false);
  assert.equal(getEventListeners(first.signal, 'abort').length, 0);
  fetch.resolve(response()); assert.deepEqual((await two).bytes, png);
  assert.equal(getEventListeners(second.signal, 'abort').length, 0);
  assert.equal(getEventListeners(transportSignal, 'abort').length, 0);
  await media.read(url); assert.equal(calls, 1);
});

test('last consumer abort stops the fetch immediately and replacement gets fresh work', { timeout: 2000 }, async () => {
  const requests = [], cancel = new AbortController();
  const { media } = setup((_url, _limit, signal) => {
    const fetch = deferred(); requests.push({ ...fetch, signal }); return fetch.promise;
  });
  const rejected = assert.rejects(media.read(url, undefined, cancel.signal), aborted);
  cancel.abort(); assert.equal(requests[0].signal.aborted, true);
  const fresh = media.read(url);
  assert.equal(requests.length, 2);
  await rejected;
  // A transport that ignores abort must neither cache its result nor remove the replacement.
  requests[0].resolve(response()); await tick();
  const joined = media.read(url); assert.equal(requests.length, 2);
  requests[1].resolve(response()); await Promise.all([fresh, joined]);
  assert.equal(getEventListeners(cancel.signal, 'abort').length, 0);
  assert.equal(getEventListeners(requests[0].signal, 'abort').length, 0);
});

test('aborted fetch results are not cached even without a replacement in flight', { timeout: 2000 }, async () => {
  const fetch = deferred(), cancel = new AbortController(); let calls = 0;
  const { media } = setup(() => ++calls === 1 ? fetch.promise : Promise.resolve(response()));
  const rejected = assert.rejects(media.read(url, undefined, cancel.signal), aborted);
  cancel.abort(); await rejected;
  fetch.resolve(response()); await tick();
  await media.read(url); assert.equal(calls, 2);
});

test('an uncancelled download holds a shared fetch when its display consumer aborts', { timeout: 2000 }, async () => {
  const fetch = deferred(), cancel = new AbortController(); let signal, calls = 0, writes = 0;
  const { media } = setup((_url, _limit, value) => { signal = value; calls++; return fetch.promise; }, {
    'node:fs/promises': { open: async (_path, flags) => {
      assert.equal(flags, 'wx');
      return { writeFile: async bytes => { assert.deepEqual(bytes, png); writes++; }, close: async () => {} };
    } },
  });
  const rejected = assert.rejects(media.read(url, undefined, cancel.signal), aborted);
  const saving = media.download(url, 'fixture.png');
  cancel.abort(); await rejected;
  assert.equal(signal.aborted, false); assert.equal(calls, 1);
  fetch.resolve(response()); await saving; assert.equal(writes, 1);
});

test('clear aborts shared pending fetches and allows immediate refetch without stale caching', { timeout: 2000 }, async () => {
  const requests = [], cancel = new AbortController();
  const { media } = setup((_url, _limit, signal) => {
    const fetch = deferred(); requests.push({ ...fetch, signal }); return fetch.promise;
  });
  const one = assert.rejects(media.read(url, undefined, cancel.signal), aborted);
  const two = assert.rejects(media.read(url), aborted);
  media.clear(); assert.equal(requests[0].signal.aborted, true);
  const fresh = media.read(url); assert.equal(requests.length, 2);
  await Promise.all([one, two]);
  assert.equal(getEventListeners(cancel.signal, 'abort').length, 0);
  requests[0].resolve(response()); await tick();
  const joined = media.read(url); assert.equal(requests.length, 2);
  requests[1].resolve(response()); await Promise.all([fresh, joined]);
});

test('aborting an open large-image warning rejects promptly and prevents retry after approval', { timeout: 2000 }, async () => {
  const warning = deferred(), opened = deferred(), cancel = new AbortController(); let calls = 0;
  const { media } = setup(async (_url, limit) => { calls++; throw tooLarge(limit); });
  const rejected = assert.rejects(media.read(url, () => { opened.resolve(); return warning.promise; }, cancel.signal), aborted);
  await opened.promise; cancel.abort(); await rejected;
  assert.equal(getEventListeners(cancel.signal, 'abort').length, 0);
  warning.resolve(true); await tick(); assert.equal(calls, 1);
});

test('large approvals remain per caller and each large retry receives its own cancellation signal', { timeout: 2000 }, async () => {
  const fetch = deferred(), warning = deferred(), opened = deferred(), large = deferred();
  const first = new AbortController(), second = new AbortController();
  const calls = [];
  const { media } = setup((_url, limit, signal) => {
    calls.push({ limit, signal }); return limit === normal ? fetch.promise : large.promise;
  });
  const one = assert.rejects(media.read(url, () => { opened.resolve(); return warning.promise; }, first.signal), aborted);
  const two = assert.rejects(media.read(url, async () => true, second.signal), aborted);
  fetch.reject(tooLarge(normal)); await opened.promise; await tick();
  assert.deepEqual(calls.map(call => call.limit), [normal, hard]);
  assert.equal(calls[1].signal, second.signal);
  first.abort(); await one;
  assert.equal(calls[1].signal.aborted, false);
  second.abort(); await two;
  warning.resolve(true); large.resolve(response()); await tick();
  assert.equal(calls.length, 2);
  assert.equal(getEventListeners(first.signal, 'abort').length, 0);
  assert.equal(getEventListeners(second.signal, 'abort').length, 0);
});

test('pre-aborted callers never fetch, prompt, or reuse a cached image', async () => {
  const cancel = new AbortController(); cancel.abort(); let calls = 0, prompts = 0;
  const { media } = setup(async () => { calls++; return response(); });
  const confirm = async () => { prompts++; return true; };
  await assert.rejects(media.read(url, confirm, cancel.signal), aborted);
  assert.equal(calls, 0);
  await media.read(url);
  await assert.rejects(media.read(url, confirm, cancel.signal), aborted);
  assert.equal(calls, 1); assert.equal(prompts, 0);
  assert.equal(getEventListeners(cancel.signal, 'abort').length, 0);
});
