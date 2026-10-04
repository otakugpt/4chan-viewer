const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require, console, ...globals }, { filename: file });
  return exports;
}
test('reading data validates storage, bounds favorites and supports deletion', () => {
  let stored;
  const lib = load('src/lib/library.ts', { localStorage: { getItem: () => '{broken', setItem: (_key, value) => { stored = value; } } });
  assert.equal(lib.getLibrary().boards.length, 0);
  lib.toggleFavorite('boards', 'g');
  lib.toggleFavorite('boards', '../bad');
  lib.toggleFavorite('threads', 'g/123');
  lib.rememberSelection('g', 123);
  lib.rememberReading('g/123', 125, 800);
  lib.rememberReading('g/123', 124, 200);
  assert.equal(lib.getLibrary().reads['g/123'].post, 125);
  const restored = lib.parseLibrary(stored);
  assert.equal(restored.last.thread, 123);
  assert.equal(restored.boards.length, 1);
  assert.equal(restored.reads['g/123'].scroll, 200);
  const epoch = lib.getClearEpoch();
  lib.clearLibrary();
  assert.equal(lib.getLibrary().threads.length, 0);
  assert.equal(lib.getClearEpoch(), epoch + 1);
  const bad = lib.parseLibrary(JSON.stringify({ version: 1, boards: ['../../bad'], last: { board: '../', thread: 2 }, reads: { 'g/1': { post: -1, scroll: 0, updated: 1 } } }));
  assert.equal(bad.last, null);
  assert.equal(Object.keys(bad.reads).length, 0);
});
test('translation shares in-flight requests, caches successes and retries errors', async () => {
  let calls = 0;
  let fail = false;
  const lib = load('src/lib/translation.ts', { window: { electron: { translate: async () => {
    calls++;
    return fail ? { error: 'HTTP 456' } : { translatedText: 'translated' };
  } } } });
  const a = lib.translateCached(' hello '), b = lib.translateCached('hello');
  assert.equal(a, b);
  assert.equal(await a, 'translated');
  await lib.translateCached('hello');
  assert.equal(calls, 1);
  fail = true;
  await assert.rejects(lib.translateCached('other'), /利用上限/);
  fail = false;
  assert.equal(await lib.translateCached('other'), 'translated');
  assert.equal(calls, 3);
  assert.match(lib.translationError('DEEPL_API_KEY is not set'), /未設定/);
  assert.match(lib.translationError('HTTP 403'), /APIキー/);
});
