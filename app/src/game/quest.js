/* src/game/quest.js
 * 唯一职责：每日任务（3 条/天）与随机宝箱的跨天结算、进度推进与自动发奖（docs/03 §5.9）。
 * 依赖：WQ.balance、WQ.util、WQ.log、WQ.ach
 * 被依赖：src/game/balance.js（rolloverDaily + applyRoundEnd）、src/game/flow.js（逐题推进）、
 *         src/ui/pages/home.js（渲染与开箱）
 * 硬约束：纯状态变换（只改传入的 save），不碰 document / localStorage；随机数由入参 rnd() 注入。
 *
 * 为什么必须放在这里做跨天结算：
 *   跨天重置只发生在 settle() 内部（依据 save.daily.todayDate / countersDate / chestTodayDate 三个日期键），
 *   因此「任务列表、任务状态、宝箱碎片上限」三件事在任意入口（启动、回营地、开局前）调用 settle() 都会
 *   收敛到同一结果；同一天重复调用完全幂等，跨天无论跳了几天也只会结算一次。
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;
  const U = WQ.util;

  /** 玩家本次由「答案推进」带来的增量快照，供 quest.progress / chest.onSessionStart 使用 */
  let pending = null;

  function cfg() { return B.daily || {}; }
  function chestCfg() { return B.chest || {}; }

  function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : (d == null ? 0 : d);
  }

  /** 安全取得 daily（save 结构异常时不抛） */
  function daily(save) {
    if (!save.daily || typeof save.daily !== 'object') save.daily = {};
    return save.daily;
  }

  function counters(save) {
    const d = daily(save);
    if (!d.counters || typeof d.counters !== 'object') d.counters = WQ.save.defaultCounters();
    return d.counters;
  }

  function questDef(id) {
    return (cfg().quests || []).filter(function (q) { return q.id === id; })[0] || null;
  }

  /** 今日的 3 条任务：2 条常驻 + 1 条按日期确定性轮换（同一天多次调用结果一致） */
  function pickDailyQuests(nowDate) {
    const c = cfg();
    const all = c.quests || [];
    const alwaysIds = c.alwaysIds || [];
    const always = alwaysIds.map(questDef).filter(Boolean);
    const rotating = all.filter(function (q) { return alwaysIds.indexOf(q.id) < 0; });
    const key = U.todayKey(nowDate);
    let seed = 0;
    for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) % 2147483647;
    const extraCount = Math.max(0, num(c.questCount, 3) - always.length);
    const chosen = [];
    /* 轮换池可能小于 extraCount：允许回头再取（当前池 6 条 > 1，不会发生） */
    for (let i = 0; i < extraCount && rotating.length; i++) {
      const idx = (seed + i * 7) % rotating.length;
      chosen.push(rotating[idx]);
      rotating.splice(idx, 1);
    }
    return always.concat(chosen).map(function (q) { return q.id; });
  }

  /**
   * 跨天结算（幂等）。任何入口都可调用：
   *   1. 重置今日计数器（保留跨天延续的连续答对记录）
   *   2. 按当日日期重建任务清单与状态
   *   3. 补齐宝箱（连续登录奖励 + 昨日未开箱的碎片携带，超过上限舍去）
   *   4. 发放「全部完成」加成
   * @returns {{newDay:boolean, quests:Array, bonus:boolean, chestSpawned:number}}
   */
  function settle(save, now) {
    const out = { newDay: false, quests: [], bonus: false, chestSpawned: 0, completed: [], coinGain: 0, xpGain: 0, rolled: false };
    if (!save) return out;
    const nowDate = now instanceof Date ? now : new Date(Number(now) || Date.now());
    const today = U.todayKey(nowDate);
    const d = daily(save);

    /* ---- 1. 计数器跨天重置 ---- */
    if (d.countersDate !== today) {
      if (d.countersDate) { out.newDay = true; out.rolled = true; }
      const prev = (d.counters && typeof d.counters === 'object') ? d.counters : {};
      const gap = d.countersDate ? U.dayDiff(d.countersDate, today) : null;
      let streakCorrect = Math.max(0, num(prev.streakCorrect, 0));
      /* 昨天答对过 → 连续答对记录跨天延续（宝箱碎片节奏不断档）；断了一天以上则清零 */
      if (!d.countersDate || gap == null || gap > 1) streakCorrect = 0;
      d.counters = {
        answered: 0, correct: 0, wrong: 0, combo: 0,
        streakCorrect: Math.max(0, streakCorrect),
        distinctWords: 0, newWords: 0
      };
      d.countersDate = today;
      d.seenToday = {};
      d.rollDate = null;   // 新的一天：还没打开过
    }

    /* 「今天打开了游戏」的标记。
       必须在**结算逻辑之前**读、在之后写：这样在跨天后的第一次 settle（例如直接恢复中断局）
       不会把「今日登场」白送，只有真正走过 enterDay()（进营地 / 开局）才认。 */
    const openedToday = d.rollDate === today;
    d.rollDate = today;

    /* ---- 2. 每日任务清单与状态 ---- */
    if (d.questDate !== today) {
      /* 先记下"昨天是否有过状态"，清空之后再判断本次是否算作真正跨天 */
      const hadState = !!(d.questBonusDate || (d.questIds || []).length);
      d.questDate = today;
      d.questIds = pickDailyQuests(nowDate);
      d.questProgress = {};
      d.questDone = {};
      d.questClaimed = {};
      d.questBonusClaimed = 0;
      d.questBonusDate = null;
      d.questRoundIds = {};
      d.perfectToday = 0;
      d.reclaimed = 0;
      if (hadState) { out.newDay = true; out.rolled = true; }
      WQ.log.add('questRollover', { date: today, questIds: d.questIds.slice() });
    }

    /* ---- 3. 今日任务进度（唯一事实来源是 daily.counters / daily.todayRounds，避免两处记账打架） ---- */
    const c = counters(save);
    const values = {
      /* 「今日登场」只有真正打开过游戏才算（enterDay）；否则纯结算路径会把登录任务白送 */
      login: openedToday ? 1 : 0,
      answer: num(c.answered),
      correct: num(c.correct),
      round: num(d.todayRounds),
      correctOfRound: num(c.correct),
      wrong: num(c.wrong),
      combo: num(c.streakCorrect),
      newWords: num(c.newWords),
      deck: num(c.distinctWords),
      perfect: num(d.perfectToday)
    };
    (d.questIds || []).forEach(function (id) {
      const def = questDef(id);
      if (!def) return;
      if (d.questProgress[id] == null) d.questProgress[id] = 0;
      const v = values[def.kind] == null ? 0 : values[def.kind];
      d.questProgress[id] = Math.max(num(d.questProgress[id], 0), v);
      d.questProgress[id] = Math.min(num(d.questProgress[id], 0), num(def.target, 1));
      if (!d.questDone[id] && num(d.questProgress[id], 0) >= num(def.target, 1)) {
        d.questDone[id] = true;
        out.completed.push({ id: def.id, name: def.name });
        if (!d.questClaimed[id]) {
          d.questClaimed[id] = true;
          const g = grant(save, def.coins, def.xp, 'dailyQuest', '每日任务：' + def.name);
          out.coinGain += g.coins;
          out.xpGain += g.xp;
        }
      }
    });

    /* ---- 4. 全部完成加成（每日一次） ---- */
    const allIds = d.questIds || [];
    const doneAll = allIds.length > 0 && allIds.every(function (id) { return !!d.questDone[id]; });
    if (doneAll && num(d.questBonusClaimed, 0) < 1) {
      d.questBonusClaimed = 1;
      d.questBonusDate = today;
      const g = grant(save, cfg().firstClearBonusCoins, cfg().firstClearBonusXp, 'questBonus', '每日任务全清');
      out.coinGain += g.coins;
      out.xpGain += g.xp;
      out.bonus = true;
      WQ.log.add('questBonus', { date: today });
    }

    /* ---- 5. 宝箱 ---- */
    if (d.chestTodayDate !== today) {
      const prevShards = Math.max(0, num(d.chestShards, 0));
      const closedBefore = d.chestOpenDate; // 若上一次开箱也是今天，则今天已经开过，不再白送
      d.chestTodayDate = today;
      d.chestShardsToday = 0;
      d.chestSpawns = Math.min(1, prevShards);
      d.chestShards = d.chestSpawns;
      if (closedBefore !== today && num(save.streak && save.streak.dailyStreak, 0) > 0
        && num(save.streak.dailyStreak, 0) % num(chestCfg().loginBonusDays, 7) === 0) {
        d.chestSpawns = num(d.chestSpawns, 0) + 1;
        d.chestShards = num(d.chestShards, 0) + 1;
        WQ.log.add('chestLoginBonus', { date: today, streak: num(save.streak.dailyStreak, 0) });
      }
      d.chestShards = Math.min(num(d.chestShards, 0), num(chestCfg().luckyShardCap, 4));
      out.chestSpawned = num(d.chestSpawns, 0);
      WQ.log.add('chestRollover', { date: today, shards: d.chestShards });
    }

    return out;
  }

  /**
   * 「今日登场」：进营地 / 开局时调用。跨天后第一次调用会把登录任务记进进度，
   * 同一天再调用不重复发奖（questClaimed 是幂等键）。
   * @returns {object} 与 settle() 同构的结算结果
   */
  function enterDay(save, now) {
    const nowDate = now instanceof Date ? now : new Date(Number(now) || Date.now());
    const d = daily(save);
    d.rollDate = U.todayKey(nowDate);
    return settle(save, nowDate);
  }

  /**
   * 任务发奖 —— **只记账、不改 profile**。
   *
   * 为什么：quest.settle() 会在 balance.applyRoundEnd() 的账目中间被调用。
   * 如果这里直接把金币/XP 写进 profile，profile 的增量就无法再和 RoundRecord 对账
   * （会出现"档内 XP 增量 ≠ 各明细行之和"的脏账）。因此这里只把金额汇总到 settle 的返回值，
   * 由 applyRoundEnd 在同一个账目里统一入账 —— 一处写入，处处可对账。
   */
  function grant(save, coins, xp, logKind, label) {
    const c = Math.max(0, num(coins, 0));
    const x = Math.max(0, num(xp, 0));
    if (label) WQ.log.add('grant', { kind: logKind, label: label, coins: c, xp: x, pending: true });
    return { coins: c, xp: x };
  }

  /** 渲染用的今日任务视图 */
  function list(save) {
    const d = daily(save);
    return (d.questIds || []).map(function (id) {
      const def = questDef(id);
      if (!def) return null;
      const progress = Math.min(num(d.questProgress[id], 0), num(def.target, 1));
      return {
        id: def.id,
        name: def.name,
        desc: def.desc,
        kind: def.kind,
        icon: def.icon || null,
        target: num(def.target, 1),
        progress: progress,
        ratio: num(def.target, 1) > 0 ? progress / num(def.target, 1) : 0,
        done: !!d.questDone[id],
        xp: num(def.xp, 0),
        coins: num(def.coins, 0)
      };
    }).filter(Boolean);
  }

  function allDone(save) {
    const d = daily(save);
    const ids = d.questIds || [];
    return ids.length > 0 && ids.every(function (id) { return !!d.questDone[id]; });
  }

  function progressText(save) {
    const items = list(save);
    return items.filter(function (i) { return i.done; }).length + '/' + items.length;
  }

  /**
   * 由「一次作答」推进今日进度。
   * 传进来的必须是与本次作答**一一对应的增量**（[{delta:{answered,correct,wrong}}]），
   * 而不是累计值：否则「打错 4 题」这类任务会被重复叠加。
   * 增量先进入 pending 缓冲，由 applyPending() 幂等地写进 daily.counters 并置空。
   * @param {object} save
   * @param {object} info { delta:{answered,correct,wrong}, newWords, wordId, retry }
   */
  function progress(save, info) {
    const d = daily(save);
    const o = info || {};
    const p = pending || (pending = { answered: 0, correct: 0, wrong: 0, newWords: 0, words: {} });
    if (!o.retry) {
      const delta = o.delta || {};
      p.answered += num(delta.answered, 0);
      p.correct += num(delta.correct, 0);
      p.wrong += num(delta.wrong, 0);
    }
    p.newWords += num(o.newWords, 0);
    if (o.wordId) p.words[o.wordId] = true;
    /* 重试作答不重复计题；命中率口径由 stats 在结算时按 session 汇总，与这里互不干扰 */
    applyPending(save);
    /* 立刻重新结算一次：任务可能就在这一题完成，界面与音效要当场反馈，而不是等打完这一局 */
    const res = settle(save, o.now || new Date());
    return { counters: counters(save), completed: res.completed, bonus: res.bonus, coinGain: res.coinGain, xpGain: res.xpGain };
  }

  /** 把 pending 增量写进 daily.counters（幂等：写完即清空） */
  function applyPending(save) {
    if (!pending) return;
    const c = counters(save);
    const d = daily(save);
    c.answered += num(pending.answered, 0);
    c.correct += num(pending.correct, 0);
    c.wrong += num(pending.wrong, 0);
    c.newWords += num(pending.newWords, 0);
    const words = Object.keys(pending.words || {});
    if (words.length) {
      if (!d.seenToday || typeof d.seenToday !== 'object') d.seenToday = {};
      words.forEach(function (id) {
        if (!d.seenToday[id]) {
          d.seenToday[id] = 1;
          c.distinctWords += 1;
        }
      });
    }
    pending = null;
  }

  /**
   * 由「一次结算」推进：把今日计数器与 stats 对齐，再走一次 settle。
   *
   * 为什么用「从 stats 重建」而不是「逐题累加」（v0.2 的设计选择）：
   *   · stats.daily[today] 是**唯一的**今日聚合事实来源，结算时它已经被 balance.applyRoundEnd 更新完毕；
   *   · 由它推导 counters 天然幂等（同一局重复结算、刷新后补结算、中断局都得到同一结果），
   *     不需要额外记 pending 缓冲，也不会出现"逐题加一次 + 结算再加一次"的双重记账；
   *   · 代价是任务进度在**一局结束后**才更新（营地卡片是打完一局才跳到 2/8 这种形态），
   *     换来的是账目绝对不会错 —— 对"每天愿意打开"这个目标来说，正确性比动画时机重要。
   *
   * 幂等保证：同一 roundId 只推进一次（questRoundIds 记录已推进的局）。
   */
  function advance(save, info) {
    const d = daily(save);
    const o = info || {};
    d.questProgress = d.questProgress || {};
    if (o.roundId) {
      if (!d.questRoundIds || typeof d.questRoundIds !== 'object') d.questRoundIds = {};
      if (d.questRoundIds[o.roundId]) return;
      d.questRoundIds[o.roundId] = 1;
    }
    rebuildDailyFromStats(save);
    if (o.aborted) {
      /* 中断局：收益保留，但不计入「完成局数」「一局全对」「错题本打回来」 */
      d.todayRounds = Math.max(0, num(d.todayRounds, 0) - 1);
      return;
    }
    if (o.isPerfect) d.perfectToday = num(d.perfectToday, 0) + 1;
    if (o.reclaimed) d.reclaimed = num(d.reclaimed, 0) + num(o.reclaimed, 0);
    const c = counters(save);
    c.streakCorrect = Math.max(num(c.streakCorrect, 0), num(o.maxCombo, 0));
    c.combo = num(o.maxCombo, 0);
  }

  /**
   * 用 stats.daily 重建今日计数器（幂等；跨天时只统计今天那一条）。
   * 今日"见到多少个不同词"无法从 stats 还原，因此沿用已有值（只增不减）。
   */
  function rebuildDailyFromStats(save) {
    const d = daily(save);
    const st = save.stats || {};
    const key = d.todayDate || U.todayKey();
    const rec = (st.daily && st.daily[key]) || { questions: 0, correct: 0, wrong: 0, rounds: 0 };
    const c = counters(save);
    c.answered = Math.max(0, num(rec.questions, 0));
    c.correct = Math.max(0, num(rec.correct, 0));
    c.wrong = Math.max(0, num(rec.wrong, 0));
    d.todayRounds = Math.max(0, num(rec.rounds, 0));
    return c;
  }

  /** 测试/自检用：清空 pending 缓冲 */
  function resetPending() { pending = null; }

  /**
   * 跨天后重放一份「别的标签页写进来的」daily 合并结果：
   * 用于 persist.mergeSave 之后把任务状态补齐（不清账、不重复发奖）。
   */
  function healAfterMerge(save) {
    const d = daily(save);
    d.questProgress = d.questProgress || {};
    d.questDone = d.questDone || {};
    d.questClaimed = d.questClaimed || {};
    return d;
  }

  WQ.quest = {
    settle: settle,
    enterDay: enterDay,
    pickDailyQuests: pickDailyQuests,
    list: list,
    allDone: allDone,
    progressText: progressText,
    progress: progress,
    advance: advance,
    grant: grant,
    questById: questDef,
    resetPending: resetPending,
    healAfterMerge: healAfterMerge,
    applyPending: applyPending
  };
})(window.WQ = window.WQ || {});
