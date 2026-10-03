/* src/ui/overlay.js
 * 唯一职责：覆盖层栈（退出确认 / 升级 / 徽章）+ 焦点陷阱 + 焦点归还。
 * 依赖：WQ.util、WQ.audio
 * 被依赖：src/ui/pages/battle.js、src/ui/pages/result.js、src/main.js
 */
(function (WQ) {
  'use strict';

  const U = WQ.util;
  const KEY = 'wordly';

  let lastFocus = null;
  let closeHandler = null;
  let trapHandler = null;

  function root() { return document.getElementById('overlay-root'); }

  function focusables(node) {
    return Array.prototype.slice.call(
      node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
  }

  /**
   * 打开一个覆盖层。
   * @param {string} html 覆盖层内部 HTML（必须已转义）
   * @param {object} opts { onClose:function, dismissible:boolean, autoClose:number, onClickAnywhere:boolean }
   */
  function open(html, opts) {
    const o = opts || {};
    const host = root();
    if (!host) return;
    lastFocus = document.activeElement;

    host.innerHTML = '<div class="overlay" data-overlay-backdrop>' + html + '</div>';
    const backdrop = host.firstChild;
    const card = backdrop.firstElementChild;

    if (o.onClickAnywhere) {
      backdrop.addEventListener('click', function () { close(); });
    } else if (o.dismissible !== false) {
      backdrop.addEventListener('click', function (evt) {
        if (evt.target === backdrop) close();
      });
    }

    /* 焦点移入层内 */
    const first = focusables(card)[0];
    if (first) first.focus();
    else { card.setAttribute('tabindex', '-1'); card.focus(); }

    /* 焦点陷阱 */
    trapHandler = function (evt) {
      if (evt.key !== 'Tab') return;
      const items = focusables(card);
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (evt.shiftKey && document.activeElement === firstEl) { evt.preventDefault(); lastEl.focus(); }
      else if (!evt.shiftKey && document.activeElement === lastEl) { evt.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', trapHandler, true);

    /* Esc / Enter 关闭 */
    closeHandler = function (evt) {
      if (evt.key === 'Escape' || (o.closeOnEnter !== false && evt.key === 'Enter')) {
        evt.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', closeHandler);

    if (o.autoClose) {
      window.setTimeout(function () { close(); }, o.autoClose);
    }
    if (o.onOpen) o.onOpen(backdrop);
    return backdrop;
  }

  /** 关闭并归还焦点 */
  function close() {
    const host = root();
    if (trapHandler) document.removeEventListener('keydown', trapHandler, true);
    if (closeHandler) document.removeEventListener('keydown', closeHandler);
    trapHandler = null;
    closeHandler = null;
    if (host) host.innerHTML = '';
    if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
      lastFocus.focus();
    }
    lastFocus = null;
  }

  function isOpen() {
    const host = root();
    return !!(host && host.firstChild);
  }

  /** 通用确认弹窗 */
  function confirm(opts) {
    const o = opts || {};
    const html = [
      '<div class="overlay-card" role="dialog" aria-modal="true" aria-labelledby="ov-title">',
      '  <h2 class="overlay-title" id="ov-title">' + U.esc(o.title || '确认') + '</h2>',
      o.text ? '  <p class="overlay-text">' + U.esc(o.text) + '</p>' : '',
      '  <div class="overlay-actions">',
      '    <button class="btn btn-ghost" type="button" data-overlay-cancel>' + U.esc(o.cancelText || '取消') + '</button>',
      '    <button class="btn btn-primary" type="button" data-overlay-ok>' + U.esc(o.okText || '确定') + '</button>',
      '  </div>',
      '</div>'
    ].join('');
    const backdrop = open(html, { dismissible: true });
    if (!backdrop) return;
    const ok = backdrop.querySelector('[data-overlay-ok]');
    const cancel = backdrop.querySelector('[data-overlay-cancel]');
    if (ok) ok.addEventListener('click', function () { close(); if (o.onOk) o.onOk(); });
    if (cancel) cancel.addEventListener('click', function () { close(); if (o.onCancel) o.onCancel(); });
  }

  /**
   * 升级覆盖层（A14）：圆章弹入 + LEVEL UP + 称号 + 「点任意处继续」。
   * 连升多级时由调用方排队逐段播放。动效不阻塞落库（存档在调用前已写入）。
   */
  function levelUp(from, to, title, onDone) {
    const html = [
      '<div class="overlay-card" role="dialog" aria-modal="true" aria-label="等级提升">',
      '  <div class="levelup-badge"><span class="lv-num">' + U.esc(to) + '</span><span class="lv-tag">LEVEL</span></div>',
      '  <p class="levelup-title">LEVEL UP!</p>',
      '  <p class="levelup-route">Lv.' + U.esc(from) + ' → Lv.' + U.esc(to) + '</p>',
      '  <p class="levelup-title-new">新称号：' + U.esc(title || '') + '</p>',
      '  <p class="overlay-text">点任意处继续（或按 Enter / Esc）</p>',
      '</div>'
    ].join('');
    if (WQ.audio && WQ.audio.sfxLevelUp) WQ.audio.sfxLevelUp();
    open(html, {
      onClickAnywhere: true,
      autoClose: 2200,
      onClose: null
    });
    /* 用一次性监听保证 onDone 只跑一次 */
    const rootEl = document.getElementById('overlay-root');
    const observer = new MutationObserver(function () {
      if (!isOpen()) {
        observer.disconnect();
        if (onDone) onDone();
      }
    });
    if (rootEl) observer.observe(rootEl, { childList: true });
  }

  /** 徽章解锁覆盖层（A15） */
  function badgeUnlock(list, onDone) {
    const items = (list || []).map(function (b) {
      return '<div class="overlay-card" style="margin-top:12px;text-align:left">' +
        '<div style="display:flex;gap:12px;align-items:center">' +
        '<span style="font-size:28px">' + U.esc(b.icon || '🏅') + '</span>' +
        '<span><strong>' + U.esc(b.name) + '</strong><br><span class="overlay-text">' + U.esc(b.desc || '') + '</span></span>' +
        '</div></div>';
    }).join('');
    if (!items) { if (onDone) onDone(); return; }
    if (WQ.audio && WQ.audio.sfxBadge) WQ.audio.sfxBadge();
    open('<div>' + items + '<p class="overlay-text" style="margin-top:12px">点任意处继续</p></div>', {
      onClickAnywhere: true,
      autoClose: 2600,
      onClose: null
    });
    const rootEl = document.getElementById('overlay-root');
    const observer = new MutationObserver(function () {
      if (!isOpen()) {
        observer.disconnect();
        if (onDone) onDone();
      }
    });
    if (rootEl) observer.observe(rootEl, { childList: true });
  }

  WQ.overlay = {
    open: open,
    close: close,
    isOpen: isOpen,
    confirm: confirm,
    levelUp: levelUp,
    badgeUnlock: badgeUnlock
  };
})(window.WQ = window.WQ || {});
