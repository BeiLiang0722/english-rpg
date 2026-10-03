/* dev/domshim.mjs · 极简 DOM 实现（开发期测试用，非运行时依赖）
 * 用途：受限环境里浏览器起不来（沙箱禁止命名管道），于是用一个最小 DOM + HTML 解析器
 *       把 app/src/ui/** 的渲染与事件委托真正跑起来，做端到端集成测试。
 * 支持：getElementById / querySelector(All) / createElement / classList / style /
 *       属性 / innerText / innerHTML / click / focus / 事件冒泡 / MutationObserver /
 *       localStorage / location.hash / matchMedia / performance。
 * 不负责：CSS 布局与绘制（这部分只能在真浏览器里看，已在验收记录里登记为已知限制）。
 *
 * ---------------- 存储故障注入（v0.1.1 新增，默认全部关闭） ----------------
 * 起因：docs/06 §1.3 / §5.3 指出垫片的 localStorage 永不抛错，于是 persist.js 的
 * 「写盘失败」「配额满裁剪 rounds 后重试」「多标签页 storage 事件」三条分支在 73 条
 * 自动化断言里不可达。下面 4 个函数把这三类浏览器行为变成可注入的，且**未调用时
 * localStorage 的行为与旧版逐字节一致**（getItem/setItem/removeItem/clear/key/length 不变）。
 *
 *   const env = createEnv({ storage: new Map() });
 *   env.failWrites({ mode: 'throw' });                     // 之后主存档键写入都抛 QuotaExceededError
 *   env.failNextWrites(1, { mode: 'quota' });              // 只抛一次，重试（裁剪 rounds 后）会成功
 *   env.failWrites({ mode: 'silent', match: 'wordquest.save.v1' }); // 接受写入但不改变值
 *   env.failWrites({ mode: 'throw', match: /^wordquest\./ });       // 正则匹配多个键
 *   env.store.set('wordquest.save.v1', '{"profile":{}}');
 *   env.emitStorageEvent('wordquest.save.v1');             // 派发一次真正的 storage 事件（多标签页路径）
 *   env.reset();                                           // 清掉注入状态 + 清空 store
 *
 * 语义：
 *   failNextWrites(n, o)  之后 n 次命中写入按 o.mode 失败；o 省略 = { mode:'throw', match:null }。
 *   failWrites(o)         一直失败到 reset()（或 npm/测试自己再注入）；o.mode 默认 'throw'。
 *   mode = 'throw'        抛 name==='QuotaExceededError' 的 Error（DOMException 风格，带 code=22）。
 *   mode = 'quota'        同上，但**只抛一次**，第二次写入直接成功 —— 用来验证配额满裁剪重试。
 *   mode = 'silent'       不抛错也不写入（保留旧值）—— 对应"可读可写却不真正落盘"的浏览器实现。
 *   match 省略时只命中主存档键 wordquest.save.v1（persist.js 的 K_SAVE）；传字符串 = 精确匹配；
 *        传 RegExp = 正则匹配。注意：match 若覆盖到 persist.js 的探测键 __wq_probe__，
 *        storage() 会返回 null（等价"存储不可用"），这属于调用方自己的选择。
 *   emitStorageEvent(key) 只派发事件、不改 store；要模拟"别的标签页写了档"，先自己
 *        env.store.set(...) 再 emitStorageEvent(...)。
 */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...names) { names.forEach((n) => this.set.add(n)); this.sync(); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); this.sync(); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force;
    if (on) this.set.add(name); else this.set.delete(name);
    this.sync();
    return on;
  }
  contains(name) { return this.set.has(name); }
  sync() { this.node._attrs.class = Array.from(this.set).join(' '); }
}

class Style {
  constructor() { this._props = {}; }
  setProperty(k, v) { this._props[k] = v; }
  getPropertyValue(k) { return this._props[k] || ''; }
}

export class Node {
  constructor(tag) {
    this.tagName = tag ? String(tag).toUpperCase() : '';
    this.nodeName = this.tagName;
    this.childNodes = [];
    this.parentNode = null;
    this.ownerDocument = null;
    this._attrs = Object.create(null);
    this._listeners = Object.create(null);
    this._text = '';
    this.classList = new ClassList(this);
    this.style = new Style();
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this._focused = false;
  }

