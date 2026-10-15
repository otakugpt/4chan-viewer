const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-main.cjs');
const f = require('./helpers/ptt-fixtures.cjs');
const media = load('five-media');
const image = 'https://i.ibb.co/abc1234/fixture.png';
const second = 'https://i.imgur.com/abc1234.jpg';
const urusai = 'https://i.urusai.cc/RiftTest.png';

test('URUSAI allows only bounded HTTPS direct image paths, never preview or album URLs', () => {
  for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'PNG']) {
    const url = `https://i.urusai.cc/RiftTest.${ext}`;
    assert.equal(media.normalizeFiveImage(url), url);
  }
  assert.deepEqual(media.extractImages(`![image](${urusai}) ${urusai}。 https://i.urusai.cc/RiftTest`), [urusai]);
  for (const bad of [
    'https://i.urusai.cc/RiftTest', 'https://i.urusai.cc/a/RiftTest', 'https://i.urusai.cc/a/RiftTest.png',
    'https://urusai.cc/RiftTest.png', 'https://i.urusai.cc.evil.test/RiftTest.png', 'https://evil.i.urusai.cc/RiftTest.png',
    'https://i.urusai.cc@127.0.0.1/RiftTest.png', 'https://user@i.urusai.cc/RiftTest.png',
    'http://i.urusai.cc/RiftTest.png', 'https://i.urusai.cc:443/RiftTest.png', 'https://i.urusai.cc:8443/RiftTest.png',
    urusai + '?token=private', urusai + '#tracking', urusai + '\n',
    'https://i.urusai.cc/a/../RiftTest.png', 'https://i.urusai.cc/%52iftTest.png', 'https://i.urusai.cc/a%2fRiftTest.png',
    'https://i.urusai.cc/RiftTest.svg', 'https://i.urusai.cc/RiftTest.mp4', 'https://i.urusai.cc/RiftTest.html',
    'https://i.urusai.cc/' + 'a'.repeat(101) + '.png', 'https://i.urusai.cc/.png',
  ]) assert.equal(media.normalizeFiveImage(bad), null, bad);
});

test('URUSAI links are extracted from PTT and 5ch without widening the PTT age boundary', () => {
  const parser = load('ptt-parser');
  const html = f.article('Soft_Job', f.push('推', 'Fixture', urusai)).replace('fixture signature', `<a href="${urusai}">image</a>`);
  const posts = parser.pttPosts(html, 'Soft_Job', f.id, false, 'fixture time');
  assert.deepEqual(posts.map(post => post.media), [[urusai], [urusai]]);
  assert.throws(() => parser.pttPosts(f.gate + html, 'Soft_Job', f.id, false, 'fixture time'), parser.PttGate);
  assert.deepEqual(load('five').parseDat(`Fixture<><>date<>${urusai}<>title\n`)[0].media, [urusai]);
});

test('URUSAI image reads and saves retain byte validation, limits and credential separation', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
  let calls = 0, writes = 0;
  const response = { status: 200, headers: { 'content-type': 'image/png' }, body: png };
  const reader = load('five-media', {
    './network': { serialQueue: () => fn => fn(), getBytes: async (url, limit, headers) => {
      calls++; assert.equal(url, urusai); assert.equal(limit, 8 * 1024 * 1024); assert.equal(headers, undefined); return response;
    } },
    'node:fs/promises': { open: async (_path, flags) => { assert.equal(flags, 'wx'); return {
      writeFile: async bytes => { assert.deepEqual(bytes, png); writes++; }, close: async () => {},
    }; } },
  });
  assert.equal((await reader.readFiveImage(urusai)).mime, 'image/png');
  await reader.downloadFiveImage(urusai, 'fixture-output.png');
  assert.equal(writes, 1); assert.equal(calls, 2);
  assert.match(reader.imageFilename(urusai), /^[a-f0-9]{24}\.png$/);
  for (const status of [302, 403, 404, 429]) { response.status = status; await assert.rejects(reader.readFiveImage(urusai)); }
  assert.equal(calls, 6);
  response.status = 200; response.body = Buffer.from('<html>challenge</html>');
  await assert.rejects(reader.readFiveImage(urusai));
  response.body = png; response.headers['content-type'] = 'text/html';
  await assert.rejects(reader.readFiveImage(urusai));
  const huge = Buffer.from(png); huge.writeUInt32BE(17000, 16);
  response.body = huge; response.headers['content-type'] = 'image/png';
  await assert.rejects(reader.readFiveImage(urusai));
  await assert.rejects(reader.readFiveImage('https://i.urusai.cc/RiftTest'));
  assert.equal(calls, 9); assert.equal(writes, 1);
});

