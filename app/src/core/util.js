/* src/core/util.js
 * 唯一职责：通用无业务工具（转义、本地日期、随机、克隆、限幅）。
 * 依赖：无。
 * 被依赖：几乎所有模块（store / game / ui）。
 * 硬约束：不读业务状态，不碰 localStorage，不碰 document。
 */
(function (WQ) {
  'use strict';

  /**
   * HTML 转义。所有拼接进 innerHTML 的外部/用户内容必须经过它。
   * @param {*} s 任意值
   * @returns {string}
   */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 两位补零 */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /**
   * 本地时区的 YYYY-MM-DD。
   * 注意：绝不能用 toISOString().slice(0,10)，那会按 UTC 计算从而跨时区错一天。
   * @param {Date} [d]
   */
  function todayKey(d) {
    const t = d instanceof Date ? d : new Date();
    return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
  }

  /** 本地时区的 YYYY-MM */
  function ymKey(d) {
    const t = d instanceof Date ? d : new Date();
    return t.getFullYear() + '-' + pad2(t.getMonth() + 1);
  }

  /** 把 YYYY-MM-DD 解析为本地零点 Date（无效输入返回 null） */
  function parseISO(s) {
    if (!s || typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  /** 日期字符串相减：b - a 的天数（自然日，本地） */
  function dayDiff(a, b) {
    const da = parseISO(a);
    const db = parseISO(b);
    if (!da || !db) return null;
    return Math.round((db.getTime() - da.getTime()) / 86400000);
  }

  /** 日期字符串加 n 天 */
  function addDays(key, n) {
    const d = parseISO(key);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return todayKey(d);
  }

  /** 限幅 */
  function clamp(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  /**
   * 可复现的 32 位随机数发生器（mulberry32）。
   * 用途：出题与判定在自检里必须可复现，所以随机数一律由调用方注入 rnd()。
   * @param {number} seed
   * @returns {function(): number} 返回 [0,1) 的函数
   */
  function rng(seed) {
    let a = (Number(seed) || 1) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 随机取一个元素（空数组返回 undefined） */
  function pick(arr, rnd) {
    if (!arr || !arr.length) return undefined;
    const r = typeof rnd === 'function' ? rnd() : Math.random();
    return arr[Math.floor(r * arr.length) % arr.length];
  }

  /** 洗牌（不修改原数组） */
  function shuffle(arr, rnd) {
    const out = (arr || []).slice();
    const r = typeof rnd === 'function' ? rnd : Math.random;
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /** 带降级的唯一 id：优先 crypto.randomUUID，file:// 或旧浏览器下降级为时间戳 + 随机串 */
  function uid() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (e) { /* 降级 */ }
    return 'r' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /** 深克隆（只用 JSON 可序列化数据） */
  function deepClone(v) {
    if (v == null) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }

  /** 解析 ISO8601 时间戳（带 T 的完整时间），失败返回 null */
  function parseTime(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  /** ISO 时间戳所在的本地自然日 */
  function dayOf(ts) {
    const d = parseTime(ts);
    return d ? todayKey(d) : null;
  }

  /** 毫秒 → m:ss */
  function formatDuration(ms) {
    const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + pad2(s);
  }

  /** 数字格式化：加千分位 */
  function formatNumber(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('zh-CN');
  }

  /** 编辑距离 ≤ 1 判定（用于拼写题的"近似正确"） */
  function withinEditDistance1(a, b) {
    const s = String(a == null ? '' : a).trim().toLowerCase();
    const t = String(b == null ? '' : b).trim().toLowerCase();
    if (s === t) return { equal: true, distance1: false };
    if (Math.abs(s.length - t.length) > 1) return { equal: false, distance1: false };
    // 双指针一次容错
    let i = 0, j = 0, diff = 0;
    while (i < s.length && j < t.length) {
      if (s[i] === t[j]) { i++; j++; continue; }
      diff++;
      if (diff > 1) return { equal: false, distance1: false };
      if (s.length > t.length) i++;
      else if (s.length < t.length) j++;
      else { i++; j++; }
    }
    if (i < s.length || j < t.length) diff++;
    return { equal: false, distance1: diff === 1 };
  }

  WQ.util = {
    esc: esc,
    pad2: pad2,
    todayKey: todayKey,
    ymKey: ymKey,
    parseISO: parseISO,
    parseTime: parseTime,
    dayOf: dayOf,
    dayDiff: dayDiff,
    addDays: addDays,
    clamp: clamp,
    rng: rng,
    pick: pick,
    shuffle: shuffle,
    uid: uid,
    deepClone: deepClone,
    formatDuration: formatDuration,
    formatNumber: formatNumber,
    withinEditDistance1: withinEditDistance1
  };
})(window.WQ = window.WQ || {});
