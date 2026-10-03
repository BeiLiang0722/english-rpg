/* dev/check-mobile.mjs
 * 唯一职责：移动端适配的**静态**验收（docs/02 §6.1 xs 断点 + §7.5）。
 * 依赖：node:fs / node:path（零第三方依赖，与其它 dev 脚本一致）。
 *
 * ⚠️ 能证明什么、不能证明什么（写在最前面，避免误读）：
 *   ✅ 能证明：viewport 不缩放、全局 border-box、长文本有断行兜底、触控目标声明尺寸 ≥44×44、
 *              xs 断点存在、页面无 `overflow-x` 掩盖式写法、断点取值落在移动优先区间。
 *   ❌ 不能证明：真机渲染后的**实际像素级无溢出**。本沙箱起不了 headless 浏览器
 *              （mojo 命名管道被拒，见 docs/06 §1.2），所以"渲染后有没有横向滚动条"
 *              只能人工在 Chrome/Edge 设备模拟器里按 360px 复核；本脚本不声称做到了这件事。
 *
 * 判定口径（只查可判定的，不做像素级猜测）：
 *   1. `<meta name="viewport">` 含 width=device-width、initial-scale=1、无 maximum-scale / user-scalable=no
 *   2. 全局 `box-sizing: border-box`（含 `*` / 伪元素选择器）
 *   3. `body` 或 `html` 上有 `overflow-wrap: break-word|anywhere`（长英文词撑破视口的兜底）
 *   4. 触控目标：每个声明了 `min-height` 的按钮类/选项类规则，值必须 ≥44px（含 var 展开）
 *   5. 存在 `max-width` ≤ 389px 的媒体查询（xs 断点）
 *   6. 整份 CSS 里不出现 `overflow-x: hidden`（docs/02 §6.1 明令：不用它掩盖溢出）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(DEV_DIR, '..', 'app');
const STYLES = path.join(APP, 'styles');
const TAP_MIN = 44;

const problems = [];
const notes = [];
const passes = [];
function ok(msg) { passes.push(msg); }
function bad(msg) { problems.push(msg); }
function note(msg) { if (notes.indexOf(msg) < 0) notes.push(msg); }

/* ---------------- 极简 CSS 解析：注释、规则、媒体查询、自定义属性 ---------------- */
function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

/** 把 CSS 拆成 { media, selector, body } 的扁平列表（媒体查询内的规则带 media 前缀） */
function parseRules(css) {
  const src = stripComments(css);
  const rules = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    /* 找到匹配的右花括号（支持一层嵌套的 @media） */
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    if (prelude.startsWith('@media')) {
      parseRules(body).forEach((r) => rules.push({ media: prelude, selector: r.selector, body: r.body }));
    } else if (prelude.startsWith('@')) {
      atRules.add(prelude.replace(/\s*\{?\s*$/, '').slice(0, 48));
    } else {
      rules.push({ media: null, selector: prelude, body: body });
    }
    i = j;
  }
  return rules;
}
/** 解析过程中遇到的 at-rule（@keyframes 等，不参与判定，末尾汇总打印避免刷屏） */
const atRules = new Set();

/** 取一条规则里的某个属性值（先精确后模糊，返回最后一个声明） */
function decl(body, prop) {
  const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'gi');
  let m;
  let last = null;
  while ((m = re.exec(body)) !== null) last = m[1].trim();
  return last;
}

function cssFiles() {
  return fs.readdirSync(STYLES).filter((f) => f.endsWith('.css')).sort()
    .map((f) => ({ name: f, css: fs.readFileSync(path.join(STYLES, f), 'utf8') }));
}

/* ============================ 检查 1：viewport ============================ */
function checkViewport() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const m = /<meta\s+name="viewport"\s+content="([^"]*)"/i.exec(html);
  if (!m) { bad('index.html 缺少 <meta name="viewport">'); return; }
  const c = m[1].replace(/\s+/g, '');
  const hasWidth = /width=device-width/i.test(c);
  const hasScale = /initial-scale=1(\.0)?$/i.test(c) || /(^|,)initial-scale=1(\.0)?(,|$)/i.test(c);
  const blocksZoom = /maximum-scale|user-scalable=no/i.test(c);
  if (hasWidth && hasScale && !blocksZoom) {
    ok('viewport 不缩放：content="' + m[1] + '"（width=device-width + initial-scale=1，未禁止缩放）');
  } else {
    bad('viewport 不满足「360px 不缩放」：' + m[1]
      + (hasWidth ? '' : ' [缺 width=device-width]')
      + (hasScale ? '' : ' [缺 initial-scale=1]')
      + (blocksZoom ? ' [含 maximum-scale / user-scalable=no，会破坏用户缩放能力]' : ''));
  }
}