test('shared image extraction handles Markdown/CJK delimiters without admitting unsafe destinations', () => {
  assert.deepEqual(media.extractImages(`![image](${image}) ${image}。 [link](${second})`), [image, second]);
  for (const url of [image + '?auth=private', image + '#tracking', 'https://evil.test/a.png', 'http://i.ibb.co/abc1234/fixture.png', 'https://i.ibb.co/abc1234/a.svg', 'https://user@i.ibb.co/abc1234/fixture.png', 'https://i.ibb.co\\abc1234/fixture.png', image + '\n']) assert.equal(media.normalizeFiveImage(url), null);
  assert.deepEqual(media.extractImages(`${image}?auth=private ${image}#tracking https://evil.test/a.png`), []);
  assert.equal(media.extractImages(Array.from({ length: 150 }, (_, i) => `https://i.imgur.com/abc${10000 + i}.png`).join(' ')).length, 100);
});

test('V2EX collects body, supplements and reply images without fetching them or using rendered HTML', async () => {
  const calls = [];
  const service = load('v2ex').createV2exService(() => ({ mode: 'authenticated', token: 'fixture-not-a-real-credential', revision: 0 }), { spacing: 0, request: async (url, _limit, headers) => {
    calls.push(url); assert.equal(headers.Authorization, 'Bearer fixture-not-a-real-credential');
    const post = { id: 123, content: `![image](${image})`, member: { username: 'User' }, created: 1760000000 };
    const result = url.includes('/replies?') ? [post] : { ...post, title: 'Title', node: { name: 'python', title: 'Python' }, supplements: [{ content: second + ' ' + urusai }], content_rendered: '<img src="https://evil.test/tracker">' };
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ success: true, result })) };
  } });
  const result = await service({ kind: 'posts', board: 'python', thread: '123' });
  assert.deepEqual(result.posts[0].media, [image, second, urusai]);
  assert.deepEqual(result.posts[1].media, [image]);
  assert.ok(calls.every(url => url.startsWith('https://www.v2ex.com/api/v2/')));
  assert.ok(!JSON.stringify(result).includes('evil.test'));
});

test('PTT scopes media to article/comment, skips executable subtrees and gates before extraction', () => {
  const parser = load('ptt-parser');
  const html = f.article('Soft_Job', f.push('推', 'Alice', `<a href="${second}">comment image</a>`)).replace('fixture signature', `<a href="${image}">image</a><img src="${image}" onerror="bad()"><script>${second}</script><form><a href="${second}">hidden</a></form>`);
  const posts = parser.pttPosts(html, 'Soft_Job', f.id, false, 'fixture time');
  assert.deepEqual(posts[0].media, [image]); assert.deepEqual(posts[1].media, [second]);
  assert.ok(!JSON.stringify(posts).includes('onerror'));
  assert.throws(() => parser.pttPosts(f.gate + html, 'Soft_Job', f.id, false, 'fixture time'), parser.PttGate);
});

test('shared image reader sends neither site credentials nor age cookies and validates bytes', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=', 'base64');
  let calls = 0;
  const reader = load('five-media', { './network': { serialQueue: () => fn => fn(), getBytes: async (url, limit, headers) => {
    calls++; assert.equal(url, image); assert.equal(limit, 8 * 1024 * 1024); assert.equal(headers, undefined);
    return { status: 200, headers: { 'content-type': 'image/png' }, body: png };
  } } });
  assert.equal((await reader.readFiveImage(image)).mime, 'image/png');
  await assert.rejects(reader.readFiveImage('https://www.ptt.cc/bbs/Beauty/index.html'));
  assert.equal(calls, 1);
});
