/* src/config/achievements.js
 * 唯一职责：docs/03-PRD §5.7 的 11 个徽章定义（含条件纯函数与进度口径）。
 * 依赖：无（condition 只读存档对象）
 * 被依赖：src/game/achievements.js、src/ui/pages/result.js
 *
 * 顺序即 B1→B11，结算时按此顺序判定与排队弹卡。
 * 奖励合计：金币 400，另 B2 额外 +50 XP。
 */
(function (WQ) {
  'use strict';

  /** 安全取数：任何异常都回落到 fallback，避免 NaN 污染进度（docs/03 §4.9 异常） */
  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }

  WQ.achievements = [
    {
      id: 'firstBlood',
      name: '初次交锋',
      icon: '⚔️',
      desc: '累计答对 1 题',
      coinReward: 25,
      xpReward: 0,
      checkOn: 'roundEnd',
      target: 1,
      condition: function (save) { return num(save.stats.totalCorrect) >= 1; },
      progress: function (save) { return num(save.stats.totalCorrect); }
    },
    {
      id: 'hundredWords',
      name: '百词斩',
      icon: '💯',
      desc: '累计答对 100 题',
      coinReward: 25,
      xpReward: 50,
      checkOn: 'roundEnd',
      target: 100,
      condition: function (save) { return num(save.stats.totalCorrect) >= 100; },
      progress: function (save) { return num(save.stats.totalCorrect); }
    },
    {
      id: 'unstoppable',
      name: '势不可挡',
      icon: '🔥',
      desc: '单局连对 8 题（无伤通关）',
      coinReward: 50,
      xpReward: 0,
      checkOn: 'roundEnd',
      target: 8,
      condition: function (save, ctx) { return num(save.stats.bestCombo) >= 8 || num(ctx && ctx.maxCombo) >= 8; },
      progress: function (save) { return num(save.stats.bestCombo); }
    },
    {
      id: 'sharpshooter',
      name: '百发百中',
      icon: '🎯',
      desc: '有 1 个词跨两天连续答对 2 次',
      coinReward: 25,
      xpReward: 0,
      checkOn: 'roundEnd',
      target: 1,
      condition: function (save, ctx) {
        return num(save.stats.masteredCount) >= 1 || num(ctx && ctx.masteredCount) >= 1;
      },
      progress: function (save) { return num(save.stats.masteredCount); }
    },
    {
      id: 'veteranHunter',
      name: '老练猎人',
      icon: '🏅',
      desc: '等级达到 5 级',
      coinReward: 25,
      xpReward: 0,
      checkOn: 'roundEnd',
      target: 5,
      condition: function (save) { return num(save.profile.level) >= 5; },
      progress: function (save) { return num(save.profile.level); }
    },
    {
      id: 'hunterLeader',
      name: '猎人领袖',
      icon: '👑',
      desc: '等级达到 10 级',
      coinReward: 50,
      xpReward: 0,
      checkOn: 'roundEnd',
      target: 10,
      condition: function (save) { return num(save.profile.level) >= 10; },
      progress: function (save) { return num(save.profile.level); }
    },
    {
      id: 'bigSpender',
      name: '挥金如土',
      icon: '🪙',
      desc: '累计消费 300 金币',
      coinReward: 25,
      xpReward: 0,
      checkOn: 'shopBuy',
      target: 300,
      condition: function (save) { return num(save.stats.coinsSpent) >= 300; },
      progress: function (save) { return num(save.stats.coinsSpent); }
    },
    {
      id: 'earlyBird',
      name: '早起鸟',
      icon: '🌅',
      desc: '在 07:00 之前完成过一局',
      coinReward: 25,
      xpReward: 0,
      checkOn: 'roundEnd',
      target: 1,
      condition: function (save, ctx) { return num(ctx && ctx.earlyBird) >= 1; },
      progress: function (save) { return hasEarlyBird(save) ? 1 : 0; }
    },
    {
      id: 'nightOwl',
      name: '夜猫子',
      icon: '🌙',
      desc: '在 23:00 之后完成过一局',
      coinReward: 25,
      xpReward: 0,
      checkOn: 'roundEnd',
      target: 1,
      condition: function (save, ctx) { return num(ctx && ctx.nightOwl) >= 1; },
      progress: function (save) { return hasNightOwl(save) ? 1 : 0; }
    },
    {
      id: 'maxHunter',
      name: '满级猎手',
      icon: '🏆',
      desc: '等级达到 20 级',
      coinReward: 100,
      xpReward: 0,
      checkOn: 'roundEnd',
      target: 20,
      condition: function (save) { return num(save.profile.level) >= 20; },
      progress: function (save) { return num(save.profile.level); }
    },
    {
      id: 'firstClear',
      name: '首次通关',
      icon: '✨',
      desc: '首次完成一局全对（8/8）',
      coinReward: 25,
      xpReward: 0,
      checkOn: 'roundEnd',
      target: 1,
      condition: function (save, ctx) { return !!(ctx && ctx.isPerfect); },
      progress: function (save) { return num(save.stats.perfectRounds) > 0 ? 1 : 0; }
    }
  ];

  /** 历史局里是否存在 07:00 前结算的一局（B8 进度用） */
  function hasEarlyBird(save) {
    const rounds = (save && save.rounds) || [];
    for (let i = 0; i < rounds.length; i++) {
      const t = WQ.util.parseTime(rounds[i] && rounds[i].endedAt);
      if (t && t.getHours() < 7) return true;
    }
    return false;
  }

  /** 历史局里是否存在 23:00 后结算的一局（B9 进度用） */
  function hasNightOwl(save) {
    const rounds = (save && save.rounds) || [];
    for (let i = 0; i < rounds.length; i++) {
      const t = WQ.util.parseTime(rounds[i] && rounds[i].endedAt);
      if (t && t.getHours() >= 23) return true;
    }
    return false;
  }

  WQ.achievementById = function (id) {
    for (let i = 0; i < WQ.achievements.length; i++) {
      if (WQ.achievements[i].id === id) return WQ.achievements[i];
    }
    return null;
  };
})(window.WQ = window.WQ || {});
