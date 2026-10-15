const item = (id = 123) => ({ id: String(id), url: `https://www.v2ex.com/t/${id}`, title: 'Public AI fixture',
  author: { name: 'Public author' }, date_published: '2026-10-15T00:00:00Z',
  content_html: '<p>Public &lt;code&gt; &amp; 中文</p><script>secretScript()</script><img src="https://evil.test/tracker"><p><a href="https://example.com/read">source</a></p>' });
const feed = (board = 'python', items = [item()]) => ({ version: 'https://jsonfeed.org/version/1',
  feed_url: `https://www.v2ex.com/feed/${board}.json`, home_page_url: `https://www.v2ex.com/go/${board}`, items });
const replies = [{ id: 10, topic_id: 123, created: 1760000000, member: { username: 'Reply author' }, content: 'Public reply <img src=x>' }];
const response = (value, status = 200, headers = {}) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: Buffer.from(JSON.stringify(value)) });
module.exports = { item, feed, replies, response };