  get attributes() {
    return Object.keys(this._attrs).map((name) => ({ name, value: this._attrs[name] }));
  }
  setAttribute(name, value) {
    this._attrs[String(name)] = String(value);
    if (name === 'class') {
      this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean));
    }
  }
  getAttribute(name) {
    const v = this._attrs[name];
    return v === undefined ? null : v;
  }
  hasAttribute(name) { return this._attrs[name] !== undefined; }
  removeAttribute(name) { delete this._attrs[name]; }

  appendChild(child) {
    if (!child) return child;
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument || (this.tagName === '#document' ? this : null) || this;
    this.childNodes.push(child);
    this._notify();
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) { this.childNodes.splice(i, 1); child.parentNode = null; this._notify(); }
    return child;
  }
  replaceChildren(...nodes) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = [];
    nodes.forEach((n) => this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n));
    this._notify();
  }

  _notify() {
    const doc = this.ownerDocument;
    if (doc && doc._observers) {
      doc._observers.forEach((obs) => {
        if (obs._targets.has(this) || obs._targets.has(doc.documentElement) || obs._targets.has(doc.body)) obs._fire();
      });
    }
  }

  get firstChild() { return this.childNodes[0] || null; }
  get firstElementChild() { return this.childNodes.filter((c) => c.tagName)[0] || null; }
  get children() { return this.childNodes.filter((c) => c.tagName); }
  get lastElementChild() { const l = this.children; return l[l.length - 1] || null; }

  /** 纯文本（近似 innerText：块级元素之间补换行） */
  get innerText() { return this._collectText(this).replace(/\n{2,}/g, '\n').trim(); }
  set innerText(v) { this.replaceChildren(this.ownerDocument.createTextNode(String(v))); }

  get textContent() { return this._collectText(this); }
  set textContent(v) { this.replaceChildren(this.ownerDocument.createTextNode(String(v))); }

  _collectText(node) {
    if (node._textNode) return node._text;
    const block = /^(DIV|P|H1|H2|H3|H4|LI|SECTION|HEADER|FOOTER|FIGURE|MAIN|UL|OL|BR|DETAILS|SUMMARY|P|TABLE|TR)$/.test(node.tagName);
    let out = '';
    node.childNodes.forEach((c) => {
      const t = this._collectText(c);
      out += t;
      if (block) out += '\n';
    });
    return block ? '\n' + out : out;
  }

  get outerHTML() { return serialize(this); }

  get innerHTML() {
    if (this._rawHtml !== undefined) return this._rawHtml;
    return this.childNodes.map(serialize).join('');
  }
  set innerHTML(html) {
    this._rawHtml = String(html);
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = [];
    if (html) parseInto(this, String(html));
  }

  addEventListener(type, fn, opts) {
    (this._listeners[type] || (this._listeners[type] = [])).push({ fn, capture: !!(opts && opts.capture) });
  }
  removeEventListener(type, fn) {
    const list = this._listeners[type];
    if (!list) return;
    const i = list.findIndex((x) => x.fn === fn);
    if (i >= 0) list.splice(i, 1);
  }

  /** 事件派发：沿 parentNode 冒泡（含 closest 委托的 click） */
  dispatchEvent(evt) {
    evt.target = evt.target || this;
    const path = [];
    let n = this;
    while (n) { path.push(n); n = n.parentNode; }
    const doc = this.ownerDocument;
    if (doc && !path.includes(doc)) path.push(doc);
    if (doc && doc.defaultView && !path.includes(doc.defaultView)) path.push(doc.defaultView);

    for (const node of path) {
      const list = node._listeners && node._listeners[evt.type];
      if (list) {
        for (const entry of list.slice()) {
          evt.currentTarget = node;
          try { entry.fn.call(node, evt); } catch (e) { if (evt.type === 'error') throw e; console.error('[domshim] 监听器抛错(' + evt.type + '):', e && e.message); }
          if (evt._stop) break;
        }
      }
    }
    return !evt.defaultPrevented;
  }

  click() {
    const evt = new DomEvent('click', { bubbles: true });
    evt.target = this;
    this.dispatchEvent(evt);
  }

  focus() { this._focused = true; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() { this._focused = false; }
  contains(other) {
    let n = other;
    while (n) { if (n === this) return true; n = n.parentNode; }
    return false;
  }
  closest(selector) {
    let n = this;
    while (n && n.tagName) {
      if (matches(n, selector)) return n;
      n = n.parentNode;
    }
    return null;
  }

  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const groups = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    const walk = (node) => {
      node.childNodes.forEach((c) => {
        if (!c.tagName) return;
        if (groups.some((g) => matches(c, g))) out.push(c);
        walk(c);
      });
    };
    walk(this);
    return out;
  }

  getBoundingClientRect() { return { width: 360, height: 56, top: 0, left: 0, bottom: 56, right: 360 }; }
  get offsetParent() { return this.parentNode; }
  scrollIntoView() {}
  set selectionStart(v) { this._selStart = v; }
  get selectionStart() { return this._selStart || 0; }
}

