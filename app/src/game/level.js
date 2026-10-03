/* src/game/level.js
 * 唯一职责：等级曲线、称号、升级结算（docs/03 §5.2 / §4.5）。
 * 依赖：WQ.balance、WQ.log
 * 被依赖：src/store/state.js、src/game/balance.js、src/ui/pages/growth.js
 * 硬约束：纯逻辑，禁止 document / localStorage / Math.random。
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;

  /** 升到下一级需要多少 XP：60 + 10 * level（level ∈ [1,19]） */
  function needXp(level) {
    const l = WQ.util.clamp(level, 1, B.level.max);
    return B.level.needXpBase + B.level.needXpStep * l;
  }

  /** 到达 n 级所需的累计 XP：60(n-1) + 5n(n-1)；n=1→0、n=2→70、n=5→340、n=20→3040 */
  function cumulativeXpForLevel(n) {
    const l = WQ.util.clamp(n, 1, B.level.max);
    return B.level.needXpBase * (l - 1) + 5 * l * (l - 1);
  }

  /** 等级称号；越界时钳制到 1..20 */
  function titleFor(level) {
    const l = WQ.util.clamp(level, 1, B.level.max);
    return B.level.titles[l] || B.level.titles[1];
  }

  /**
   * 升级判定循环（docs/03 §4.5）：level<20 且 xp>=needXp(level) 则升级，每次 +30 金币。
   * 就地修改传入的 profile，并返回升级明细。
   * @param {{level:number,xp:number,coins:number}} profile
   * @returns {{levelUps: Array<{from:number,to:number,title:string,xpAfter:number}>, coinsFromLevels:number, reachedMax:boolean}}
   */
  function applyLevelUps(profile) {
    const levelUps = [];
    let coinsFromLevels = 0;
    if (!profile || typeof profile !== 'object') return { levelUps: levelUps, coinsFromLevels: 0, reachedMax: false };

    /* 满级钳制：异常数据 level > 20 时把 xp 归入总数不再升级 */
    if (profile.level > B.level.max) {
      profile.level = B.level.max;
      profile.xp = 0;
    }

    let guard = 0;
    while (profile.level < B.level.max && profile.xp >= needXp(profile.level) && guard < 100) {
      guard++;
      const from = profile.level;
      profile.xp -= needXp(profile.level);
      profile.level += 1;
      profile.coins = (Number(profile.coins) || 0) + B.coins.levelUp;
      coinsFromLevels += B.coins.levelUp;
      levelUps.push({
        from: from,
        to: profile.level,
        title: titleFor(profile.level),
        xpAfter: profile.xp
      });
      if (WQ.log) WQ.log.add('levelUp', { from: from, to: profile.level, totalXp: profile.totalXp });
    }

    /* 满级后 xp 保留为"巅峰值"的一部分，总累计以 totalXp 呈现，不再升级 */

    return {
      levelUps: levelUps,
      coinsFromLevels: coinsFromLevels,
      reachedMax: profile.level >= B.level.max
    };
  }

  /** 满级后 XP 条展示用的"巅峰值" */
  function isMaxLevel(level) { return Number(level) >= B.level.max; }

  WQ.level = {
    needXp: needXp,
    cumulativeXpForLevel: cumulativeXpForLevel,
    titleFor: titleFor,
    applyLevelUps: applyLevelUps,
    isMaxLevel: isMaxLevel
  };
})(window.WQ = window.WQ || {});
