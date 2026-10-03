/* src/ui/anim.js
 * 唯一职责：动效工具（数字滚动、减弱动效开关、红闪）。
 * 依赖：WQ.util
 * 被依赖：src/ui/pages/result.js、src/ui/pages/battle.js、src/main.js
 */
(function (WQ) {
  'use strict';

  /** 是否应减弱动效（系统偏好或设置页开关二选一） */
  function reducedMotion() {
    const bySetting = !!(WQ.state && WQ.state.settings && WQ.state.settings.reducedMotion);
    let bySystem = false;
    try {
      bySystem = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { bySystem = false; }
    return bySetting || bySystem;
  }

  /** 把设置与系统偏好同步到 html[data-motion]，供 CSS 降级 */
  function applyMotionAttr() {
    try {
      document.documentElement.setAttribute('data-motion', reducedMotion() ? 'reduced' : 'full');
    } catch (e) { /* 静默 */ }
  }

  /** 应用字号档位 */
  function applyFontSize(size) {
    try {
      document.documentElement.setAttribute('data-fontsize', size || 'md');
    } catch (e) { /* 静默 */ }
  }

  /**
   * 数字滚动（A11，400ms）。reducedMotion 时直接赋值。
   * @param {HTMLElement} el
   * @param {number} to
   * @param {object} opts { duration, prefix, suffix }
   */
  function rollNumber(el, to, opts) {
    if (!el) return;
    const o = opts || {};
    const target = Number(to) || 0;
    const prefix = o.prefix || '';
    const suffix = o.suffix || '';
    if (reducedMotion()) { el.textContent = prefix + target + suffix; return; }

    const duration = Number(o.duration) || 400;
    const start = window.performance && window.performance.now ? window.performance.now() : Date.now();
    function frame(now) {
      const t = Math.min(1, ((now || Date.now()) - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = prefix + Math.round(target * eased) + suffix;
      if (t < 1) window.requestAnimationFrame(frame);
      else el.textContent = prefix + target + suffix;
    }
    window.requestAnimationFrame(frame);
  }

  /** 全屏红闪（A16，200ms×2；减弱动效时关闭） */
  function redFlash(onDone) {
    if (reducedMotion()) { if (onDone) onDone(); return; }
    const node = document.createElement('div');
    node.className = 'flash-screen';
    document.body.appendChild(node);
    window.setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
      if (onDone) onDone();
    }, 400);
  }

  /** XP 进度条填充：用 transform: scaleX 实现（docs/04 §8.2 第 7 条） */
  function setProgress(el, ratio, animate) {
    if (!el) return;
    const r = Math.max(0, Math.min(1, Number(ratio) || 0));
    if (!animate || reducedMotion()) {
      el.style.transition = 'none';
      el.style.transform = 'scaleX(' + r + ')';
      return;
    }
    el.style.transition = '';
    el.style.transform = 'scaleX(' + r + ')';
  }

  WQ.anim = {
    reducedMotion: reducedMotion,
    applyMotionAttr: applyMotionAttr,
    applyFontSize: applyFontSize,
    rollNumber: rollNumber,
    redFlash: redFlash,
    setProgress: setProgress
  };
})(window.WQ = window.WQ || {});
