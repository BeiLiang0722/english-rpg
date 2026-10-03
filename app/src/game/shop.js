/* src/game/shop.js
 * 唯一职责：商店 4 件物品的限购计数、购买事务与待生效道具（docs/03 §5.5 / §4.11）。
 * 依赖：WQ.balance、WQ.state（存档）、WQ.streak（回补卡）、WQ.ach（B7 挥金如土）、WQ.log
 * 被依赖：src/ui/pages/shop.js、src/ui/pages/home.js
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;
  const U = WQ.util;

  function defOf(itemId) { return B.shop[itemId] || null; }

  /** 本周期已购数量 */
  function boughtCount(save, itemId) {
    const item = defOf(itemId);
    if (!item || !save) return 0;
    if (item.limitPeriod === 'daily') {
      return Math.max(0, Number((save.daily.shopDailyCount || {})[itemId]) || 0);
    }
    if (itemId === 'repairCard') return Math.max(0, Number(save.streak.repairUsedThisMonth) || 0);
    return 0;
  }

  /** 本周期剩余可购数量 */
  function remaining(save, itemId) {
    const item = defOf(itemId);
    if (!item) return 0;
    return Math.max(0, item.limit - boughtCount(save, itemId));
  }

  /**
   * 购买。
   * @returns {{ok:boolean, reason?:string, itemId:string}}
   */
  function buy(save, itemId, now) {
    const item = defOf(itemId);
    if (!save || !item) return { ok: false, reason: 'unknown', itemId: itemId };
    if (remaining(save, itemId) <= 0) return { ok: false, reason: 'soldOut', itemId: itemId };
    if ((Number(save.profile.coins) || 0) < item.price) return { ok: false, reason: 'poor', itemId: itemId };

    const nowDate = now instanceof Date ? now : new Date(Number(now) || Date.now());

    /* 扣币 + 记账 */
    save.profile.coins -= item.price;
    save.stats.coinsSpent = (Number(save.stats.coinsSpent) || 0) + item.price;

    /* 限购计数 */
    if (item.limitPeriod === 'daily') {
      save.daily.shopDailyCount = save.daily.shopDailyCount || {};
      save.daily.shopDailyCount[itemId] = (Number(save.daily.shopDailyCount[itemId]) || 0) + 1;
    } else if (itemId === 'repairCard') {
      save.streak.repairUsedThisMonth = (Number(save.streak.repairUsedThisMonth) || 0) + 1;
    }

    /* 效果登记（v0.2 起写入 profile，避免被 fillDefaults 白名单丢弃，修验收报告 D5） */
    let repaired = null;
    if (itemId === 'heartGuard') {
      save.profile.nextRoundHpBonus = (Number(save.profile.nextRoundHpBonus) || 0) + 1;
    } else if (itemId === 'scoutEye') {
      save.profile.pendingScoutEye = Math.max(0, Number(save.profile.pendingScoutEye) || 0) + B.scoutEyeExcludes;
    } else if (itemId === 'strawDouble') {
      save.profile.pendingStrawDouble = true;
    } else if (itemId === 'repairCard') {
      /* 有可修复漏天时立即修复并接上连击 */
      const res = WQ.streak.consumeRepairCard(save, nowDate);
      if (res && res.repaired) repaired = res;
      else save.streak.repairCards = (Number(save.streak.repairCards) || 0) + 1;
    }

    WQ.log.add('shopBuy', {
      itemId: itemId,
      price: item.price,
      coinsAfter: save.profile.coins,
      dailyRemaining: remaining(save, itemId)
    });

    /* B7 挥金如土：购买后立即判定 */
    const ach = WQ.ach.checkAchievements(save, nowDate, {
      maxCombo: save.stats.bestCombo,
      isPerfect: false,
      masteredCount: save.stats.masteredCount,
      level: save.profile.level
    });

    return { ok: true, itemId: itemId, repaired: repaired, unlocked: ach.unlocked };
  }

  /** 待生效道具状态条文案 */
  function pendingEffects(save) {
    const list = [];
    const scoutEye = Math.max(0, Number(save.profile.pendingScoutEye) || Number(save.pendingScoutEye) || 0);
    const straw = !!(save.profile.pendingStrawDouble || save.pendingStrawDouble);
    if (Number(save.profile.nextRoundHpBonus) > 0) list.push('护心符 ×' + save.profile.nextRoundHpBonus + '（下一局 ' + (B.hp.max + save.profile.nextRoundHpBonus) + ' 颗心）');
    if (scoutEye > 0) list.push('侦查之眼（下一局排除 ' + scoutEye + ' 个错误选项）');
    if (straw) list.push('替身稻草人（下一局首次血量归零时复活）');
    if (Number(save.streak.repairCards) > 0) list.push('回补卡 ×' + save.streak.repairCards + '（可在营地提示条使用）');
    return list;
  }

  WQ.shop = {
    defOf: defOf,
    boughtCount: boughtCount,
    remaining: remaining,
    buy: buy,
    pendingEffects: pendingEffects
  };
})(window.WQ = window.WQ || {});
