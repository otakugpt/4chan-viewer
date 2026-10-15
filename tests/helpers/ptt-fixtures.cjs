// Synthetic HTML, not copied posts or a production age-confirmation response.
const id = 'M.1789176238.A.A3E';
const gate = `<script>(() => {
    if (document.cookie.indexOf('over18=1') === -1) {
        location = 'https://www.ptt.cc/ask/over18?from=' + encodeURIComponent(location.pathname);
    }
})();</script>`;
const boards = '<div class="b-ent"><a href="/bbs/Soft_Job/index.html"><div class="board-name">Soft_Job</div><div class="board-title">工程師 &amp; AI</div></a></div><div class="b-ent"><a href="/bbs/Beauty/index.html"><div class="board-title">確認 fixture</div></a></div>';
const listing = (board = 'Soft_Job', previous = '12', title = 'PTT fixture') => `<div class="r-list-container"><div class="r-ent"><div class="title"><a href="/bbs/${board}/${id}.html">${title}</a></div><div class="author">Author</div><div class="date">10/15</div></div><div class="r-ent"><div class="title">(本文已被刪除)</div></div></div>${previous ? `<a class="btn wide" href="/bbs/${board}/index${previous}.html">&lsaquo; 上頁</a>` : '<a class="btn wide disabled">上頁</a>'}`;
const push = (tag, author, content, date = '10/15 12:34') => `<div class="push"><span class="push-tag">${tag} </span><span class="push-userid">${author}</span><span class="push-content">: ${content}</span><span class="push-ipdatetime"> 203.0.113.2 ${date}</span></div>`;
const article = (board = 'Soft_Job', comments = [push('推', 'Alice', '中文 good'), push('噓', 'Bob', '中文 bad'), push('→', 'Carol', '中文 note')].join('')) => `<div id="main-content"><div class="article-metaline"><span class="article-meta-tag">作者</span><span class="article-meta-value">Author (fixture)</span></div><div class="article-metaline-right"><span class="article-meta-tag">看板</span><span class="article-meta-value">${board}</span></div><div class="article-metaline"><span class="article-meta-tag">標題</span><span class="article-meta-value">PTT fixture</span></div><div class="article-metaline"><span class="article-meta-tag">時間</span><span class="article-meta-value">Thu Oct 15 12:00:00 2026</span></div>
中文 body &lt;code&gt; &amp; <a href="https://www.ptt.cc/bbs/Soft_Job/${id}.html">https://www.ptt.cc/bbs/Soft_Job/${id}.html</a><img src="https://evil.test/tracker"><script>doNotRun()</script>
--
fixture signature
<span class="f2">※ 發信站: fixture</span><span class="f2">※ 編輯: fixture edit</span>${comments}</div>`;
const response = (html, status = 200, headers = {}) => ({ status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body: Buffer.from(html) });
module.exports = { id, gate, boards, listing, push, article, response };