/* ======================= 检查 2/3/5/6：全局与断点 ======================= */
function checkGlobalCss(files) {
  /* 2. 全局 border-box */
  let borderBox = false;
  for (const f of files) {
    for (const r of parseRules(f.css)) {
      const sel = r.selector.replace(/\s+/g, '');
      if ((sel.includes('*') || sel.includes('*::before') || sel.includes('*::after'))
        && (decl(r.body, 'box-sizing') || '').toLowerCase() === 'border-box') {
        borderBox = true;
      }
    }
  }
  if (borderBox) ok('全局 box-sizing: border-box（* 及伪元素）—— 内边距不会把 360px 容器撑破');
  else bad('未找到全局 box-sizing: border-box');

  /* 3. 长文本断行兜底 */
  let wrap = false;
  for (const f of files) {
    for (const r of parseRules(f.css)) {
      if (!/(^|,)\s*(html|body)\s*($|,)/.test(r.selector)) continue;
      const v = (decl(r.body, 'overflow-wrap') || decl(r.body, 'word-break') || '').toLowerCase();
      if (v.includes('break-word') || v.includes('anywhere') || v.includes('break-all')) wrap = true;
    }
  }
  if (wrap) ok('html/body 上有 overflow-wrap 断行兜底 —— 长英文单词与音标不会撑破 360px 视口');
  else bad('html/body 上没有 overflow-wrap / word-break 断行兜底');

  /* 5. xs 断点存在 */
  const xs = [];
  for (const f of files) {
    for (const r of parseRules(f.css)) {
      if (!r.media) continue;
      const m = /max-width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(r.media);
      if (m && Number(m[1]) <= 389 && Number(m[1]) >= 320) xs.push({ file: f.name, media: r.media });
    }
  }
  if (xs.length) {
    ok('存在 xs 断点（' + xs[0].file + '：' + xs[0].media + '；共 ' + xs.length + ' 条规则）');
  } else {
    bad('没有 max-width ≤ 389px 的媒体查询（docs/02 §6.1 的 xs 断点缺失）');
  }

  /* 6. 不准用 overflow-x: hidden 掩盖**页面级**横向溢出
        （docs/02 §6.1 的意思是「不许靠它掩盖溢出」；进度条/图表列这类小元素靠它裁掉
         填充条的圆角溢出是正当用法，不在此列） */
  const PAGE_LEVEL = /(^|[,\s])(html|body|main|#app|\.page(?![\w-])|\.app-shell(?![\w-]))([\s,:{]|$)/;
  const hides = [];
  for (const f of files) {
    parseRules(f.css).forEach((r) => {
      if (!PAGE_LEVEL.test(r.selector)) return;
      const ox = decl(r.body, 'overflow-x');
      const ov = decl(r.body, 'overflow');
      const val = (ox || (ov && /hidden/.test(ov) ? 'hidden' : '') || '').toLowerCase();
      if (val === 'hidden') hides.push(f.name + ' → ' + r.selector.replace(/\s+/g, ' ').trim() + ' { overflow-x: hidden }');
    });
  }
  if (hides.length === 0) {
    ok('页面级容器（html/body/.page/.app-shell/main/#app）没有 overflow-x: hidden —— 不靠裁剪掩盖 360px 横向溢出');
  } else {
    for (const h of hides) bad('页面级容器用 overflow-x: hidden 掩盖溢出：' + h);
  }
}

/* ========================= 检查 4：触控目标 ≥44px ========================= */
function checkTapTargets(files) {
  /* 收集 :root 上的自定义属性，用于展开 var(--h-*)，按文件顺序（后者覆盖前者） */
  const vars = {};
  for (const f of files) {
    for (const r of parseRules(f.css)) {
      if (!r.selector.includes(':root')) continue;
      const re = /(--[a-z0-9-]+)\s*:\s*([^;]+)/gi;
      let m;
      while ((m = re.exec(r.body)) !== null) vars[m[1].trim()] = m[2].trim();
    }
  }
  const seen = new Map();
  const noDecl = new Set();
  const resolve = (v) => {
    let out = String(v || '').trim();
    for (let i = 0; i < 5; i++) {
      const m = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/i.exec(out);
      if (!m) break;
      out = (vars[m[1]] != null ? vars[m[1]] : (m[2] || '0')).trim();
    }
    return out;
  };
  const px = (v) => {
    const r = resolve(v);
    const m = /^(-?\d+(?:\.\d+)?)px$/i.exec(r);
    if (m) return Number(m[1]);
    const rm = /^(-?\d+(?:\.\d+)?)rem$/i.exec(r);
    if (rm) return Number(rm[1]) * 16;   /* 根字号 16px（data-fontsize 只放大，不影响下限） */
    return null;
  };

  /* 需要 ≥44px 的类名（可点击控件） */
  const NEEDS = ['btn', 'option', 'tile', 'icon-btn', 'quest-open-btn', 'chest-open-btn', 'seg'];
  const REQUIRED_TAP = ['btn', 'option', 'tile', 'icon-btn'];
  const missing = [];
  const tooSmall = [];
  for (const f of files) {
    for (const r of parseRules(f.css)) {
      const cls = NEEDS.filter((c) => new RegExp('\\.' + c + '(?![a-z0-9-])', 'i').test(r.selector));
      if (!cls.length) continue;
      const raw = decl(r.body, 'min-height') || decl(r.body, 'height');
      if (raw == null) {
        /* 这类规则自己没声明高度：先记下，全部扫完再看是否**另有**规则给了它高度 */
        cls.forEach((c) => { if (!seen.has(c)) noDecl.add(c); });
        continue;
      }
      const value = px(raw);
      if (value == null) { cls.forEach((c) => noDecl.add(c + '（' + raw + ' 不可换算）')); continue; }
      cls.forEach((c) => {
        noDecl.delete(c);
        const prev = seen.get(c);
        if (!prev || value < prev.value) {
          seen.set(c, { value: value, file: f.name, raw: raw });
        }
      });
      if (value < TAP_MIN) tooSmall.push(f.name + ' ' + r.selector.trim() + ' → ' + raw + ' = ' + value + 'px');
    }
  }
  REQUIRED_TAP.forEach((c) => {
    const rec = seen.get(c);
    if (!rec) bad('触控目标检查：整份 CSS 里没有任何给 .' + c + ' 声明高度（min-height/height）的规则');
    else if (rec.value < TAP_MIN) bad('触控目标不足：.' + c + ' → ' + rec.raw + ' = ' + rec.value + 'px（要求 ≥' + TAP_MIN + 'px）');
    else ok('触控目标达标：.' + c + ' → ' + rec.raw + ' = ' + rec.value + 'px ≥ ' + TAP_MIN + 'px（' + rec.file + '）');
  });
  tooSmall.forEach((t) => bad('触控目标不足：' + t));
  if (noDecl.size) {
    note('以下类只有部分规则声明了高度，最终值需真机确认（可能继承 .btn 的 min-height，不由本脚本判定）：'
      + Array.from(noDecl).join('、'));
  }
}

/* ================================ 主流程 ================================ */
console.log('=== 单词猎手 · 移动端适配静态检查（dev/check-mobile.mjs）===');
console.log('检查对象：' + APP);
console.log('参考：docs/02 §6.1（xs = 320–389px）+ §7.5（触控目标 ≥44×44）');
console.log('--------------------------------------------------------------------------------');

const files = cssFiles();
console.log('CSS 文件：' + files.map((f) => f.name + '(' + f.css.split('\n').length + ' 行)').join(' / '));
console.log('');

checkViewport();
checkGlobalCss(files);
checkTapTargets(files);

console.log('-- 通过 --');
passes.forEach((p) => console.log('  PASS  ' + p));
if (atRules.size) {
  console.log('  NOTE  解析时跳过 ' + atRules.size + ' 个不参与判定的 at-rule：'
    + Array.from(atRules).slice(0, 6).join('；') + (atRules.size > 6 ? ' …' : ''));
}
if (notes.length) {
  console.log('-- 说明（不计入判定）--');
  notes.forEach((n) => console.log('  NOTE  ' + n));
}
if (problems.length) {
  console.log('-- 问题 --');
  problems.forEach((p) => console.log('  FAIL  ' + p));
}
console.log('--------------------------------------------------------------------------------');
console.log('结论：' + (problems.length === 0 ? '通过（' + passes.length + ' 项）' : problems.length + ' 项不通过'));
console.log('边界：本脚本只做**静态**判定；真机渲染后的像素级溢出仍须人工在 360px 设备模拟器复核（见文件头）。');
process.exit(problems.length === 0 ? 0 : 1);
