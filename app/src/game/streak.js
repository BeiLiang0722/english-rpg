/* src/game/streak.js
 * 唯一职责：连续天数判定与保护（docs/03 §4.7 / §7.2）。
 * 依赖：WQ.balance、WQ.util、WQ.log
 * 被依赖：src/game/balance.js、src/game/shop.js、src/ui/pages/home.js
 * 硬约束：纯函数且幂等（同一天重复调用结果一致）。
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;
  const U = WQ.util;

  /** 跨月重置月度计数器（幂等） */
  function rolloverMonth(save, now) {
    const month = U.ymKey(now instanceof Date ? now : new Date());
    if (!save.streak) return save;
    if (save.streak.monthKey === month) return save;
    save.streak.monthKey = month;
    save.streak.freezeCards = B.streak.freezeCardsPerMonth;
    save.streak.freezeUsedThisMonth = 0;
    save.streak.repairUsedThisMonth = 0;
    save.streak.monthlyProtectedDays = 0;
    save.streak.repairCards = 0;
    /* 跨月后不再可回补 */
    save.streak.pendingBreak = false;
    return save;
  }

  /**
   * 读档/进入营地时执行（启动分支）。
   * @returns {{stage:string, missed:number, protectedDays:number, broke:boolean, freezeUsed:number}}
   */
  function rolloverStreak(save, now) {
    const out = { stage: 'none', missed: 0, protectedDays: 0, broke: false, freezeUsed: 0 };
    if (!save || !save.streak) return out;
    const nowDate = now instanceof Date ? now : new Date(Number(now) || Date.now());
    const today = U.todayKey(nowDate);
    const st = save.streak;

    rolloverMonth(save, nowDate);

    if (!st.lastStudyDate) { out.stage = 'start'; return out; }

    const gap = U.dayDiff(st.lastStudyDate, today);
    if (gap == null) { out.stage = 'none'; return out; }
    if (gap <= 0) { out.stage = 'done'; return out; }
    if (gap === 1) { out.stage = 'pending'; return out; }

    /* gap >= 2：进入断签处理 */
    const missed = gap - 1;
    out.missed = missed;
    let remaining = missed;
    while (remaining > 0
      && (Number(st.freezeUsedThisMonth) || 0) < B.streak.freezeCardsPerMonth
      && (Number(st.monthlyProtectedDays) || 0) < B.streak.monthlyProtectedMax
      && (Number(st.freezeCards) || 0) > 0) {
      st.freezeCards -= 1;
      st.freezeUsedThisMonth = (Number(st.freezeUsedThisMonth) || 0) + 1;
      st.monthlyProtectedDays = (Number(st.monthlyProtectedDays) || 0) + 1;
      /* 被保护的那一天视为"已学习"：lastStudyDate 前移，保证本函数幂等 */
      st.lastStudyDate = U.addDays(st.lastStudyDate, 1);
      out.freezeUsed += 1;
      out.protectedDays += 1;
      remaining -= 1;
    }

    if (remaining > 0) {
      /* 真断连（文档禁止任何责备性文案，这里只记录事实） */
      st.streakBeforeBreak = Number(st.dailyStreak) || 0;
      st.dailyStreak = 0;
      st.pendingBreak = (Number(st.monthlyProtectedDays) || 0) < B.streak.monthlyProtectedMax;
      out.broke = true;
      out.stage = 'broken';
      WQ.log.add('streakChange', { from: st.streakBeforeBreak, to: 0, reason: 'break' });
    } else {
      out.stage = 'protected';
    }
    return out;
  }

  /**
   * 结算分支（docs/03 §4.7 结算时）：本局完成后结清 streak。
   * @returns {{stage:string, changed:boolean}}
   */
  function settleOnRoundEnd(save, now) {
    const out = { stage: 'none', changed: false };
    if (!save || !save.streak) return out;
    const nowDate = now instanceof Date ? now : new Date(Number(now) || Date.now());
    const today = U.todayKey(nowDate);
    const st = save.streak;

    rolloverMonth(save, nowDate);

    if (!st.lastStudyDate) {
      st.dailyStreak = 1;
      st.lastStudyDate = today;
      st.longestStreak = Math.max(Number(st.longestStreak) || 0, 1);
      out.stage = 'start';
      out.changed = true;
      WQ.log.add('streakChange', { from: 0, to: 1, reason: 'start' });
      return out;
    }

    const before = Number(st.dailyStreak) || 0;
    const gap = U.dayDiff(st.lastStudyDate, today);
    if (gap == null || gap <= 0) { out.stage = 'same-day'; return out; }

    if (gap === 1) {
      st.dailyStreak = before + 1;
      st.lastStudyDate = today;
      st.pendingBreak = false;
      out.stage = 'continue';
      out.changed = true;
      WQ.log.add('streakChange', { from: before, to: st.dailyStreak, reason: 'continue' });
    } else {
      /* 先按启动分支做保护/断连，再把本局视为新的第 1 天 */
      const res = rolloverStreak(save, nowDate);
      st.dailyStreak = 1;
      st.lastStudyDate = today;
      out.stage = res.broke ? 'restart-after-break' : 'restart-after-freeze';
      out.changed = true;
    }
    st.longestStreak = Math.max(Number(st.longestStreak) || 0, Number(st.dailyStreak) || 0);
    return out;
  }

  /**
   * 回补卡：修复最近 1 天漏签，连击续接（docs/03 §4.7 回补卡）。
   * 需要满足：处于 pendingBreak、当月回补未超限、保护总额度未满。
   */
  function consumeRepairCard(save, now) {
    const out = { repaired: false, streak: 0 };
    if (!save || !save.streak) return out;
    const st = save.streak;
    const nowDate = now instanceof Date ? now : new Date(Number(now) || Date.now());

    if (!st.pendingBreak) return out;
    if ((Number(st.repairUsedThisMonth) || 0) > B.streak.repairPerMonth) return out;
    if ((Number(st.monthlyProtectedDays) || 0) >= B.streak.monthlyProtectedMax) return out;

    /* 注意：repairUsedThisMonth 已在购买事务里自增 */
    st.dailyStreak = (Number(st.streakBeforeBreak) || 0) + 1;
    st.monthlyProtectedDays = (Number(st.monthlyProtectedDays) || 0) + 1;
    if (st.lastStudyDate) st.lastStudyDate = U.addDays(st.lastStudyDate, 1);
    st.pendingBreak = false;
    st.longestStreak = Math.max(Number(st.longestStreak) || 0, Number(st.dailyStreak) || 0);
    out.repaired = true;
    out.streak = st.dailyStreak;
    WQ.log.add('streakChange', { from: 0, to: st.dailyStreak, reason: 'repair' });
    return out;
  }

  /** 是否处于"可回补"状态（营地提示条） */
  function canRepair(save) {
    const st = save && save.streak;
    if (!st || !st.pendingBreak) return false;
    if ((Number(st.monthlyProtectedDays) || 0) >= B.streak.monthlyProtectedMax) return false;
    return true;
  }

  WQ.streak = {
    rolloverMonth: rolloverMonth,
    rolloverStreak: rolloverStreak,
    settleOnRoundEnd: settleOnRoundEnd,
    consumeRepairCard: consumeRepairCard,
    canRepair: canRepair
  };
})(window.WQ = window.WQ || {});
