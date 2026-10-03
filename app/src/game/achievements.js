/* src/game/achievements.js
 * 唯一职责：徽章判定（结算时批量）与精确进度计算（docs/03 §4.9 / §5.7）。
 * 依赖：WQ.achievements、WQ.util、WQ.log
 * 被依赖：src/game/balance.js（结算）、src/ui/pages/result.js、src/ui/pages/growth.js
 * 硬约束：纯函数；解锁不可逆（已解锁直接跳过，不重复发奖）。
 */
(function (WQ) {
  'use strict';

  const U = WQ.util;

  /** 把秒级时刻换算成"局内本地时刻"辅助计数 */
  function localHour(iso) {
    const t = U.parseTime(iso);
    return t ? t.getHours() : null;
  }

  /** 统计历史局里的早起 / 熬夜次数（B8/B9 的进度口径，只看 rounds[].endedAt） */
  function timeBasedCounts(save) {
    const rounds = (save && save.rounds) || [];
    let early = 0;
    let night = 0;
    rounds.forEach(function (r) {
      const h = localHour(r && r.endedAt);
      if (h == null) return;
      if (h < 7) early++;
      if (h >= 23) night++;
    });
    return { earlyBird: early, nightOwl: night };
  }

  /** 单条徽章的进度：{ progress, target, text } */
  function getAchievementProgress(save, id) {
    const def = WQ.achievementById(id);
    if (!def) return { progress: 0, target: 1, text: '0/1' };
    let progress = 0;
    try {
      progress = Number(def.progress(save));
    } catch (e) {
      progress = NaN;
    }
    if (!Number.isFinite(progress)) {
      WQ.log.warn('徽章进度计算出现 NaN：' + id);
      progress = 0;
    }
    progress = Math.max(0, Math.min(progress, def.target * 1000));
    const target = def.target;
    const text = def.id === 'veteranHunter' || def.id === 'hunterLeader' || def.id === 'maxHunter'
      ? 'Lv.' + Math.min(progress, target) + '/' + target
      : Math.min(progress, target) + '/' + target;
    return { progress: progress, target: target, text: text };
  }

  /** 11 条进度一起算（徽章墙用） */
  function getAllProgress(save) {
    return WQ.achievements.map(function (def) {
      const p = getAchievementProgress(save, def.id);
      const st = (save.achievements && save.achievements[def.id]) || null;
      return Object.assign({ def: def }, p, {
        unlocked: !!(st && st.unlocked),
        unlockedAt: st && st.unlockedAt ? st.unlockedAt : null
      });
    });
  }

  /**
   * 结算时批量判定。按定义顺序返回本次新解锁数组并就地写入 save.achievements。
   *
   * 奖励发放口径（v0.2 收敛为"单点写入"）：
   *   · 默认（`ctx.deferAward` 不为真）如旧：就地写 profile.coins / profile.xp / stats.coinsEarned。
   *   · `ctx.deferAward === true` 时**不写任何 profile 字段**，只把应发的金币/XP 放进返回值的 award，
   *     由调用方在自己的同一笔账里统一入账。
   *   为什么要这个开关：applyRoundEnd 的账目里已经按"会话本体 + 明细行"算好了总额，
   *   如果徽章/升级再各自偷偷改一次 profile.coins，账就对不上（v0.2 修的一个真实脏账）。
   *
   * @param {object} save 存档（就地修改）
   * @param {Date|number} now
   * @param {object} ctx { maxCombo, isPerfect, masteredCount, level, allowIds, deferAward }
   * @returns {{save:object, unlocked:Array, award:{coins:number, xp:number}}}
   */
  function checkAchievements(save, now, ctx) {
    const unlocked = [];
    const award = { coins: 0, xp: 0 };
    if (!save) return { save: save, unlocked: unlocked, award: award };
    if (!save.achievements || typeof save.achievements !== 'object') save.achievements = {};

    const counts = timeBasedCounts(save);
    const context = Object.assign({
      maxCombo: 0,
      isPerfect: false,
      masteredCount: save.stats ? save.stats.masteredCount : 0,
      level: save.profile ? save.profile.level : 1
    }, ctx || {}, counts);
    const defer = !!(ctx && ctx.deferAward);

    const at = (now instanceof Date ? now : new Date(Number(now) || Date.now())).toISOString();
    /* ctx.allowIds：只允许判定这些徽章（用于"中断局不得解锁完成类徽章"，docs/06 D2） */
    const allowIds = (ctx && ctx.allowIds && typeof ctx.allowIds === 'object') ? ctx.allowIds : null;

    WQ.achievements.forEach(function (def) {
      if (allowIds && !allowIds[def.id]) return;
      const exist = save.achievements[def.id];
      if (exist && exist.unlocked) return; // 解锁不可逆

      let ok = false;
      try { ok = !!def.condition(save, context); } catch (e) { ok = false; }
      if (!ok) return;

      save.achievements[def.id] = {
        unlocked: true,
        unlockedAt: at,
        progress: def.target,
        bestProgress: def.target
      };
      const c = def.coinReward || 0;
      const x = def.xpReward || 0;
      if (defer) {
        award.coins += c;
        award.xp += x;
      } else {
        save.profile.coins = (Number(save.profile.coins) || 0) + c;
        if (x) {
          save.profile.xp = (Number(save.profile.xp) || 0) + x;
          save.profile.totalXp = (Number(save.profile.totalXp) || 0) + x;
        }
        if (save.stats) save.stats.coinsEarned = (Number(save.stats.coinsEarned) || 0) + c;
      }
      unlocked.push({ id: def.id, name: def.name, icon: def.icon, desc: def.desc, coinReward: def.coinReward, xpReward: def.xpReward });
      WQ.log.add('achievementUnlock', { achievementId: def.id, at: at, deferred: defer });
    });

    return { save: save, unlocked: unlocked, award: award };
  }

  WQ.ach = {
    getAchievementProgress: getAchievementProgress,
    getAllProgress: getAllProgress,
    checkAchievements: checkAchievements,
    timeBasedCounts: timeBasedCounts
  };
})(window.WQ = window.WQ || {});