/** 文本节点 */
class TextNode extends Node {
  constructor(text) { super(''); this._textNode = true; this._text = String(text); }
}

export class DomEvent {
  constructor(type, opts = {}) {
    this.type = type;
    this.bubbles = opts.bubbles !== false;
    this.defaultPrevented = false;
    this.key = opts.key || '';
    this.shiftKey = !!opts.shiftKey;
    this.altKey = !!opts.altKey;
    this.ctrlKey = !!opts.ctrlKey;
    this.target = opts.target || null;
    this._stop = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
}

/** 选择器匹配：支持 .class / #id / tag / [attr] / [attr="v"] / 组合（与空格后代选择器） */
function matches(node, selector) {
  if (!node || !node.tagName) return false;
  const parts = String(selector).trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (!matchSimple(node, last)) return false;
  let cur = node.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    let found = false;
    while (cur) {
      if (cur.tagName && matchSimple(cur, parts[i])) { found = true; cur = cur.parentNode; break; }
      cur = cur.parentNode;
    }
    if (!found) return false;
  }
  return true;
}

function matchSimple(node, sel) {
  if (!node || !node.tagName) return false;
  const tokens = String(sel).match(/^([a-zA-Z0-9-]*|\*)|(\.[\w-]+)|(#[\w-]+)|(\[[^\]]+\])/g);
  if (!tokens) return false;
  const t = String(sel).trim();
  if (!/^[a-zA-Z0-9-]*|\*/.test(t) && !t.startsWith('.') && !t.startsWith('#') && !t.startsWith('[')) return false;

  /* 拆成 标签/类/id/属性 四类依次校验 */
  const tagMatch = t.match(/^([a-zA-Z][a-zA-Z0-9-]*|\*)/);
  if (tagMatch && tagMatch[1] !== '*') {
    if (node.tagName !== tagMatch[1].toUpperCase()) return false;
  }
  const classes = (t.match(/\.([\w-]+)/g) || []).map((c) => c.slice(1));
  for (const c of classes) if (!node.classList.contains(c)) return false;
  const ids = (t.match(/#([\w-]+)/g) || []).map((c) => c.slice(1));
  for (const id of ids) if (node.getAttribute('id') !== id) return false;
  const attrs = t.match(/\[[^\]]+\]/g) || [];
  for (const a of attrs) {
    const m = a.slice(1, -1).match(/^([\w-]+)(?:([~^$*|]?=)"?([^"\]]*)"?)?$/);
    if (!m) return false;
    const [, name, op, val] = m;
    if (!node.hasAttribute(name)) return false;
    if (op) {
      const have = node.getAttribute(name);
      if (op === '=' && have !== val) return false;
      if (op === '^=' && !have.startsWith(val)) return false;
      if (op === '$=' && !have.endsWith(val)) return false;
      if (op === '*=' && have.indexOf(val) < 0) return false;
    }
  }
  return true;
}

/* ---------------- HTML 解析（够用的子集） ---------------- */
export function parseInto(root, html) {
  const docOf = (node) => {
    let n = node;
    while (n) { if (n.tagName === '#document') return n; if (n.ownerDocument) return n.ownerDocument; n = n.parentNode; }
    return null;
  };
  const doc = docOf(root);
  if (!doc) throw new Error('parseInto: 找不到 ownerDocument');
  const stack = [root];
  let i = 0;
  const pushText = (text) => {
    if (!text) return;
    /* HTML 实体还原（esc() 的逆运算） */
    const decoded = text
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    stack[stack.length - 1].appendChild(doc.createTextNode(decoded));
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { pushText(html.slice(i)); break; }
    pushText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt < 0) break;
    const rawTag = html.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (rawTag.startsWith('/')) {
      /* 闭合：弹栈到匹配的标签 */
      const name = rawTag.slice(1).trim().toUpperCase();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tagName === name) { stack.length = k; break; }
      }
      continue;
    }
    const selfClose = rawTag.endsWith('/');
    const body = selfClose ? rawTag.slice(0, -1) : rawTag;
    const nameMatch = body.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!nameMatch) continue;
    const tag = nameMatch[1];
    const el = doc.createElement(tag);
    /* 属性 */
    const attrRe = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let am;
    const attrStr = body.slice(tag.length);
    while ((am = attrRe.exec(attrStr)) !== null) {
      const name = am[1];
      const value = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : '';
      if (name === 'data-roll' || name.startsWith('data-') || name === 'id' || name === 'aria-label' || name === 'lang' || name === 'value' || name === 'type' || name === 'role' || name === 'name' || name === 'hidden' || name === 'placeholder' || name === 'inputmode' || name === 'autocomplete' || name === 'autocapitalize' || name === 'spellcheck' || name === 'style' || name === 'class' || name === 'aria-checked' || name === 'aria-selected' || name === 'aria-pressed' || name === 'aria-disabled' || name === 'aria-valuenow' || name === 'aria-valuemin' || name === 'aria-valuemax' || name === 'disabled' || name === 'checked' || name === 'for' || name === 'tabindex' || name === 'title' || name === 'open') {
        el.setAttribute(name, value === '' && name === 'disabled' ? '' : value);
      } else {
        el.setAttribute(name, value);
      }
      if (name === 'disabled') el.disabled = true;
      if (name === 'value') el.value = value;
    }
    stack[stack.length - 1].appendChild(el);
    if (!VOID_TAGS.has(tag.toLowerCase()) && !selfClose) stack.push(el);
  }
  return root;
}

