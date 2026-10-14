const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(name, overrides = {}) {
  const filename = path.resolve(__dirname, '../../electron', name + '.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const run = vm.runInThisContext('(function(require,module,exports,__dirname){' + source + '\n})', { filename });
  run(id => Object.hasOwn(overrides, id) ? overrides[id] : id.startsWith('./') ? load(id.slice(2), overrides) : require(id), module, module.exports, path.dirname(filename));
  return module.exports;
}
module.exports = { load };
