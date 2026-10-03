/* src/ui/pages/home.js
 * 唯一职责：#/home 营地页渲染与交互（docs/03 §4.1 + v0.2 §5.9 每日任务与宝箱）。
 * 依赖：WQ.shell、WQ.state、WQ.flow、WQ.router、WQ.anim、WQ.util、WQ.streak、WQ.ach、WQ.balance、
 *       WQ.quest、WQ.chest、WQ.overlay
 * 被依赖：src/main.js（路由注册）
 *
 * 首页必显：当前等级、XP 进度条、血量、今日已答题数、连续打卡天数（任务硬性要求 3）。
 * v0.2 新增：每日任务卡（3 条，自动结算）、随机宝箱卡、错题本「可重练」入口。
 * v0.2 修复：enter() 会在**每次**回到营地时执行（原来只在启动时执行一次 → 跨天不重算，验收报告 D15）。
 */
(function (WQ) {
  'use strict';

  const U = WQ.util;
  const B = WQ.balance;

  /** 是否已经完成启动期的营地进入逻辑（避免首屏重复播报一次） */
  let bootEntered = false;

  /** 进入营地：跨天结算 + streak 判定 + 一次性提示（冰冻/断连/中断/多标签/每日任务重置） */
  function enter() {
    const save = WQ.state.save;
    if (!save) return null;
    const now = new Date();
    const before = {
      pendingBreak: save.streak && save.streak.pendingBreak,
      dailyStreak: save.streak && save.streak.dailyStreak
    };
    const res = WQ.game.rolloverDaily(save, now);
    /* v0.2：「今日登场」任务的进度（跨天后第一次进营地才算，同一天幂等）。
       quest.grant 只记账、不写 profile（单点写账的设计），所以这里必须把返回的奖励真正入账，
       否则「今日登场」的 +5 金币 / +5 XP 永远发不出去。 */
    if (WQ.quest) {
      const q = WQ.quest.enterDay(save, now);
      if (q && (q.coinGain || q.xpGain)) {
        if (q.coinGain) {
          save.profile.coins = (Number(save.profile.coins) || 0) + q.coinGain;
          if (save.stats) save.stats.coinsEarned = (Number(save.stats.coinsEarned) || 0) + q.coinGain;
        }
        if (q.xpGain) {
          save.profile.xp = (Number(save.profile.xp) || 0) + q.xpGain;
          save.profile.totalXp = (Number(save.profile.totalXp) || 0) + q.xpGain;
          WQ.level.applyLevelUps(save.profile);
        }
      }
      if (q && q.completed && q.completed.length) {
        if (save.daily) save.daily.todayQuestJustDone = q.completed.map(function (x) { return x.id; });
        if (WQ.audio && WQ.audio.sfxQuestDone) WQ.audio.sfxQuestDone();
      }
      if (q && q.bonus) WQ.audio.sfxCoin();
    }
    WQ.actions.commit();

    /* 上一次对局中断（刷新/崩溃后已由 flow.recoverSession 补结算） */
    if (WQ.state.ui.interruptNotice) {
      WQ.state.ui.interruptNotice = null;
      const rec = WQ.state.ui.recoveredNotice;
      WQ.state.ui.recoveredNotice = null;
      if (rec && (rec.xp || rec.coins)) {
        WQ.toast.show('上一局已中断，已为你补结算：+' + rec.xp + ' XP · +' + rec.coins + ' 金币');
      } else {
        WQ.toast.show('上一局已中断，已获得的 XP 与金币已保留');
      }
    }

    if (res && res.stage === 'protected' && res.freezeUsed > 0) {
      WQ.toast.show('已自动使用冰冻卡 ×' + res.freezeUsed + '，连击延续');
    }
    if (res && res.stage === 'broken' && before.dailyStreak > 0) {
      WQ.toast.show('连击重新开始了，上次是 ' + before.dailyStreak + ' 天。今天继续。');
    }

    /* 多标签页：本页写盘前已把对方的进度合并进来（D3） */
    if (WQ.state.ui.multiTabMerged) {
      WQ.state.ui.multiTabMerged = false;
      WQ.state.ui.multiTabNotice = false;
      WQ.toast.show('存档已在其他标签页更新，已合并双方进度');
    } else if (WQ.state.ui.multiTabNotice) {
      WQ.state.ui.multiTabNotice = false;
      WQ.toast.show('存档已在其他标签页更新');
    }

    /* 回补卡已在库但尚未使用时的中性提示 */
    if (WQ.streak.canRepair(save) && Number(save.streak.repairCards) > 0) {
      WQ.toast.show('你有一张回补卡，点顶部提示条即可接上连击');
    }
    WQ.log.add('appOpen', { localDate: U.todayKey(now) });
    return res;
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
    if (WQ.state.ui && WQ.state.ui.saveLocked) {
      return '<div class="banner banner-warn" role="status">存档来自更新版本，本次已停止写入以免覆盖原数据（原文已备份）。</div>';
    }
    if (WQ.persistStatus !== 'failed') return '';
    return '<div class="banner banner-warn" role="status">本次进度未保存（浏览器存储不可用），游戏仍可继续</div>';
  }

  /* ---------------- 每日任务卡（v0.2） ---------------- */
  function questCard(save) {
    const items = WQ.state.quests;
    if (!items || !items.length) return '';
    const doneCount = items.filter(function (i) { return i.done; }).length;
    const allDone = doneCount === items.length;
    return [
      '<section class="card quest-card">',
      '  <h2 class="card-title"><span>每日任务</span><span>' + doneCount + '/' + items.length + ' 已完成</span></h2>',
      '  <div class="quest-head">',
      '    <span class="quest-reset">每天 0 点刷新 · 完成后自动发奖</span>',
      '    <span class="chip ' + (allDone ? 'chip-success' : 'chip-muted') + '">' + (allDone ? '全部完成 ✓' : '还差 ' + (items.length - doneCount) + ' 条') + '</span>',
      '  </div>',
      '  <div class="quest-list">',
      items.map(function (it) {
        const pct = Math.round(Math.max(0, Math.min(1, it.ratio)) * 100);
        return [
          '<div class="quest-row' + (it.done ? ' is-done' : '') + '">',
          '  <span class="quest-row-icon" aria-hidden="true">' + (it.done ? '✅' : '🎯') + '</span>',
          '  <span class="quest-row-main">',
          '    <span class="quest-row-title">' + U.esc(it.name) + '</span>',
          '    <span class="quest-row-desc">' + U.esc(it.desc) + '</span>',
          '    <span class="quest-progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + it.target + '" aria-valuenow="' + it.progress + '" aria-label="' + U.esc(it.name) + '进度">',
          '      <i class="quest-progress-fill" style="width:' + pct + '%"></i>',
          '    </span>',
          '    <span class="quest-row-desc mono" style="margin-top:4px">' + it.progress + '/' + it.target + '</span>',
          '  </span>',
          '  <span class="quest-reward chip chip-gold">🪙' + it.coins + ' · +' + it.xp + 'XP</span>',
          '</div>'
        ].join('');
      }).join(''),
      '  </div>',
      '  <div class="quest-bonus reward-row">',
      '    <span>全清加成（' + (allDone ? '已发放 ✓' : '完成全部 ' + items.length + ' 条') + '）</span>',
      '    <span class="quest-reward chip chip-gold">🪙' + (B.daily ? B.daily.firstClearBonusCoins : 20) + ' · +' + (B.daily ? B.daily.firstClearBonusXp : 10) + 'XP</span>',
      '  </div>',
      '</section>'
    ].join('');
  }

  /* ---------------- 随机宝箱卡（v0.2） ---------------- */
  function chestCard(save) {
    const v = WQ.state.chestView;
    if (!v) return '';
    const pips = [];
    for (let i = 0; i < v.required; i++) {
      pips.push('<span class="shard' + (i < v.pips ? ' is-filled' : '') + '" aria-hidden="true">◆</span>');
    }
    const per = v.correctStreakPerShard;
    const toNext = Math.max(0, per - (v.streakCorrect % per));
    const progressPct = Math.round((v.shards % v.required) / v.required * 100);
    const last = v.lastReward;
    let action;
    if (v.opened) {
      action = '<button class="btn btn-ghost btn-block chest-open-btn" type="button" disabled>今日已开启，明天再来</button>';
    } else if (v.canOpen) {
      action = '<button class="btn btn-primary btn-block chest-open-btn" type="button" data-action="openChest">开启宝箱（消耗 ' + v.required + ' ◆）</button>';
    } else {
      action = '<button class="btn btn-ghost btn-block chest-open-btn" type="button" disabled>还差 ' + v.missing + ' 枚碎片</button>';
    }
    return [
      '<section class="card chest-card">',
      '  <h2 class="card-title"><span>随机宝箱</span><span>已开 ' + U.esc(v.openedTotal) + ' 个</span></h2>',
      '  <div class="chest-row">',
      '    <span class="chest-icon' + (v.canOpen ? ' is-openable' : '') + '" aria-hidden="true">' + (v.opened ? '📭' : '🎁') + '</span>',
      '    <span class="chest-info">',
      '      <span class="chest-title">' + (v.opened ? '今天的宝箱已经开过啦' : (v.canOpen ? '宝箱就绪，随时可开' : '碎片 ' + v.shards + '/' + v.required)) + '</span>',
      '      <span class="chest-shards" role="img" aria-label="碎片 ' + v.shards + ' / ' + v.required + '">' + pips.join('') + '</span>',
      '      <span class="chest-desc">' + (v.opened
        ? '明天 0 点刷新；连续 ' + (B.chest ? B.chest.loginBonusDays : 7) + ' 天登录会额外白送 1 个宝箱'
        : (v.canOpen ? '开出普通 / 稀有 / 传说三档奖励' : '再连续答对 ' + toNext + ' 次得 1 枚碎片（今日 ' + v.todayEarned + '/' + v.dailyCap + '）')) + '</span>',
      '    </span>',
      '  </div>',
      '  <span class="chest-progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + v.required + '" aria-valuenow="' + (v.shards % v.required || (v.opened ? v.required : 0)) + '" aria-label="宝箱碎片进度">',
      '    <i class="quest-progress-fill" style="width:' + (v.opened ? 100 : progressPct) + '%"></i>',
      '  </span>',
      last ? '<p class="overlay-text">上次开出：' + U.esc(tierName(last.tier)) + '（🪙' + U.esc(last.coins) + ' · +' + U.esc(last.xp) + 'XP）</p>' : '',
      '  <div class="chest-actions" style="margin-top:10px">' + action + '</div>',
      '</section>'
    ].join('');
  }

  function tierName(id) {
    const tiers = (B.chest && B.chest.tiers) || [];
    const t = tiers.filter(function (x) { return x.id === Number(id); })[0];
    return t ? t.name : '普通';
  }

  /** 开箱：掷档位 → 发奖 → 弹结果 → 逐项动效 */
  function openChest() {
    const save = WQ.state.save;
    const res = WQ.chest.open(save, new Date());
    if (!res.ok) {
      const msg = res.reason === 'openedToday' ? '今天的宝箱已经开过了，明天再来'
        : res.reason === 'notEnough' ? '碎片还不够' : '宝箱暂时打不开';
      WQ.toast.show(msg);
      render();
      return;
    }
    /* 先落库再播放动效（动效不阻塞数据） */
    WQ.actions.commit();
    WQ.audio.sfxChestOpen(res.tier ? res.tier.id : 1);

    /* 徽章：B14 宝箱猎人（解锁不可逆，最多一个新徽章） */
    const ach = WQ.ach.checkAchievements(save, new Date(), {});
    if (ach.unlocked && ach.unlocked.length) WQ.actions.commit();

    render();
    WQ.overlay.chestResult(res, function () {
      if (ach.unlocked && ach.unlocked.length) {
        WQ.overlay.badgeUnlock(ach.unlocked, null);
      }
    });
  }

  /* ---------------- 今日战斗卡 ---------------- */
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

  /** 待复活词数（D20：progress[id] 可能是 null，必须判空） */
  function wrongBookCount(save) {
    const progress = save.progress || {};
    return Object.keys(progress).filter(function (id) {
      const p = progress[id];
      return !!p && Number(p.wrongCount) > 0;
    }).length;
  }

  /** 今天可以重练（冷却已到）的错词数 —— v0.2 错题本重练 */
  function reclaimReadyCount(save, now) {
    const progress = save.progress || {};
    const nowDate = now || new Date();
    return Object.keys(progress).filter(function (id) {
      const p = progress[id];
      if (!p) return false;
      return WQ.save.reclaimState(p, nowDate).can;
    }).length;
  }

  /* ---------------- 今日状态 ---------------- */
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

  /* ---------------- 成长三数字卡 ---------------- */
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

  /* ---------------- 血量卡 ---------------- */
  function hpCard(save) {
    const hp = B.hp.max + Math.max(0, Number(save.profile.nextRoundHpBonus) || 0);
    const hearts = [];
    for (let i = 0; i < hp; i++) hearts.push('<span class="heart is-full">♥</span>');
    for (let i = hp; i < B.hp.max + 2; i++) hearts.push('<span class="heart">♥</span>');
    return [
      '<section class="card">',
      '  <h2 class="card-title"><span>血量</span><span>下一局 ' + U.esc(hp) + ' 颗心</span></h2>',
      '  <div class="hud-inline">',
      '    <div class="hearts" aria-label="下一局血量 ' + U.esc(hp) + ' 颗心">' + hearts.join('') + '</div>',
      '    <span class="overlay-text">答错掉 1 颗心，归零本局结束</span>',
      '  </div>',
      '</section>'
    ].join('');
  }

  /* ---------------- 四宫格入口 ---------------- */
  function tiles(save) {
    const badges = save.stats.masteredCount || 0;
    return [
      '<section class="grid-4">',
      tile('growth', '🏅', '成长', '徽章与称号', badges + ' 词已掌握'),
      tile('wrongTab', '📕', '错题本', '待复活 ' + wrongBookCount(save) + ' 词', '可重练 ' + reclaimReadyCount(save) + ' 词'),
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
    /* v0.2（D15）：每次回到营地都跑一次跨天结算；启动期已由 main.js 跑过一次，这里不重复。
       必须在取 save 之前跑 —— enter() 可能发「今日登场」任务奖励并升级，
       先渲染再结算会让人物栏数字比存档落后一帧。 */
    if (bootEntered) enter();
    else bootEntered = true;

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
      questCard(save),
      chestCard(save),
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
    openChest: function () { openChest(); },
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
  WQ.pages.home = { enter: enter, render: render, actions: actions, wrongBookCount: wrongBookCount, reclaimReadyCount: reclaimReadyCount };
})(window.WQ = window.WQ || {});
