/* src/ui/toast.js
 * 唯一职责：轻提示（底部滑入 3s 淡出）+ 同步播报 aria-live。
 * 依赖：WQ.util（转义）
 * 被依赖：src/ui/shell.js、src/main.js、各页面
 */
(function (WQ) {
  'use strict';

  const DURATION = 3000;

  function root() {
    return document.getElementById('toast-root');
  }

  function live(text) {
    const el = document.getElementById('live-region');
    if (el) el.textContent = String(text || '');
  }

  function show(text, opts) {
    const host = root();
    if (!host) return;
    const node = document.createElement('div');
    node.className = 'toast';
    node.setAttribute('role', 'status');
    node.textContent = String(text == null ? '' : text); // textContent 天然转义
    host.appendChild(node);
    live(text);

    const ms = (opts && Number(opts.duration)) || DURATION;
    window.setTimeout(function () {
      node.classList.add('is-leaving');
      window.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 260);
    }, ms);
  }

  function clear() {
    const host = root();
    if (host) host.innerHTML = '';
  }

  WQ.toast = { show: show, clear: clear, live: live };
})(window.WQ = window.WQ || {});
