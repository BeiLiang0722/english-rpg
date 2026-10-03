/* src/game/srs.js
 * 唯一职责：词库进度的 SRS 判定与增量（docs/03 §5.8 / §6.7 / §6.12）。
 * 依赖：WQ.balance、WQ.util
 * 被依赖：src/store/state.js、src/game/balance.js、src/game/questionPool.js、src/ui/pages/growth.js
 * 硬约束：纯函数，禁止 document / localStorage / Math.random。
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;
  const U = WQ.util;

  /**
   * 是否已掌握：连续答对 ≥ 2 且最近两次答对落在两个不同自然日。
   * 这是"已掌握词数"与 B4 徽章的唯一判定实现（docs/03 §6.12）。
   */
  function isMastered(p) {
    if (!p) return false;
    if (!(Number(p.consecutiveCorrect) >= 2)) return false;
    const a = U.dayOf(p.lastCorrectAt);
    const b = U.dayOf(p.prevCorrectAt);
    if (!a || !b) return false;
    return a !== b;
  }

  /** SRS 间隔档位 → 天数（0→1、1→3、3→7、7→16、16→35、35→35） */
  function nextInterval(days) {
    const table = B.srsIntervals;
    const d = Number(days) || 0;
    for (let i = 0; i < table.length; i++) {
      if (d < table[i]) return table[i];
    }
    return table[table.length - 1];
  }

  /** 取当前档位对应的天数（用于展示），未知档位返回 1 */
  function intervalForLevel(days) {
    const table = B.srsIntervals;
    const d = Number(days) || 0;
    return table.indexOf(d) >= 0 ? d : table[0];
  }

  function isoAt(now, msOffset) {
    const base = now instanceof Date ? now.getTime() : Number(now) || Date.now();
    return new Date(base + msOffset).toISOString();
  }

  /**
   * 答对：写 seenCount++ / correctCount++ / consecutiveCorrect++、
   * prevCorrectAt = lastCorrectAt、lastCorrectAt = now、推进 SRS 间隔。
   * @param {object} p 词进度（会被就地修改）
   * @param {string} wordId
   * @param {Date|number} now
   * @param {boolean} approximate 是否编辑距离 1 的近似正确（近似正确不推进 SRS）
   */
  function applyCorrect(p, wordId, now, approximate) {
    const w = p || WQ.save.defaultProgress(wordId);
    w.wordId = wordId;
    w.seenCount = (Number(w.seenCount) || 0) + 1;
    w.correctCount = (Number(w.correctCount) || 0) + 1;
    w.lastSeenAt = isoAt(now, 0);

    if (approximate) {
      /* 近似正确：correctCount 记，但连续数清零、SRS 不推进（docs/03 §5.3） */
      w.consecutiveCorrect = 0;
      w.mastery = 'learning';
      return w;
    }

    w.prevCorrectAt = w.lastCorrectAt || null;
    w.lastCorrectAt = isoAt(now, 0);
    w.consecutiveCorrect = (Number(w.consecutiveCorrect) || 0) + 1;
    const interval = nextInterval(Number(w.reviewIntervalDays) || 0);
    w.reviewIntervalDays = interval;
    w.nextReviewAt = isoAt(now, interval * 86400000);
    w.mastery = isMastered(w) ? 'mastered' : 'learning';
    return w;
  }

  /** 答错：wrongCount++、consecutiveCorrect = 0、间隔重置为 1 天、nextReviewAt = now + 1 天 */
  function applyWrong(p, wordId, now) {
    const w = p || WQ.save.defaultProgress(wordId);
    w.wordId = wordId;
    w.seenCount = (Number(w.seenCount) || 0) + 1;
    w.wrongCount = (Number(w.wrongCount) || 0) + 1;
    w.consecutiveCorrect = 0;
    w.lastSeenAt = isoAt(now, 0);
    w.lastWrongAt = isoAt(now, 0);
    w.reviewIntervalDays = B.srsIntervals[0];
    w.nextReviewAt = isoAt(now, B.srsIntervals[0] * 86400000);
    w.mastery = w.correctCount > 0 ? 'learning' : 'new';
    return w;
  }

  /**
   * 跳过：不写任何字段（等于没发生，docs/03 §5.3）。
   * @returns {object} 原样返回
   */
  function applySkip(p, wordId) {
    return p || WQ.save.defaultProgress(wordId);
  }

  /** 重新计算并缓存 mastery（结算后统一刷新一次） */
  function refreshMastery(p) {
    if (!p) return p;
    if (isMastered(p)) p.mastery = 'mastered';
    else if ((Number(p.seenCount) || 0) > 0) p.mastery = 'learning';
    else p.mastery = 'new';
    return p;
  }

  WQ.srs = {
    isMastered: isMastered,
    nextInterval: nextInterval,
    intervalForLevel: intervalForLevel,
    applyCorrect: applyCorrect,
    applyWrong: applyWrong,
    applySkip: applySkip,
    refreshMastery: refreshMastery
  };
})(window.WQ = window.WQ || {});
