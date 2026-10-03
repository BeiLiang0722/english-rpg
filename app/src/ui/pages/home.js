/* src/ui/pages/home.js
 * 唯一职责：#/home 营地页渲染与交互（docs/03 §4.1）。
 * 依赖：WQ.shell、WQ.state、WQ.flow、WQ.router、WQ.anim、WQ.util、WQ.streak、WQ.ach、WQ.balance
 * 被依赖：src/main.js（路由注册）
 *
 * 首页必显：当前等级、XP 进度条、血量、今日已答题数、连续打卡天数（任务硬性要求 3）。
 */
(function (WQ) {
  'use strict';

  const U = WQ.util;
  const B = WQ.balance;

  /** 进入营地：跨天结算 + streak 判定 + 一次性提示（冰冻/断连/中断） */
  function enter() {
    const save = WQ.state.save;
    const now = new Date();
    const before = {
      pendingBreak: save.streak.pendingBreak,
      dailyStreak: save.streak.dailyStreak
    };
    const res = WQ.game.rolloverDaily(save, now);
    WQ.actions.commit();

    /* 中断提示（对局中刷新页面） */
    if (WQ.state.ui.interruptNotice) {
      WQ.state.ui.interruptNotice = null;
      WQ.toast.show('上一局已中断，已获得的 XP 与金币已保留');
    }

    if (res && res.stage === 'protected' && res.freezeUsed > 0) {
      WQ.toast.show('已自动使用冰冻卡 ×' + res.freezeUsed + '，连击延续');
    }
    if (res && res.stage === 'broken' && before.dailyStreak > 0) {
      WQ.toast.show('连击重新开始了，上次是 ' + before.dailyStreak + ' 天。今天继续。');
    }
    if (WQ.state.ui.multiTabNotice) {
      WQ.state.ui.multiTabNotice = false;
      WQ.toast.show('存档已在其他标签页更新');
    }
    /* 回补卡已在库但尚未使用时的中性提示 */
    if (WQ.streak.canRepair(save) && Number(save.streak.repairCards) > 0) {
      WQ.toast.show('你有一张回补卡，点顶部提示条即可接上连击');
    }
    WQ.log.add('appOpen', { localDate: U.todayKey(now) });
  }

  function pendingBreakBanner(save) {
    if (!WQ.streak.canRepair(save)) return '';
    const before = Number(save.streak.streakBeforeBreak) || 0;
    return [
      '<div class="banner" role="status">',
      '  <span>有 1 天可以用回补卡接上' + (Number(save.streak.repairCards) > 0 ? '（已持有回补卡）' : '，40 金币') + '。上次是 ' + U.esc(before) + ' 天。</span>',
      '  <button class="btn btn-sm btn-ghost" type="button" data-action="repair">' + (Number(save.streak.repairCards) > 0 ? '使用回补卡' : '去商店') + '</button>',
      '</div>'
    ].join('');
  }

  function persistBanner() {
    if (WQ.persistStatus !== 'failed') return '';
    return '<div class="banner banner-warn" role="status">本次进度未保存（浏览器存储不可用），游戏仍可继续</div>';
  }

  /** 今日战斗卡：未完成 / 已完成 ✓ */
  function dailyCard(save) {
    const done = !!save.daily.todayFirstRoundDone;
    return [
      '<section class="home-cta-card">',
      '  <div class="home-cta-head">',
      '    <h2 class="home-cta-title">今日战斗</h2>',
      '    <span class="chip ' + (done ? 'chip-success' : 'chip-muted') + '">' + (done ? '已完成 ✓' : '未完成') + '</span>',
      '  </div>',
      '  <button class="btn btn-primary btn-block" type="button" data-action="start">' + (done ? '再来一局' : '开始一局') + '</button>',
      done ? '' : '<p class="home-cta-note">今日首局 +' + B.xp.dailyFirstXp + ' XP · +' + B.coins.dailyFirst + ' 金币</p>',
      '  <p class="overlay-text">每局 ' + B.round.questionCount + ' 题 · ' + B.hp.max + ' 颗心 · 答错掉 1 颗心</p>',
      '  <button class="btn btn-sm btn-ghost btn-block" style="margin-top:8px" type="button" data-action="wrongBook"' + (wrongBookCount(save) ? '' : ' aria-disabled="true"') + '>只打错词（' + U.esc(wrongBookCount(save)) + ' 个待复活）</button>',
      '</section>'
    ].join('');
  }

  function wrongBookCount(save) {
    const progress = save.progress || {};
    return Object.keys(progress).filter(function (id) { return Number(progress[id].wrongCount) > 0; }).length;
  }

  /** 今日状态：今日已答题数、正确率、今日 XP、今日金币 */
  function todayGrid(save) {
    const t = WQ.state.todayStats;
    const acc = t.questions ? Math.round((t.correct / t.questions) * 100) : null;
    return [
      '<section class="card">',
      '  <h2 class="card-title"><span>今日状态</span><span>🔥 ' + U.esc(save.streak.dailyStreak) + ' 天</span></h2>',
      '  <div class="home-today-grid">',
      statCell('今日已答', t.questions + ' 题'),
      statCell('今日正确率', acc == null ? '--' : acc + '%'),
      statCell('今日 XP', '+' + t.xp),
      statCell('今日金币', '+' + t.coins),
      '  </div>',
      '</section>'
    ].join('');
  }

  function statCell(label, value) {
    return '<div class="stat"><div class="stat-value mono">' + U.esc(value) + '</div><div class="stat-label">' + U.esc(label) + '</div></div>';
  }

  /** 成长三数字卡 */
  function growthCard(save) {
    const badges = WQ.ach.getAllProgress(save).filter(function (x) { return x.unlocked; }).length;
    return [
      '<section class="card">',
      '  <h2 class="card-title">成长</h2>',
      '  <div class="stat-grid">',
      '    <div class="stat"><div class="stat-value">' + U.esc(save.stats.masteredCount || 0) + '</div><div class="stat-label">已掌握词</div></div>',
      '    <div class="stat"><div class="stat-value">' + U.esc(save.stats.totalCorrect || 0) + '</div><div class="stat-label">累计答对</div></div>',
      '    <div class="stat"><div class="stat-value is-coin">' + U.esc(badges) + '/' + WQ.achievements.length + '</div><div class="stat-label">徽章</div></div>',
      '  </div>',
      '</section>'
    ].join('');
  }

  /** 血量展示（首页也给出当前血量上限，满足"首页展示血量"要求） */
  function hpCard(save) {
    const hp = B.hp.max + Math.max(0, Number(save.profile.nextRoundHpBonus) || 0);
    const hearts = [];
    for (let i = 0; i < hp; i++) hearts.push('<span class="heart is-full">♥</span>');
    for (let i = hp; i < B.hp.max + 2; i++) hearts.push('<span class="heart">♥</span>');
    return [
      '<section class="card">',
      '  <h2 class="card-title"><span>血量</span><span>下一局 ' + U.esc(hp) + ' 颗心</span></h2>',
      '  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">',
      '    <div class="hearts" aria-label="下一局血量 ' + U.esc(hp) + ' 颗心">' + hearts.join('') + '</div>',
      '    <span class="overlay-text">答错掉 1 颗心，归零本局结束</span>',
      '  </div>',
      '</section>'
    ].join('');
  }

  /** 四宫格入口 */
  function tiles(save) {
    const badges = save.stats.masteredCount || 0;
    return [
      '<section class="grid-4">',
      tile('growth', '🏅', '成长', '徽章与称号', badges + ' 词已掌握'),
      tile('wrongTab', '📕', '错题本', '待复活 ' + wrongBookCount(save) + ' 词', '只打错词'),
      tile('shop', '🛒', '商店', '护心符 / 回补卡', '🪙 ' + save.profile.coins),
      tile('settings', '⚙️', '设置', '音效 / 字号 / 动效', '清档在这里'),
      '</section>'
    ].join('');
  }

  function tile(action, icon, name, sub, sub2) {
    return [
      '<button class="tile" type="button" data-action="' + action + '">',
      '  <span class="tile-icon">' + icon + '</span>',
      '  <span class="tile-name">' + U.esc(name) + '</span>',
      '  <span class="tile-sub">' + U.esc(sub) + '</span>',
      sub2 ? '  <span class="tile-sub">' + U.esc(sub2) + '</span>' : '',
      '</button>'
    ].join('');
  }

  /** 渲染营地页 */
  function render() {
    const save = WQ.state.save;
    WQ.shell.setActions(actions);
    WQ.shell.render([
      '<main class="page" id="main">',
      /* 每页唯一 h1：视觉标题由 HUD 承担，这里给屏幕阅读器一个准确的页面标题 */
      '<h1 class="visually-hidden">单词猎手 · 今日营地</h1>',
      WQ.shell.hudHtml(save),
      '<div style="height:12px"></div>',
      persistBanner(),
      pendingBreakBanner(save),
      dailyCard(save),
      todayGrid(save),
      hpCard(save),
      growthCard(save),
      tiles(save),
      '<p class="empty-note">双击 index.html 即可运行 · 无需联网 · 数据存在本机浏览器</p>',
      '</main>'
    ].join(''));
  }

  const actions = {
    start: function () {
      const s = WQ.flow.createSession({ source: 'normal' });
      if (!s) { WQ.toast.show('词库不可用，无法开局'); return; }
      WQ.router.go('#/battle/' + s.roundId);
    },
    wrongBook: function () {
      if (!wrongBookCount(WQ.state.save)) { WQ.toast.show('还没有需要复活的词，先打一局吧'); return; }
      const s = WQ.flow.createSession({ source: 'wrongBook' });
      if (!s) { WQ.toast.show('错词池为空'); return; }
      WQ.router.go('#/battle/' + s.roundId);
    },
    repair: function () {
      const save = WQ.state.save;
      if (Number(save.streak.repairCards) > 0) {
        const res = WQ.streak.consumeRepairCard(save, new Date());
        WQ.actions.commit();
        if (res.repaired) WQ.toast.show('连击已接上：' + res.streak + ' 天');
      } else {
        WQ.router.go('#/shop');
      }
    },
    growth: function () { WQ.router.go('#/growth'); },
    wrongTab: function () { WQ.router.go('#/growth?tab=wrong'); },
    shop: function () { WQ.router.go('#/shop'); },
    settings: function () { WQ.router.go('#/settings'); }
  };

  WQ.pages = WQ.pages || {};
  WQ.pages.home = { enter: enter, render: render, actions: actions };
})(window.WQ = window.WQ || {});