export function serialize(node) {
  if (node._textNode) {
    return node._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const attrs = Object.keys(node._attrs).map((k) => ' ' + k + '="' + String(node._attrs[k]).replace(/"/g, '&quot;') + '"').join('');
  const body = node.childNodes.map(serialize).join('');
  if (!node.tagName) return body;
  if (VOID_TAGS.has(node.tagName.toLowerCase())) return '<' + node.tagName.toLowerCase() + attrs + '>';
  return '<' + node.tagName.toLowerCase() + attrs + '>' + body + '</' + node.tagName.toLowerCase() + '>';
}

/* ---------------- Document ---------------- */
export class Document extends Node {
  constructor() {
    super('');
    this.tagName = '#document';
    this.readyState = 'complete';
    this.title = '';
    this._observers = new Set();
    this.activeElement = null;
    this.documentElement = new Node('html');
    this.head = new Node('head');
    this.body = new Node('body');
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this._defaultView = null;
  }
  createElement(tag) { const el = new Node(tag); el.ownerDocument = this; return el; }
  createTextNode(text) { const t = new TextNode(text); t.ownerDocument = this; return t; }
  getElementById(id) {
    let found = null;
    const walk = (n) => {
      if (found) return;
      n.childNodes.forEach((c) => { if (found || !c.tagName) return; if (c.getAttribute('id') === id) { found = c; return; } walk(c); });
    };
    walk(this.documentElement);
    return found;
  }
  get defaultView() { return this._defaultView; }
  addEventListener(type, fn, opts) { Node.prototype.addEventListener.call(this, type, fn, opts); }
  removeEventListener(type, fn) { Node.prototype.removeEventListener.call(this, type, fn); }
  dispatchEvent(evt) { return Node.prototype.dispatchEvent.call(this, evt); }
  querySelector(sel) { return Node.prototype.querySelector.call(this.documentElement, sel); }
  querySelectorAll(sel) { return Node.prototype.querySelectorAll.call(this.documentElement, sel); }
  getComputedStyle(el) {
    const doc = this;
    return {
      getPropertyValue(prop) {
        if (el && el.style && el.style._props[prop]) return el.style._props[prop];
        return (doc._rootStyles && doc._rootStyles[prop]) || '';
      },
      fontFamily: '-apple-system, "Microsoft YaHei", sans-serif'
    };
  }
}

/* ---------------- 虚拟时钟（让测试不用真等） ---------------- */
export function createClock() {
  let now = 0;
  let seq = 0;
  let queue = [];
  return {
    get now() { return now; },
    setTimeout(fn, delay = 0) {
      const id = ++seq;
      queue.push({ id, at: now + Math.max(0, Number(delay) || 0), fn, order: seq });
      return id;
    },
    clearTimeout(id) { queue = queue.filter((t) => t.id !== id); },
    setInterval(fn, delay = 0) { return this.setTimeout(fn, delay); },
    clearInterval(id) { this.clearTimeout(id); },
    pending() { return queue.length; },
    /** 推进虚拟时间并执行到期的回调；返回执行了多少个 */
    advance(ms) {
      const target = now + Math.max(0, Number(ms) || 0);
      let count = 0;
      for (let guard = 0; guard < 10000; guard++) {
        queue.sort((a, b) => (a.at - b.at) || (a.order - b.order));
        const next = queue[0];
        if (!next || next.at > target) break;
        queue.shift();
        now = next.at;
        count++;
        try { next.fn(); } catch (e) { console.error('[clock] 回调抛错:', e && e.message); }
      }
      now = target;
      return count;
    },
    /** 反复推进直到没有待执行任务或达到上限 */
    run(maxSteps = 400) {
      let total = 0;
      for (let i = 0; i < maxSteps; i++) {
        if (!queue.length) break;
        total += this.advance(0);
        if (!queue.length) break;
        this.advance(1);
      }
      return total;
    }
  };
}

/* ---------------- MutationObserver（够用的最小实现） ---------------- */
export class MutationObserver {
  constructor(cb) { this.cb = cb; this._targets = new Set(); this._scheduled = false; }
  observe(target, opts) { this._targets.add(target); if (target.ownerDocument) target.ownerDocument._observers.add(this); }
  disconnect() { this._targets.forEach((t) => { if (t.ownerDocument) t.ownerDocument._observers.delete(this); }); this._targets.clear(); }
  takeRecords() { return []; }
  _fire() {
    if (this._scheduled) return;
    this._scheduled = true;
    Promise.resolve().then(() => {
      this._scheduled = false;
      try { this.cb([{ type: 'childList' }], this); } catch (e) { /* ignore */ }
    });
  }
}

/* ---------------- 创建一个"页面"环境 ---------------- */
export function createEnv(opts = {}) {
  const store = opts.storage || new Map();
  const clock = opts.clock || createClock();

  /* ---------- 存储故障注入状态（mode===null 即"未注入"，行为与旧版一致） ---------- */
  const MAIN_KEY = 'wordquest.save.v1';
  const faults = { mode: null, match: null, remaining: 0 };

  /** 本次写入是否命中注入（match 省略时只命中主存档键） */
  function faultHits(key) {
    if (!faults.mode || faults.remaining <= 0) return false;
    const k = String(key);
    const m = faults.match;
    if (m == null) return k === MAIN_KEY;
    if (m instanceof RegExp) return new RegExp(m.source, m.flags.replace(/g/g, '')).test(k);
    return k === String(m);
  }

  /** 消费一次注入：quota 模式只失败一次（下一次写入放行，用于验证"裁剪后重试"） */
  function consumeFault() {
    if (faults.mode === 'quota') { faults.mode = null; faults.remaining = 0; return; }
    if (faults.remaining !== Infinity) faults.remaining -= 1;
    if (faults.remaining <= 0) { faults.mode = null; faults.remaining = 0; }
  }

  /** DOMException 风格的配额错误（persist.js 用 e.name/e.message 里的 quota 判定分支） */
  function quotaError() {
    const e = new Error('The quota has been exceeded.（domshim 注入的写入失败）');
    e.name = 'QuotaExceededError';
    e.code = 22;
    return e;
  }

  /** 让接下来 n 次命中写入按 mode 失败（默认 throw） */
  function failNextWrites(n, o) {
    const c = o || {};
    faults.mode = c.mode || 'throw';
    faults.match = c.match === undefined ? null : c.match;
    faults.remaining = Math.max(1, Math.floor(Number(n) || 1));
    return faults.remaining;
  }

  /** 持续失败直到 reset()（默认 throw） */
  function failWrites(o) {
    const c = o || {};
    faults.mode = c.mode || 'throw';
    faults.match = c.match === undefined ? null : c.match;
    faults.remaining = Infinity;
    return faults.mode;
  }

  /** 清掉注入状态与全部存储 */
  function reset() {
    faults.mode = null;
    faults.match = null;
    faults.remaining = 0;
    store.clear();
  }

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (faultHits(k)) {
        const mode = faults.mode;
        consumeFault();
        if (mode === 'silent') return;   // 接受写入但保留旧值（"可读可写却不真正落盘"）
        throw quotaError();              // throw / quota：抛 name==='QuotaExceededError'
      }
      store.set(k, String(v));
    },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  };

  const doc = new Document();
  doc._rootStyles = { '--bg-base': '#0F1424', '--accent': '#6C5CE7' };
  const app = doc.createElement('div'); app.setAttribute('id', 'app');
  const toastRoot = doc.createElement('div'); toastRoot.setAttribute('id', 'toast-root');
  const overlayRoot = doc.createElement('div'); overlayRoot.setAttribute('id', 'overlay-root');
  const live = doc.createElement('p'); live.setAttribute('id', 'live-region');
  doc.body.appendChild(app);
  doc.body.appendChild(toastRoot);
  doc.body.appendChild(overlayRoot);
  doc.body.appendChild(live);
  doc.activeElement = doc.body;

  const listeners = Object.create(null); // 注意：闭包共享，避免 vm 里 window 被复制后 this 指向丢失
  const win = {
    document: doc,
    localStorage,
    location: { hash: '', href: 'file:///app/index.html', replace(url) { const i = String(url).indexOf('#'); this.hash = i >= 0 ? String(url).slice(i) : ''; }, reload() {} },
    performance: { now: () => clock.now },
    navigator: { onLine: true, language: 'zh-CN' },
    matchMedia: () => ({ matches: !!opts.reducedMotion, addListener() {}, removeListener() {} }),
    requestAnimationFrame: (fn) => clock.setTimeout(() => fn(clock.now), 16),
    cancelAnimationFrame: (id) => clock.clearTimeout(id),
    setTimeout: (fn, d) => clock.setTimeout(fn, d),
    clearTimeout: (id) => clock.clearTimeout(id),
    setInterval: (fn, d) => clock.setInterval(fn, d),
    clearInterval: (id) => clock.clearInterval(id),
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) {
      const list = listeners[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    _dispatchWindow(type, evt) { (listeners[type] || []).slice().forEach((fn) => fn(evt)); }
  };
  win.window = win;
  win.self = win;
  win.WebSocket = class {};
  win.AudioContext = undefined;
  win.webkitAudioContext = undefined;
  win.speechSynthesis = undefined;
  win.SpeechSynthesisUtterance = undefined;
  win.crypto = { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) };
  win.MutationObserver = MutationObserver;
  win.HTMLElement = Node;
  win.Node = Node;
  win.getComputedStyle = doc.getComputedStyle.bind(doc);
  doc._defaultView = win;

  /* location.hash 变更 → 触发 hashchange（等价浏览器行为） */
  let hashValue = '';
  Object.defineProperty(win.location, 'hash', {
    get() { return hashValue; },
    set(v) {
      const next = String(v).startsWith('#') ? String(v) : '#' + String(v);
      if (next === hashValue) return;
      hashValue = next;
      win.location.href = 'file:///app/index.html' + next;
      clock.setTimeout(() => win._dispatchWindow('hashchange', { type: 'hashchange' }), 0);
    }
  });

  /* document.title 写透 */
  Object.defineProperty(doc, 'title', {
    get() { return this._title || ''; },
    set(v) { this._title = String(v); }
  });

  /**
   * 派发一次真正的 storage 事件到 window 监听器（不改 store）。
   * 用途：persist.onStorage → bus 'storageExternal' → main.js 的多标签提示这条链路
   * 在没有真浏览器、垫片也不派发事件的条件下变得可测（docs/06 §1.3 / §8.5）。
   * @param {string} [key] 省略 = 主存档键 wordquest.save.v1
   * @returns {object} 派发出去的事件对象（便于断言 key/newValue）
   */
  function emitStorageEvent(key) {
    const k = key == null ? MAIN_KEY : String(key);
    const evt = {
      type: 'storage',
      key: k,
      oldValue: null,
      newValue: store.has(k) ? store.get(k) : null,
      storageArea: localStorage,
      url: win.location.href
    };
    win._dispatchWindow('storage', evt);
    return evt;
  }

  return {
    window: win, document: doc, localStorage, store, app, toastRoot, overlayRoot, clock,
    /* 故障注入 / 多标签事件（默认未注入；API 说明见文件头） */
    faults, failNextWrites, failWrites, emitStorageEvent, reset
  };
}
