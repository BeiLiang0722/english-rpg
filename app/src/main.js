/* src/main.js
 * 唯一职责：启动编排（装配命名空间 → 读档 → 词库校验 → 注册路由 → 首屏）。
 * 依赖：全部模块（本文件必须最后加载）
 * 被依赖：index.html
 *
 * 启动性能目标：从脚本开始执行到营地可见 ≤600ms（docs/04 T1.22）。
 */
(function (WQ) {
  'use strict';

  const BOOT_BUDGET_MS = 600;
  let bootStarted = 0;

  function ensureState() {
    /* 保证 state.save / settings 一定存在（即使某项初始化失败也不白屏） */
    if (!WQ.state.save) WQ.state.save = WQ.save.fillDefaults(WQ.save.defaultSave());
    if (!WQ.state.settings) WQ.state.settings = WQ.save.defaultSettings();
  }

  /** 词库可用性校验（docs/03 §7.4：不允许用空词库开局） */
  function checkWords() {
    const list = WQ.WORDS;
    if (!Array.isArray(list) || !list.length) return { ok: false, reason: 'WQ.WORDS 为空或不是数组' };
    const bad = list.filter(function (w) { return !w || !w.id || !w.word || !w.meaning_cn || !w.example; });
    if (bad.length) return { ok: false, reason: '有 ' + bad.length + ' 条词缺少必填字段' };
    return { ok: true, count: list.length };
  }

  /** 注册全部路由（docs/03 §3.3） */
  function registerRoutes() {
    WQ.router.register('#/boot', function () { WQ.pages.boot.render(1, '就绪'); });
    /* 营地渲染内部会再跑一次 enter()（跨天结算 + 一次性提示），保证长时间不刷新也能正确跨天（修 D15） */
    WQ.router.register('#/home', function () { WQ.pages.home.render(); });
    WQ.router.register('#/battle/:roundId', function () { WQ.pages.battle.render(); });
    WQ.router.register('#/result/:roundId', function () { WQ.pages.result.render(); });
    WQ.router.register('#/growth', function () { WQ.pages.growth.render(); });
    WQ.router.register('#/shop', function () { WQ.pages.shop.render(); });
    WQ.router.register('#/settings', function () { WQ.pages.settings.render(); });
    WQ.router.register('#/selfcheck', function () { WQ.pages.selfcheck.render(); });
  }

  /** 启动 */
  function boot() {
    bootStarted = (window.performance && window.performance.now) ? window.performance.now() : Date.now();

    /* 1. 过场（真实进度：读完档才推进） */
    if (WQ.pages.boot) WQ.pages.boot.render(0.15, '正在读取本地存档…');

    /* 2. 读档（persist 内部已做损坏备份与结构补全；高版本存档会被拒绝加载，见 D6） */
    let loadRes = null;
    try {
      loadRes = WQ.actions.loadFromStore();
    } catch (e) {
      WQ.log.error('读档失败，使用默认存档', e);
    }
    ensureState();

    /* 3. 应用设置（字号 / 动效降级）+ 首次用户手势解锁 AudioContext（音效才能真正出声） */
    WQ.anim.applyFontSize(WQ.state.settings.fontSize);
    WQ.anim.applyMotionAttr();
    if (WQ.audio && WQ.audio.bindUnlock) WQ.audio.bindUnlock();

    /* 4. 词库校验 */
    const words = checkWords();
    if (!words.ok) {
      WQ.pages.boot.renderBroken(words.reason);
      return;
    }

    /* 5. 事件绑定与路由 */
    WQ.shell.bind();
    registerRoutes();
    WQ.router.start();

    /* 6. 一次性提示 */
    if (loadRes && loadRes.rejected) {
      /* D6：存档来自更新版本 —— 已拒绝加载、原文进 .bak、本次会话不再写主存档键 */
      WQ.toast.show('存档来自更新版本（version ' + U.escText(loadRes.sourceVersion) + '），已停止加载以避免覆盖；原文备份在 .bak');
    } else if (loadRes && loadRes.restored) {
      WQ.toast.show('旧存档读取失败，已备份，本次用新存档启动');
    }
    if (!WQ.persist.available()) WQ.toast.show('浏览器存储不可用，本次进度不会保存');
    if (WQ.persist.isLocked && WQ.persist.isLocked()) {
      WQ.state.ui.saveLocked = true;
    }

    /* 7. 上一次对局是否中断：优先「补结算」而不是只提示（D1 的核心修复） */
    let recovered = null;
    try {
      recovered = WQ.flow.recoverSession(new Date());
    } catch (e) {
      WQ.log.error('恢复上次对局失败（不阻塞启动）', e);
      WQ.persist.clearSession();
    }
    if (recovered && recovered.recovered) {
      WQ.state.ui.recoveredNotice = { xp: recovered.xp, coins: recovered.coins };
      WQ.state.ui.interruptNotice = true;
    } else if (recovered && recovered.reason === 'alreadySettled') {
      WQ.state.ui.interruptNotice = true;
    } else if (WQ.persist.readSessionRaw && WQ.persist.readSessionRaw()) {
      /* 有中断痕迹但快照结构不完整（旧版本写的 session 键、或人为构造）：
         按旧行为只提示一句，并清掉这个用不了的键 */
      WQ.persist.clearSession();
      WQ.state.ui.interruptNotice = true;
    }

    WQ.bus.on('storageExternal', function () {
      WQ.state.ui.multiTabNotice = true;
    });
    window.addEventListener('storage', WQ.persist.onStorage);

    /* 8. 落地：把营地的"进入逻辑"（跨天结算 / streak 判定 / 中断提示）显式跑一次，
       再切到目标路由——不依赖"一定是经过 #/boot 才进 #/home"这种时序假设。 */
    if (WQ.pages.home && typeof WQ.pages.home.enter === 'function') {
      try { WQ.pages.home.enter(); }
      catch (e) { WQ.log.error('营地进入逻辑失败（不阻塞渲染）', e); }
    }

    const elapsed = (window.performance && window.performance.now ? window.performance.now() : Date.now()) - bootStarted;
    const wait = Math.max(0, Math.min(BOOT_BUDGET_MS - elapsed, 320));
    window.setTimeout(function () {
      const target = (location.hash && location.hash !== '#/boot') ? location.hash : '#/home';
      if (WQ.state.route === '#/boot' || !location.hash) WQ.router.replace(target);
      else WQ.router.dispatch();
      const total = (window.performance && window.performance.now ? window.performance.now() : Date.now()) - bootStarted;
      WQ.state.boot.startedAt = total;
      if (WQ.log) WQ.log.add('appOpen', { localDate: WQ.util.todayKey(), bootMs: Math.round(total) });
    }, wait);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.WQ = window.WQ || {});
