/* src/ui/shell.js
 * 唯一职责：应用外壳（整页渲染 + 事件委托 + 404 兜底 + 全局 helper）。
 * 依赖：WQ.util、WQ.router、WQ.state、WQ.bus、WQ.anim
 * 被依赖：src/main.js、各页面模块
 *
 * 渲染模型：每页返回 HTML 字符串 → shell.render() 一次性写入 #app；
 *           交互统一走 #app 上的 click 委托（读 data-action / data-id）。
 */
(function (WQ) {
  'use strict';

  const U = WQ.util;

  /** 当前页面的 action 表：{ actionName: function(el, id, evt) } */
  let actionTable = Object.create(null);
  let bound = false;

  function app() { return document.getElementById('app'); }

  /** 渲染整页 */
  function render(html, opts) {
    const host = app();
    if (!host) return;
    host.innerHTML = html;
    if (!(opts && opts.noAnim)) {
      host.classList.remove('page-enter');
      /* 双重 rAF：确保动画从下一帧开始，避免首帧被合并（docs/04 R2 对策④） */
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () { host.classList.add('page-enter'); });
      });
    }
    /* 渲染后同步一次 XP 条初始状态 */
    host.querySelectorAll('[data-progress-init]').forEach(function (el) {
      const r = Number(el.getAttribute('data-progress-init')) || 0;
      WQ.anim.setProgress(el, r, false);
    });
    if (WQ.toast && WQ.state.ui && WQ.state.ui.queuedToast) {
      const msg = WQ.state.ui.queuedToast;
      WQ.state.ui.queuedToast = null;
      WQ.toast.show(msg);
    }
  }

  /** 注册当前页面的动作表（每次渲染前调用） */
  function setActions(table) {
    actionTable = table || Object.create(null);
  }

  /** 404 兜底 */
  function renderNotFound(hash) {
    setActions({});
    render([
      '<main class="page" id="main">',
      '  <h1>页面不存在</h1>',
      '  <p class="empty-note">找不到 ' + U.esc(hash) + '</p>',
      '  <button class="btn btn-primary btn-block" type="button" data-action="home">返回营地</button>',
      '</main>'
    ].join(''));
  }

  /** 事件委托：唯一入口，绑定在 #app 上（不会随整页替换而失效） */
  function bind() {
    if (bound) return;
    bound = true;
    const host = app();
    if (!host) return;

    host.addEventListener('click', function (evt) {
      const el = evt.target.closest ? evt.target.closest('[data-action]') : null;
      if (!el || !host.contains(el)) return;
      const action = el.getAttribute('data-action');
      const id = el.getAttribute('data-id');
      /* 已作答后锁定的选项：不做任何事（防重复判定） */
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      const fn = actionTable[action];
      if (typeof fn === 'function') {
        evt.preventDefault();
        fn(el, id, evt);
      } else if (action === 'home') {
        WQ.router.go('#/home');
      }
    });

    /* 键盘：选项 1–4、Enter 下一题、Space 发音、Esc 退出（绑定在 document，避免被整页替换冲掉） */
    document.addEventListener('keydown', function (evt) {
      const fn = actionTable['__keydown'];
      if (typeof fn === 'function') fn(evt);
    });
  }

  function escapeHtml(s) { return U.esc(s); }

  /** 通用 HUD 状态条（等级 / XP / 金币 / 连击天数） */
  function hudHtml(save) {
    const p = save.profile;
    const maxLevel = WQ.level.isMaxLevel(p.level);
    const need = maxLevel ? 0 : WQ.level.needXp(p.level);
    const ratio = maxLevel ? 1 : Math.max(0, Math.min(1, need ? p.xp / need : 0));
    const title = WQ.level.titleFor(p.level);
    return [
      '<header class="hud" role="banner">',
      '  <div class="level-badge" aria-label="等级 ' + U.esc(p.level) + '">',
      '    <span class="lv-num">' + U.esc(p.level) + '</span><span class="lv-tag">LV</span>',
      '  </div>',
      '  <div class="hud-main">',
      '    <div class="hud-title">',
      '      <span>' + U.esc(title) + '</span>',
      '      <span class="hud-coins" aria-label="金币 ' + U.esc(p.coins) + '">🪙 <span class="mono">' + U.esc(U.formatNumber(p.coins)) + '</span></span>',
      '    </div>',
      '    <div class="progress-row" style="margin-top:6px">',
      '      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + U.esc(need || p.xp) + '" aria-valuenow="' + U.esc(maxLevel ? p.xp : p.xp) + '" aria-label="经验值进度">',
      '        <i data-progress-init="' + ratio + '" style="transform:scaleX(' + ratio + ')"></i>',
      '      </div>',
      '      <span class="progress-label">' + (maxLevel ? '巅峰 ' + U.esc(U.formatNumber(p.totalXp)) : U.esc(p.xp) + '/' + U.esc(need)) + '</span>',
      '    </div>',
      '    <div class="hud-sub">',
      '      <span>🔥 ' + U.esc(save.streak.dailyStreak) + ' 天</span>',
      '      <span>已掌握 ' + U.esc(save.stats.masteredCount || 0) + ' 词</span>',
      '    </div>',
      '  </div>',
      '</header>'
    ].join('');
  }

  WQ.shell = {
    render: render,
    setActions: setActions,
    renderNotFound: renderNotFound,
    bind: bind,
    esc: escapeHtml,
    hudHtml: hudHtml,
    app: app
  };
})(window.WQ = window.WQ || {});
