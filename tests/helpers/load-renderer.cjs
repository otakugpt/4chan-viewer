const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, globals = {}, cache = new Map()) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  cache.set(file, exports);
  const localRequire = id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id + '.ts'), globals, cache) : require(id);
  vm.runInNewContext(code, { exports, require: localRequire, console, ...globals }, { filename: file });
  return exports;
}
module.exports = { load };
