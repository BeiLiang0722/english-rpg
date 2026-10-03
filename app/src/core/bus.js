/* src/core/bus.js
 * 唯一职责：极简发布订阅（状态变更 → 重渲染；写盘失败 → 顶部提示条）。
 * 依赖：无。
 * 被依赖：src/store/state.js、src/store/persist.js、src/ui/shell.js
 */
(function (WQ) {
  'use strict';

  const handlers = Object.create(null);

  function on(evt, fn) {
    if (typeof fn !== 'function') return function () {};
    (handlers[evt] || (handlers[evt] = [])).push(fn);
    return function off() { WQ.bus.off(evt, fn); };
  }

  function off(evt, fn) {
    const list = handlers[evt];
    if (!list) return;
    if (!fn) { delete handlers[evt]; return; }
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  /** 触发事件；单个监听器抛错不影响其他监听器（业务不能被 UI 异常打断） */
  function emit(evt, payload) {
    const list = handlers[evt];
    if (!list) return;
    list.slice().forEach(function (fn) {
      try { fn(payload); } catch (e) { if (WQ.log) WQ.log.warn('bus:' + evt + ' 监听器抛错', e); }
    });
  }

  WQ.bus = { on: on, off: off, emit: emit };
})(window.WQ = window.WQ || {});
