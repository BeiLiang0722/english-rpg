/* src/game/chest.js
 * 唯一职责：随机宝箱（碎片积累 → 开箱 → 随机档位奖励）（docs/03 §5.9）。
 * 依赖：WQ.balance、WQ.util、WQ.log、WQ.quest
 * 被依赖：src/game/quest.js（跨天结算时补齐碎片）、src/ui/pages/home.js（开箱）
 * 硬约束：纯状态变换；随机源默认 Math.random，可被测试注入（setRandom）。
 *
 * 设计口径（为什么「每日可开、上限很小」）：
 *   碎片 = 每 3 次连续答对 1 枚，单日最多 3 枚，3 枚开 1 箱 → 一天最多 1 箱、且必须在当天兑现。
 *   因此宝箱既提供「今天再打一局就够开箱了」的近端目标，又不会因囤积造成跨天数值失控；
 *   连续 7 天登录额外白送 1 箱，让「每天都来」比「一次打很多」更划算。
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;
  const U = WQ.util;

  /** 随机源（测试可注入） */
  let random = Math.random;

  function setRandom(fn) { random = typeof fn === 'function' ? fn : Math.random; }
  function cfg() { return B.chest || {}; }

  function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : (d == null ? 0 : d);
  }

  function daily(save) {
    if (!save.daily || typeof save.daily !== 'object') save.daily = {};
    const d = save.daily;
    if (d.chestShards == null) d.chestShards = 0;
    if (d.chestShardsToday == null) d.chestShardsToday = 0;
    if (d.chestSpawns == null) d.chestSpawns = 0;
    if (!Array.isArray(d.chestHistory)) d.chestHistory = [];
    return d;
  }

  /** 按权重掷档位（纯函数，r ∈ [0,1)） */
  function roll(r) {
    const tiers = cfg().tiers || [];
    const v = Math.max(0, Math.min(0.999999, Number(r) || 0));
    const total = tiers.reduce(function (a, t) { return a + num(t.weight, 0); }, 0);
    let x = v * (total > 0 ? total : 1);
    for (let i = 0; i < tiers.length; i++) {
      x -= num(tiers[i].weight, 0);
      if (x < 0) return tiers[i];
    }
    return tiers[tiers.length - 1] || null;
  }

  function tierOf(id) {
    return (cfg().tiers || []).filter(function (t) { return t.id === Number(id); })[0] || null;
  }

  /** 今日是否还有一次「碎片结算」机会（每日上限） */
  function shardRoom(save) {
    const d = daily(save);
    return Math.max(0, num(cfg().luckyShardCap, 4) - num(d.chestShardsToday, 0));
  }

  /**
   * 由今日连续答对记录结算碎片：
   *  - 每答出 3 次连续答对 → 1 枚碎片（由 counters.streakCorrect 直接换算，天然幂等）
   *  - 单日上限 B.chest.shardsPerDay（默认 3）枚；若今日连续答对达到 luckyStreakPerBonus（默认 7）
   *    再多给 1 枚，总上限 luckyShardCap（默认 4）
   *  - 未开箱的碎片可带到次日，但次日重新按上限补齐（settle() 里做的），不会无限囤积
   * @returns {{earned:number, shards:number, today:number, cap:number}}
   */
  function syncShards(save, now) {
    const d = daily(save);
    const c = (save.daily && save.daily.counters) || {};
    const streak = Math.max(0, num(c.streakCorrect, 0));
    const per = Math.max(1, num(cfg().correctStreakPerShard, 3));
    const baseCap = Math.max(0, num(cfg().shardsPerDay, 3));
    const hardCap = Math.max(baseCap, num(cfg().luckyShardCap, 4));
    const earnedByStreak = Math.floor(streak / per);
    const luckyBonus = streak >= num(cfg().luckyStreakPerBonus, 7) ? 1 : 0;
    const targetToday = Math.min(hardCap, earnedByStreak + luckyBonus);

    const before = num(d.chestShardsToday, 0);
    const delta = Math.max(0, targetToday - before);
    if (delta > 0) {
      d.chestShardsToday = targetToday;
      d.chestShards = num(d.chestShards, 0) + delta;
      WQ.log.add('chestShard', { date: U.todayKey(now), delta: delta, shards: d.chestShards, streak: streak });
    }
    return { earned: delta, shards: num(d.chestShards, 0), today: num(d.chestShardsToday, 0), cap: hardCap };
  }

  /** 今日是否已开过箱（每日最多 1 箱，由碎片上限 + 开箱记账共同保证） */
  function openedToday(save, now) {
    const d = daily(save);
    return d.chestOpenDate === U.todayKey(now);
  }

  /** 能否开箱 */
  function canOpen(save, now) {
    const d = daily(save);
    const need = Math.max(1, num(cfg().shardsRequired, 3));
    if (openedToday(save, now)) return false;
    return num(d.chestShards, 0) >= need;
  }

  /** 还差多少碎片 */
  function missing(save) {
    const d = daily(save);
    const need = Math.max(1, num(cfg().shardsRequired, 3));
    return Math.max(0, need - num(d.chestShards, 0));
  }

  /**
   * 开箱（唯一写入口，幂等由 chestOpenDate 保证）。
   * @returns {{ok:boolean, reason?:string, tier?:object, coins?:number, xp?:number}}
   */
  function open(save, now) {
    if (!save) return { ok: false, reason: 'noSave' };
    const nowDate = now instanceof Date ? now : new Date(Number(now) || Date.now());
    const d = daily(save);
    if (openedToday(save, nowDate)) return { ok: false, reason: 'openedToday' };
    const need = Math.max(1, num(cfg().shardsRequired, 3));
    if (num(d.chestShards, 0) < need) return { ok: false, reason: 'notEnough' };

    const tier = roll(random());
    if (!tier) return { ok: false, reason: 'noTier' };

    d.chestShards = num(d.chestShards, 0) - need;
    d.chestOpenDate = U.todayKey(nowDate);
    d.chestHistory = (Array.isArray(d.chestHistory) ? d.chestHistory : []).slice(-29);
    d.chestHistory.push({ date: d.chestOpenDate, tier: tier.id, coins: tier.coins, xp: tier.xp });

    save.profile.coins = num(save.profile.coins, 0) + num(tier.coins, 0);
    save.profile.xp = num(save.profile.xp, 0) + num(tier.xp, 0);
    save.profile.totalXp = num(save.profile.totalXp, 0) + num(tier.xp, 0);
    save.profile.chestOpenedTotal = num(save.profile.chestOpenedTotal, 0) + 1;
    if (save.stats) save.stats.coinsEarned = num(save.stats.coinsEarned, 0) + num(tier.coins, 0);

    WQ.log.add('chestOpen', {
      date: d.chestOpenDate, tier: tier.id, coins: num(tier.coins, 0), xp: num(tier.xp, 0),
      openedTotal: save.profile.chestOpenedTotal
    });

    return { ok: true, tier: tier, coins: num(tier.coins, 0), xp: num(tier.xp, 0) };
  }

  /** 渲染用视图 */
  function view(save, now) {
    const d = daily(save);
    const need = Math.max(1, num(cfg().shardsRequired, 3));
    const shards = num(d.chestShards, 0);
    const opened = openedToday(save, now);
    return {
      shards: shards,
      required: need,
      pips: Math.min(need, shards),
      todayEarned: num(d.chestShardsToday, 0),
      dailyCap: Math.max(0, num(cfg().shardsPerDay, 3)),
      hardCap: Math.max(num(cfg().shardsPerDay, 3), num(cfg().luckyShardCap, 4)),
      missing: Math.max(0, need - shards),
      opened: opened,
      canOpen: canOpen(save, now),
      openedTotal: num(save.profile && save.profile.chestOpenedTotal, 0),
      streakCorrect: num((save.daily && save.daily.counters && save.daily.counters.streakCorrect), 0),
      correctStreakPerShard: Math.max(1, num(cfg().correctStreakPerShard, 3)),
      luckyStreakPerBonus: num(cfg().luckyStreakPerBonus, 7),
      loginBonusDays: num(cfg().loginBonusDays, 7),
      lastReward: (Array.isArray(d.chestHistory) && d.chestHistory.length)
        ? d.chestHistory[d.chestHistory.length - 1] : null,
      tiers: cfg().tiers || []
    };
  }

  WQ.chest = {
    roll: roll,
    tierOf: tierOf,
    setRandom: setRandom,
    syncShards: syncShards,
    shardRoom: shardRoom,
    openedToday: openedToday,
    canOpen: canOpen,
    missing: missing,
    open: open,
    view: view
  };
})(window.WQ = window.WQ || {});
