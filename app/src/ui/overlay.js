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
    /* 打开时刻：用来吃掉「打开的那一次用户手势本身」——浏览器在 click 之后还会补一个 Enter，
       若不挡住，玩家点开宝箱的同一瞬间就会被这声 Enter 关掉（奖励看不见）。 */
    const openedAt = Date.now();

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

    /* Esc / Enter 关闭（打开后 300ms 内忽略 Enter：那是上一次手势的余波） */
    closeHandler = function (evt) {
      if (evt.key === 'Escape' || (o.closeOnEnter !== false && evt.key === 'Enter')) {
        if (evt.key === 'Enter' && (Date.now() - openedAt) < 300) return;
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

  /**
   * v0.2 开箱结果覆盖层。
   * 档位用三个通道同时表达（颜色 + 边框粗细 + 档位文字），不依赖单一颜色区分。
   * @param {object} res { tier:{id,name,icon,coins,xp}, coins, xp }
   * @param {function} [onDone] 关闭后回调（用于排队播放徽章解锁）
   */
  function chestResult(res, onDone) {
    const r = res || {};
    const tier = r.tier || { id: 1, name: '普通', icon: '📦', coins: 0, xp: 0 };
    const id = Math.max(1, Math.min(3, Number(tier.id) || 1));
    const html = [
      '<div class="overlay-card chest-result chest-rarity-' + id + '" role="dialog" aria-modal="true" aria-label="宝箱奖励">',
      '  <div class="chest-result-icon" aria-hidden="true">' + U.esc(tier.icon || '📦') + '</div>',
      '  <p class="overlay-title">' + U.esc(tier.name) + '宝箱</p>',
      '  <div class="chest-result-main">',
      '    <div class="reward-row"><span>金币</span><span class="val mono">+' + U.esc(r.coins == null ? tier.coins : r.coins) + '</span></div>',
      '    <div class="reward-row"><span>经验</span><span class="val mono">+' + U.esc(r.xp == null ? tier.xp : r.xp) + ' XP</span></div>',
      '  </div>',
      '  <p class="overlay-text">点任意处继续（或按 Enter / Esc）</p>',
      '</div>'
    ].join('');
    if (WQ.audio && WQ.audio.sfxCoin) WQ.audio.sfxCoin();
    /* autoClose 给足 12s：正常玩家早就点掉了，而**测试用的虚拟时钟**会一次性推进好几秒，
       3.2s 会让"刚打开就被自动关掉"在自动化里成为假失败（真实浏览器里也确实太快）。 */
    open(html, { onClickAnywhere: true, dismissible: true, autoClose: 12000, onClose: null });
    /* onDone 只跑一次（覆盖层被任何方式关闭后） */
    const rootEl = document.getElementById('overlay-root');
    if (!rootEl) { if (onDone) onDone(); return; }
    const observer = new MutationObserver(function () {
      if (!isOpen()) {
        observer.disconnect();
        if (onDone) onDone();
      }
    });
    observer.observe(rootEl, { childList: true });
  }

  /**
   * v0.2 徽章详情弹层（验收报告 D8）。
   * @param {object} a WQ.ach.getAllProgress 的单条 { def, progress, target, text, unlocked, unlockedAt }
   */
  function badgeDetail(a) {
    if (!a || !a.def) return;
    const def = a.def;
    const unlocked = !!a.unlocked;
    const pct = a.target ? Math.round(Math.max(0, Math.min(1, a.progress / a.target)) * 100) : 0;
    const when = a.unlockedAt ? String(a.unlockedAt).slice(0, 10) : '';
    const html = [
      '<div class="overlay-card badge-detail" role="dialog" aria-modal="true" aria-labelledby="ov-badge-title">',
      '  <div class="badge-detail-icon" aria-hidden="true">' + U.esc(unlocked ? def.icon : '🔒') + '</div>',
      '  <h2 class="overlay-title" id="ov-badge-title">' + U.esc(def.name) + '</h2>',
      '  <p class="overlay-text">' + U.esc(def.desc) + '</p>',
      '  <div class="progress" style="margin-top:12px"><i style="transform:scaleX(' + (pct / 100) + ')"></i></div>',
      '  <p class="overlay-text mono">' + U.esc(a.text || (a.progress + '/' + a.target)) + '</p>',
      '  <p class="overlay-text">' + (unlocked ? '已于 ' + U.esc(when) + ' 解锁' : '尚未解锁') + '</p>',
      unlocked ? '' : '<p class="overlay-text">奖励：🪙 ' + U.esc(def.coinReward || 0) + (def.xpReward ? ' · +' + U.esc(def.xpReward) + ' XP' : '') + '</p>',
      '  <div class="overlay-actions">',
      '    <button class="btn btn-primary" type="button" data-overlay-close>知道了</button>',
      '  </div>',
      '</div>'
    ].join('');
    const backdrop = open(html, { dismissible: true });
    if (!backdrop) return;
    const btn = backdrop.querySelector('[data-overlay-close]');
    if (btn) btn.addEventListener('click', function () { close(); });
  }

  WQ.overlay = {
    open: open,
    close: close,
    isOpen: isOpen,
    confirm: confirm,
    levelUp: levelUp,
    badgeUnlock: badgeUnlock,
    chestResult: chestResult,
    badgeDetail: badgeDetail
  };
})(window.WQ = window.WQ || {});
