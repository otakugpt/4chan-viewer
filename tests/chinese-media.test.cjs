const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load-main.cjs');
const f = require('./helpers/ptt-fixtures.cjs');
const media = load('five-media');
const image = 'https://i.ibb.co/abc1234/fixture.png';
const second = 'https://i.imgur.com/abc1234.jpg';

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
    const result = url.includes('/replies?') ? [post] : { ...post, title: 'Title', node: { name: 'python', title: 'Python' }, supplements: [{ content: second }], content_rendered: '<img src="https://evil.test/tracker">' };
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ success: true, result })) };
  } });
  const result = await service({ kind: 'posts', board: 'python', thread: '123' });
  assert.deepEqual(result.posts[0].media, [image, second]);
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
