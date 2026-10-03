/* src/store/log.js
 * 唯一职责：本地事件日志（环形缓冲，最多 2000 条，键 wordquest.log.v1）+ 控制台告警包装。
 * 依赖：WQ.balance、WQ.util
 * 被依赖：src/core/bus.js（容错告警）、src/core/audio.js、src/game/balance.js
 *
 * books/03 §8.1 的事件清单：appOpen / roundStart / answer / roundEnd / levelUp /
 * achievementUnlock / shopBuy / streakChange / persistError / ttsUnavailable。
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;
  const U = WQ.util;
  const KEY = 'wordquest.log.v1';

  let buffer = [];
  let loaded = false;

  function storage() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function load() {
    if (loaded) return buffer;
    loaded = true;
    const ls = storage();
    if (!ls) return buffer;
    try {
      const raw = ls.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) buffer = parsed.slice(-B.maxLogEntries);
      }
    } catch (e) {
      buffer = [];
    }
    return buffer;
  }

  function flush() {
    const ls = storage();
    if (!ls) return false;
    try { ls.setItem(KEY, JSON.stringify(buffer.slice(-B.maxLogEntries))); return true; }
    catch (e) { return false; }
  }

  /** 追加一条日志（超出上限丢弃最旧） */
  function add(type, payload) {
    load();
    buffer.push({
      id: U.uid(),
      at: new Date().toISOString(),
      type: type,
      payload: payload || {}
    });
    if (buffer.length > B.maxLogEntries) buffer = buffer.slice(-B.maxLogEntries);
    flush();
    return buffer[buffer.length - 1];
  }

  /** 只读快照（自检面板 / 调试用） */
  function all() { return load().slice(); }

  function clear() {
    buffer = [];
    loaded = true;
    const ls = storage();
    try { if (ls) ls.removeItem(KEY); } catch (e) { /* 静默 */ }
  }

  /** 告警：进 Console，不改流程 */
  function warn(msg, err) {
    try {
      if (err) console.warn('[单词猎手] ' + msg, err);
      else console.warn('[单词猎手] ' + msg);
    } catch (e) { /* 静默 */ }
  }

  /** 错误：进 Console 并记一条 persistError 日志 */
  function error(msg, err) {
    try {
      if (err) console.error('[单词猎手] ' + msg, err);
      else console.error('[单词猎手] ' + msg);
    } catch (e) { /* 静默 */ }
  }

  WQ.log = {
    KEY: KEY,
    add: add,
    all: all,
    clear: clear,
    warn: warn,
    error: error,
    persistError: function (message, sizeBytes) {
      add('persistError', { message: String(message || ''), sizeBytes: sizeBytes || 0 });
    }
  };
})(window.WQ = window.WQ || {});
