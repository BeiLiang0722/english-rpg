/* dev/selfcheck.mjs · 在 Node 里跑同一套纯函数断言（开发期工具，非运行时依赖）
 * 依赖：node:fs / node:vm / node:path
 * 用法：node dev/selfcheck.mjs
 *
 * 做法：只加载"不碰 DOM"的模块（config / core / store / game / ui-selfcheck），
 *       给它们一个最小的 window + localStorage 环境，然后跑 WQ.selfcheck.run()。
 *       这样浏览器里 #/selfcheck 面板与命令行跑的是同一套断言。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DEV_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(DEV_DIR, '..', 'app');

/* ---------- 最小浏览器环境 ---------- */
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; }
};

const sandbox = {
  console,
  JSON,
  Math,
  Date,
  Number,
  String,
  Array,
  Object,
  Set,
  Map,
  RegExp,
  Error,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  setTimeout,
  clearTimeout,
  performance: { now: () => Date.now() },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.localStorage = localStorage;
sandbox.location = { hash: '#/selfcheck', href: 'file:///app/index.html#/selfcheck', replace() {} };
sandbox.crypto = { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) };
sandbox.self = sandbox;
vm.createContext(sandbox);

/* ---------- 载入模块：清单以 app/index.html 的 <script src> 顺序为唯一真相 ----------
 * 规则：去掉纯 UI（src/ui/**）与入口 src/main.js，但保留 src/ui/selfcheck.js（它就是被断言的模块）。
 * 这样 v0.2 以后新增的 game 模块（chest/quest/…）不会再出现"清单漏文件 → WQ.xxx is undefined"。 */
function listAppScripts() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const out = [];
  const re = /<script\s+src="([^"]+)"\s*>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].replace(/\\/g, '/'));
  return out;
}
const FILES = listAppScripts().filter(function (rel) {
  if (rel === 'src/ui/selfcheck.js') return true;
  return rel.indexOf('src/ui/') !== 0 && rel !== 'src/main.js';
});

const loaded = [];
for (const rel of FILES) {
  const abs = path.join(APP, rel);
  const code = fs.readFileSync(abs, 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: rel });
    loaded.push(rel);
  } catch (e) {
    console.error('加载失败: ' + rel + ' → ' + e.message);
    process.exit(1);
  }
}

const WQ = sandbox.WQ;
// 初始化 state（浏览器里由 main.js 完成；这里手工做最小初始化）
WQ.state.save = WQ.save.fillDefaults(WQ.save.defaultSave());
WQ.state.settings = WQ.save.defaultSettings();

console.log('== 已加载 ' + loaded.length + ' 个模块 ==');
console.log('词库: ' + WQ.WORDS.length + ' 词');

const results = WQ.selfcheck.run();
const groups = {};
results.forEach((r) => { (groups[r.group] || (groups[r.group] = [])).push(r); });

let failed = 0;
for (const g of Object.keys(groups)) {
  console.log('\n-- ' + g + ' --');
  for (const r of groups[g]) {
    if (!r.pass) failed++;
    console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  | 期望 ' + r.expected + ' | 实际 ' + r.actual);
  }
}

console.log('\n== 结果: ' + (results.length - failed) + '/' + results.length + ' PASS ==');
process.exit(failed ? 1 : 0);
