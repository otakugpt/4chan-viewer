// Explicit, bounded live checks. No credentials, article text, cookies, images or translations.
async function runPublicChecks(clients, { pttOnly = false } = {}) {
  let requests = 0;
  const maximum = pttOnly ? 5 : 7;
  if (!clients) {
    const { getBytes } = require('../dist-electron/network.js');
    const request = async (url, limit, headers = {}) => {
      const host = new URL(url).origin;
      if (Object.keys(headers).length || requests >= maximum || (host !== 'https://www.ptt.cc' && (pttOnly || host !== 'https://www.v2ex.com'))) throw new Error('Live check boundary');
      requests++;
      return getBytes(url, limit);
    };
    clients = {
      ptt: require('../dist-electron/ptt.js').createPttService({ request }).request,
      v2ex: pttOnly ? undefined : require('../dist-electron/v2ex.js').createV2exService(() => ({ token: '', revision: 0 }), { request }),
      anonymousAuth: () => request('https://www.v2ex.com/api/v2/nodes/python', 2 * 1024 * 1024),
      pause: () => new Promise(resolve => setTimeout(resolve, 6100)),
    };
  }
  const checks = [];
  let pttReady = true;
  const check = async (id, action) => {
    try { const value = await action(); checks.push({ id, ...value }); return value; }
    catch {
      if (id.startsWith('ptt-')) pttReady = false;
      checks.push({ id, status: 'failed', detail: 'Connection or response validation failed; no upstream content recorded.' }); return null;
    }
  };
  if (!pttOnly) {
    const publicNodes = await check('v2ex-public-nodes', async () => {
      const r = await clients.v2ex({ kind: 'boards' });
      if (!r.boards?.length) throw new Error();
      return { status: 'passed', count: r.boards.length };
    });
    await check('v2ex-anonymous-auth-boundary', async () => {
      if (!publicNodes) return { status: 'not-tested', detail: 'Earlier site check failed; no further request made.' };
      await clients.pause();
      const r = await clients.anonymousAuth();
      if (r.status !== 401) throw new Error();
      return { status: 'passed', httpStatus: r.status };
    });
  }
  await check('ptt-public-boards', async () => {
    const r = await clients.ptt({ kind: 'boards' });
    if (!r.boards?.length) throw new Error();
    return { status: 'passed', count: r.boards.length };
  });
  let first;
  await check('ptt-public-list', async () => {
    if (!pttReady) return { status: 'not-tested', detail: 'Earlier site check failed; no further request made.' };
    first = await clients.ptt({ kind: 'threads', board: 'Soft_Job' });
    if (!first.threads?.length) { pttReady = false; throw new Error(); }
    return { status: 'passed', count: first.threads.length };
  });
  await check('ptt-older-page', async () => {
    if (!pttReady) return { status: 'not-tested', detail: 'Earlier site check failed; no further request made.' };
    if (!first?.nextCursor) return { status: 'not-tested', detail: 'No older-page cursor available.' };
    const r = await clients.ptt({ kind: 'threads', board: 'Soft_Job', cursor: first.nextCursor });
    if (!r.threads) { pttReady = false; throw new Error(); }
    if (!r.threads.length) return { status: 'not-tested', detail: 'Older page was empty; pagination content not verified.' };
    const previousIds = new Set(first.threads.map(thread => thread.threadId));
    if (r.threads.every(thread => previousIds.has(thread.threadId))) throw new Error();
    return { status: 'passed', count: r.threads.length };
  });
  await check('ptt-public-article', async () => {
    if (!pttReady || !first?.threads?.length) return { status: 'not-tested', detail: 'No public article available or earlier site check failed.' };
    const r = await clients.ptt({ kind: 'posts', board: 'Soft_Job', thread: first.threads[0].threadId });
    if (!r.posts?.length) { pttReady = false; throw new Error(); }
    return { status: 'passed', count: r.posts.length, imageCandidates: r.posts.reduce((sum, post) => sum + (post.media?.length ?? 0), 0) };
  });
  await check('ptt-age-boundary', async () => {
    if (!pttReady) return { status: 'not-tested', detail: 'Earlier site check failed; no further request made.' };
    const r = await clients.ptt({ kind: 'threads', board: 'Beauty' });
    if (r.status === 'age-confirmation-required' && !r.threads && !r.posts) return { status: 'passed' };
    if (r.error) throw new Error();
    return { status: 'not-tested', detail: 'No age gate observed; no consent granted.' };
  });
  return { checkedAt: new Date().toISOString(), scope: pttOnly ? 'PTT anonymous public reads only; V2EX is NOT contacted. Age consent, images and DeepL are NOT verified.' : 'Anonymous public reads only; authenticated V2EX, age consent, images and DeepL are NOT verified.', requests: clients.requestCount?.() ?? requests, checks };
}

module.exports = { runPublicChecks };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.includes('--allow-network') || new Set(args).size !== args.length || args.some(arg => !['--allow-network', '--ptt'].includes(arg))) {
    console.error('Build first, then explicitly enable up to 7 public GETs: npm run check:live -- --allow-network (add --ptt for PTT only, up to 5 GETs)');
    process.exitCode = 2;
  } else runPublicChecks(undefined, { pttOnly: args.includes('--ptt') }).then(report => {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.checks.some(check => check.status === 'failed') ? 1 : 0;
  }).catch(() => { console.error('Public check could not start. Build the app first. No upstream details recorded.'); process.exitCode = 1; });
}
