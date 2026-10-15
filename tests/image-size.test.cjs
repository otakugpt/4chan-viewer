const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { load } = require('./helpers/load-main.cjs');
const { responseTooLarge } = load('network');
const normal = 20 * 1024 * 1024, hard = 100 * 1024 * 1024;
const url = 'https://i.urusai.cc/RiftTest.png';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
const valid = { status: 200, headers: { 'content-type': 'image/png' }, body: png };
function media(request, fs = {}) {
  return load('five-media', {
    './network': { responseTooLarge, serialQueue: () => work => work(), getBytes: request },
    'node:fs/promises': fs,
  });
}

test('network reports header and streamed size limits, accepting exactly the boundary', async () => {
  for (const scenario of [
    { length: '10', chunks: [Buffer.alloc(10)], succeeds: true },
    { length: '11', chunks: [], exact: true, size: 11 },
    { chunks: [Buffer.alloc(6), Buffer.alloc(5)], exact: false, size: 11 },
    { length: '2', chunks: [Buffer.alloc(6), Buffer.alloc(5)], exact: false, size: 11 },
  ]) {
    let destroyed = false;
    const network = load('network', {
      'node:dns/promises': { lookup: async () => [{ address: '1.1.1.1', family: 4 }] },
      'node:https': { get: (_url, options, callback) => {
        assert.equal(options.headers.Authorization, undefined);
        const req = new EventEmitter();
        queueMicrotask(() => {
          const response = new EventEmitter();
          response.statusCode = 200;
          response.headers = scenario.length ? { 'content-length': scenario.length } : {};
          response.destroy = error => { destroyed = true; if (error) queueMicrotask(() => response.emit('error', error)); };
          callback(response);
          for (const chunk of scenario.chunks) { if (destroyed) break; response.emit('data', chunk); }
          if (!destroyed) response.emit('end');
        });
        return req;
      } },
    });
    if (scenario.succeeds) assert.equal((await network.getBytes(url, 10)).body.length, 10);
    else await assert.rejects(network.getBytes(url, 10), error => {
      assert.equal(error.code, 'RESPONSE_TOO_LARGE'); assert.equal(error.limit, 10);
      assert.equal(error.status, 200); assert.equal(error.exact, scenario.exact); assert.equal(error.size, scenario.size);
      return true;
    });
    assert.equal(destroyed, !scenario.succeeds);
  }
});

test('ordinary images use 20 MiB without prompting; large image approval permits one bounded retry', async () => {
  let calls = 0, prompts = 0;
  const small = media(async (_url, limit) => { calls++; assert.equal(limit, normal); return valid; });
  assert.equal(small.IMAGE_NORMAL_LIMIT, normal); assert.equal(small.IMAGE_HARD_LIMIT, hard);
  await small.readFiveImage(url, async () => { prompts++; return true; });
  assert.equal(prompts, 0); assert.equal(calls, 1);
  for (const exact of [true, false]) {
    const limits = [];
    const reader = media(async (target, limit, headers) => {
      assert.equal(target, url); assert.equal(headers, undefined); limits.push(limit);
      if (limit === normal) throw responseTooLarge(limit, normal + 1, exact, 200);
      return valid;
    });
    const confirm = async info => { prompts++; assert.deepEqual(info, { url, size: normal + 1, exact }); return true; };
    await reader.readFiveImage(url, confirm);
    await reader.readFiveImage(url, confirm);
    assert.deepEqual(limits, [normal, hard, normal, hard]);
  }
  assert.equal(prompts, 4);
});

test('declined or missing approval never retries or writes a file', async () => {
  for (const confirm of [undefined, async () => false]) {
    let calls = 0, writes = 0;
    const reader = media(async (_url, limit) => { calls++; throw responseTooLarge(limit, normal + 1, true, 200); }, {
      open: async () => { writes++; throw new Error('Must not write'); },
    });
    await assert.rejects(reader.downloadFiveImage(url, 'unused.png', confirm), reader.ImagePolicyError);
    assert.equal(calls, 1); assert.equal(writes, 0);
  }
});

test('100 MiB is a hard ceiling, including changed size or unknown length after approval', async () => {
  for (const changesAfterApproval of [false, true]) {
    let calls = 0, prompts = 0;
    const reader = media(async (_url, limit) => {
      calls++;
      throw responseTooLarge(limit, changesAfterApproval && calls === 1 ? normal + 1 : hard + 1, false, 200);
    });
    await assert.rejects(reader.readFiveImage(url, async () => { prompts++; return true; }), error => error instanceof reader.ImagePolicyError && /100MB/.test(error.message));
    assert.equal(prompts, changesAfterApproval ? 1 : 0); assert.equal(calls, changesAfterApproval ? 2 : 1);
  }
});

test('large-image approval never bypasses HTTP errors, redirects, MIME or pixel limits', async () => {
  for (const status of [403, 429, 503]) {
    let prompts = 0, calls = 0;
    const reader = media(async (_url, limit) => { calls++; throw responseTooLarge(limit, normal + 1, true, status); });
    await assert.rejects(reader.readFiveImage(url, async () => { prompts++; return true; }));
    assert.equal(prompts, 0); assert.equal(calls, 1);
  }
  const huge = Buffer.from(png); huge.writeUInt32BE(17000, 16);
  for (const result of [{ ...valid, body: Buffer.from('<html>challenge</html>') }, { ...valid, headers: { 'content-type': 'text/html' } }, { ...valid, body: huge }]) {
    const reader = media(async (_url, limit) => { if (limit === normal) throw responseTooLarge(limit, normal + 1, true, 200); return result; });
    await assert.rejects(reader.readFiveImage(url, async () => true));
  }
  let calls = 0;
  const redirected = media(async (_url, limit) => {
    calls++; if (limit === normal) throw responseTooLarge(limit, normal + 1, true, 200);
    throw Object.assign(new Error('Redirect rejected'), { code: 'REDIRECT' });
  });
  await assert.rejects(redirected.readFiveImage(url, async () => true)); assert.equal(calls, 2);
});

test('approved large saves use the same validation and exclusive file creation', async () => {
  let writes = 0, prompts = 0;
  const reader = media(async (_url, limit) => { if (limit === normal) throw responseTooLarge(limit, hard, true, 200); return valid; }, {
    open: async (_file, flags) => { assert.equal(flags, 'wx'); return {
      writeFile: async bytes => { assert.deepEqual(bytes, png); writes++; }, close: async () => {},
    }; },
  });
  await reader.downloadFiveImage(url, 'unused.png', async () => { prompts++; return true; });
  assert.equal(prompts, 1); assert.equal(writes, 1);
});
