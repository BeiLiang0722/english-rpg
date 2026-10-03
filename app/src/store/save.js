/* src/store/save.js
 * 唯一职责：存档默认值工厂、设置默认值、版本迁移、结构补全。
 * 依赖：WQ.balance（版本号与常量）、WQ.util（本地日期）
 * 被依赖：src/store/persist.js、src/store/state.js、src/game/balance.js
 * 字段口径：docs/03-PRD §6.2 – §6.11（逐字段照抄）+ v0.2 新增字段（docs/03 §5.9 / §6.13）
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;
  const U = WQ.util;

  /** §6.6 Stats 骨架（byType 5 项必须预置，避免统计页取到 undefined） */
  function defaultByType() {
    const out = {};
    WQ.questionTypeOrder.forEach(function (t) {
      out[t] = { questions: 0, correct: 0, totalMs: 0 };
    });
    return out;
  }

  function defaultProfile() {
    return {
      xp: 0,
      totalXp: 0,
      level: 1,
      coins: 0,
      hpMax: B.hp.max,
      nextRoundHpBonus: 0,
      /* v0.2：待生效道具从 save 顶层迁进 profile（修验收报告 D5 —— 顶层字段会被白名单丢弃） */
      pendingScoutEye: 0,
      pendingStrawDouble: false,
      /* v0.2：累计开箱次数（B14 徽章的进度口径） */
      chestOpenedTotal: 0,
      nickname: '猎人'
    };
  }

  /** v0.2：今日计数器骨架（每日任务 / 宝箱碎片的唯一事实来源） */
  function defaultCounters() {
    return {
      answered: 0,
      correct: 0,
      wrong: 0,
      combo: 0,          // 今日「当前」连续答对
      streakCorrect: 0,  // 今日连续答对的最好记录（用于宝箱碎片，可跨天延续）
      distinctWords: 0,  // 今日见到的不同词数
      newWords: 0        // 今日首次接触的词数
    };
  }

  function defaultDaily(now) {
    const t = now instanceof Date ? now : new Date();
    return {
      todayDate: U.todayKey(t),
      todayFirstRoundDone: false,
      todayRounds: 0,
      todayAttempts: 0,        // v0.2：含中断局的本日开局次数
      todayCorrect: 0,
      todayWrong: 0,
      todayXp: 0,
      todayCoins: 0,
      shopDailyCount: {},
      shopMonthKey: U.ymKey(t),
      /* --- v0.2 每日任务与随机宝箱（跨天结算见 game/quest.js settle()） --- */
      counters: defaultCounters(),
      countersDate: null,          // counters 归属的本地日期（与 todayDate 分开，迁移时才能正确重置）
      rollDate: null,              // v0.2：最后一次「打开过游戏」的日期（每日任务「今日登场」的口径）
      seenToday: {},               // 今日已见过的 wordId（用于「碰 N 个新词」）
      questDate: null,
      questIds: [],
      questProgress: {},
      questDone: {},
      questClaimed: {},            // 已发奖的条目（幂等键，重复 settle 不重复发奖）
      questRoundIds: {},           // 已推进过任务进度的 roundId（防止重复结算叠加局数）
      questBonusClaimed: 0,        // 0/1，全清加成是否已发
      questBonusDate: null,
      chestShards: 0,
      chestShardsToday: 0,
      chestTodayDate: null,
      chestSpawns: 0,              // 今日已经「产生」的宝箱数
      chestOpenDate: null,
      chestHistory: [],
      reclaimed: 0,                // 今日从错题本打回来的词数
      perfectToday: 0
    };
  }

  function defaultStreak(now) {
    const t = now instanceof Date ? now : new Date();
    return {
      dailyStreak: 0,
      longestStreak: 0,
      lastStudyDate: null,
      streakBeforeBreak: 0,
      freezeCards: B.streak.freezeCardsPerMonth,
      freezeUsedThisMonth: 0,
      repairCards: 0,
      repairUsedThisMonth: 0,
      monthlyProtectedDays: 0,
      monthKey: U.ymKey(t),
      pendingBreak: false
    };
  }

  function defaultStats() {
    return {
      totalRounds: 0,
      totalQuestions: 0,
      totalCorrect: 0,
      totalWrong: 0,
      totalSkipped: 0,
      bestCombo: 0,
      perfectRounds: 0,
      totalStudyMs: 0,
      coinsEarned: 0,
      coinsSpent: 0,
      masteredCount: 0,
      deckSize: (WQ.WORDS && WQ.WORDS.length) || 0,
      daily: {},
      byType: defaultByType()
    };
  }

  /** §6.2 顶层 Save 默认值 */
  function defaultSave(now) {
    const t = now instanceof Date ? now : new Date();
    return {
      version: B.saveVersion,
      createdAt: t.toISOString(),
      profile: defaultProfile(),
      daily: defaultDaily(t),
      progress: {},
      rounds: [],
      achievements: {},
      stats: defaultStats(),
      streak: defaultStreak(t)
    };
  }

  /** §6.11 Settings 默认值（5 个键，一个不多一个不少） */
  function defaultSettings() {
    return {
      autoSpeak: false,
      sfxEnabled: true,
      reducedMotion: false,
      fontSize: 'md',
      showAnswerOnWrong: true
    };
  }

  /** §6.7 WordProgress 默认值 */
  function defaultProgress(wordId) {
    return {
      wordId: wordId,
      seenCount: 0,
      correctCount: 0,
      wrongCount: 0,
      consecutiveCorrect: 0,
      lastSeenAt: null,
      lastCorrectAt: null,
      prevCorrectAt: null,
      lastWrongAt: null,
      nextReviewAt: null,
      reviewIntervalDays: 0,
      mastery: 'new'
    };
  }

  function num(v, fallback) {
    return Number.isFinite(Number(v)) ? Number(v) : fallback;
  }

  function bool(v, fallback) {
    return typeof v === 'boolean' ? v : fallback;
  }

  function str(v, fallback) {
    return typeof v === 'string' ? v : fallback;
  }

  /**
   * 结构补全：逐字段补齐缺失项，对数值字段做 Number.isFinite 检查并回落默认值。
   * 每次 load 后无条件执行（docs/04 R4 对策⑤），因此必须是纯函数且幂等。
   */
  function fillDefaults(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const now = new Date();
    const base = defaultSave(now);

    const save = {
      /* version 一律归一到当前代码版本：高版本存档在 migrate 阶段就被拒绝加载了（见 D6），
         这里再兜一层，避免"拒绝加载 → 结构补全 → 又带着高版本号被反复拒绝"的死循环。 */
      version: B.saveVersion,
      createdAt: str(src.createdAt, base.createdAt),
      profile: Object.assign({}, base.profile),
      daily: Object.assign({}, base.daily),
      progress: src.progress && typeof src.progress === 'object' ? src.progress : {},
      rounds: Array.isArray(src.rounds) ? src.rounds : [],
      achievements: src.achievements && typeof src.achievements === 'object' ? src.achievements : {},
      stats: Object.assign({}, base.stats),
      streak: Object.assign({}, base.streak)
    };

    /* profile */
    const p = src.profile && typeof src.profile === 'object' ? src.profile : {};
    save.profile.xp = Math.max(0, num(p.xp, base.profile.xp));
    save.profile.totalXp = Math.max(0, num(p.totalXp, base.profile.totalXp));
    save.profile.level = U.clamp(num(p.level, base.profile.level), 1, B.level.max);
    save.profile.coins = Math.max(0, num(p.coins, base.profile.coins));
    save.profile.hpMax = num(p.hpMax, base.profile.hpMax);
    save.profile.nextRoundHpBonus = Math.max(0, num(p.nextRoundHpBonus, 0));
    save.profile.nickname = str(p.nickname, base.profile.nickname);

    /* v0.2 道具字段：优先 profile 内的新位置，其次兼容旧档写在 save 顶层的值（修 D5） */
    const legacyScout = Math.max(0, num(src.pendingScoutEye, 0));
    const legacyStraw = bool(src.pendingStrawDouble, false);
    save.profile.pendingScoutEye = Math.max(0, num(p.pendingScoutEye, legacyScout));
    save.profile.pendingStrawDouble = bool(p.pendingStrawDouble, legacyStraw);
    save.profile.chestOpenedTotal = Math.max(0, num(p.chestOpenedTotal, 0));

    /* 满级钳制：level > 20 的异常数据把 xp 归入 totalXp（docs/03 §4.5 异常④） */
    if (num(p.level, 1) > B.level.max) {
      save.profile.level = B.level.max;
      save.profile.xp = 0;
      save.profile.totalXp = Math.max(save.profile.totalXp, num(p.totalXp, 0) + num(p.xp, 0));
    }

    /* daily */
    const d = src.daily && typeof src.daily === 'object' ? src.daily : {};
    save.daily.todayDate = str(d.todayDate, base.daily.todayDate);
    save.daily.todayFirstRoundDone = bool(d.todayFirstRoundDone, false);
    save.daily.todayRounds = Math.max(0, num(d.todayRounds, 0));
    save.daily.todayAttempts = Math.max(0, num(d.todayAttempts, 0));
    save.daily.todayCorrect = Math.max(0, num(d.todayCorrect, 0));
    save.daily.todayWrong = Math.max(0, num(d.todayWrong, 0));
    save.daily.todayXp = Math.max(0, num(d.todayXp, 0));
    save.daily.todayCoins = Math.max(0, num(d.todayCoins, 0));
    save.daily.shopDailyCount = d.shopDailyCount && typeof d.shopDailyCount === 'object' ? d.shopDailyCount : {};
    save.daily.shopMonthKey = str(d.shopMonthKey, base.daily.shopMonthKey);

    /* v0.2 每日任务 / 宝箱（逐字段补全并做类型校验；跨天重置由 game/quest.js settle() 负责） */
    const counters = d.counters && typeof d.counters === 'object' ? d.counters : {};
    save.daily.counters = {
      answered: Math.max(0, num(counters.answered, 0)),
      correct: Math.max(0, num(counters.correct, 0)),
      wrong: Math.max(0, num(counters.wrong, 0)),
      combo: Math.max(0, num(counters.combo, 0)),
      streakCorrect: Math.max(0, num(counters.streakCorrect, 0)),
      distinctWords: Math.max(0, num(counters.distinctWords, 0)),
      newWords: Math.max(0, num(counters.newWords, 0))
    };
    save.daily.countersDate = typeof d.countersDate === 'string' ? d.countersDate : null;
    save.daily.rollDate = typeof d.rollDate === 'string' ? d.rollDate : null;
    save.daily.seenToday = d.seenToday && typeof d.seenToday === 'object' ? d.seenToday : {};
    save.daily.questDate = typeof d.questDate === 'string' ? d.questDate : null;
    save.daily.questIds = Array.isArray(d.questIds) ? d.questIds.slice() : [];
    save.daily.questProgress = d.questProgress && typeof d.questProgress === 'object' ? d.questProgress : {};
    save.daily.questDone = d.questDone && typeof d.questDone === 'object' ? d.questDone : {};
    save.daily.questClaimed = d.questClaimed && typeof d.questClaimed === 'object' ? d.questClaimed : {};
    save.daily.questRoundIds = d.questRoundIds && typeof d.questRoundIds === 'object' ? d.questRoundIds : {};
    save.daily.questBonusClaimed = Math.max(0, num(d.questBonusClaimed, 0));
    save.daily.questBonusDate = typeof d.questBonusDate === 'string' ? d.questBonusDate : null;
    save.daily.chestShards = U.clamp(num(d.chestShards, 0), 0, 999);
    save.daily.chestShardsToday = Math.max(0, num(d.chestShardsToday, 0));
    save.daily.chestTodayDate = typeof d.chestTodayDate === 'string' ? d.chestTodayDate : null;
    save.daily.chestSpawns = Math.max(0, num(d.chestSpawns, 0));
    save.daily.chestOpenDate = typeof d.chestOpenDate === 'string' ? d.chestOpenDate : null;
    save.daily.chestHistory = Array.isArray(d.chestHistory) ? d.chestHistory.slice(-30) : [];
    save.daily.reclaimed = Math.max(0, num(d.reclaimed, 0));
    save.daily.perfectToday = Math.max(0, num(d.perfectToday, 0));

    /* streak */
    const s = src.streak && typeof src.streak === 'object' ? src.streak : {};
    save.streak.dailyStreak = Math.max(0, num(s.dailyStreak, 0));
    save.streak.longestStreak = Math.max(0, num(s.longestStreak, 0));
    save.streak.lastStudyDate = typeof s.lastStudyDate === 'string' ? s.lastStudyDate : null;
    save.streak.streakBeforeBreak = Math.max(0, num(s.streakBeforeBreak, 0));
    save.streak.freezeCards = Math.max(0, num(s.freezeCards, B.streak.freezeCardsPerMonth));
    save.streak.freezeUsedThisMonth = Math.max(0, num(s.freezeUsedThisMonth, 0));
    save.streak.repairCards = Math.max(0, num(s.repairCards, 0));
    save.streak.repairUsedThisMonth = Math.max(0, num(s.repairUsedThisMonth, 0));
    save.streak.monthlyProtectedDays = Math.max(0, num(s.monthlyProtectedDays, 0));
    save.streak.monthKey = str(s.monthKey, base.streak.monthKey);
    save.streak.pendingBreak = bool(s.pendingBreak, false);

    /* stats */
    const st = src.stats && typeof src.stats === 'object' ? src.stats : {};
    save.stats = Object.assign({}, base.stats, {
      totalRounds: Math.max(0, num(st.totalRounds, 0)),
      totalQuestions: Math.max(0, num(st.totalQuestions, 0)),
      totalCorrect: Math.max(0, num(st.totalCorrect, 0)),
      totalWrong: Math.max(0, num(st.totalWrong, 0)),
      totalSkipped: Math.max(0, num(st.totalSkipped, 0)),
      bestCombo: Math.max(0, num(st.bestCombo, 0)),
      perfectRounds: Math.max(0, num(st.perfectRounds, 0)),
      totalStudyMs: Math.max(0, num(st.totalStudyMs, 0)),
      coinsEarned: Math.max(0, num(st.coinsEarned, 0)),
      coinsSpent: Math.max(0, num(st.coinsSpent, 0)),
      masteredCount: Math.max(0, num(st.masteredCount, 0)),
      deckSize: num(st.deckSize, base.stats.deckSize) || base.stats.deckSize,
      daily: st.daily && typeof st.daily === 'object' ? st.daily : {},
      byType: Object.assign(defaultByType(), st.byType && typeof st.byType === 'object' ? st.byType : {})
    });
    /* byType 逐项补全 */
    WQ.questionTypeOrder.forEach(function (t) {
      const item = save.stats.byType[t] || {};
      save.stats.byType[t] = {
        questions: Math.max(0, num(item.questions, 0)),
        correct: Math.max(0, num(item.correct, 0)),
        totalMs: Math.max(0, num(item.totalMs, 0))
      };
    });

    /* progress 每条的字段补全 */
    Object.keys(save.progress).forEach(function (id) {
      const w = save.progress[id] || {};
      save.progress[id] = Object.assign(defaultProgress(id), {
        wordId: id,
        seenCount: Math.max(0, num(w.seenCount, 0)),
        correctCount: Math.max(0, num(w.correctCount, 0)),
        wrongCount: Math.max(0, num(w.wrongCount, 0)),
        consecutiveCorrect: Math.max(0, num(w.consecutiveCorrect, 0)),
        lastSeenAt: typeof w.lastSeenAt === 'string' ? w.lastSeenAt : null,
        lastCorrectAt: typeof w.lastCorrectAt === 'string' ? w.lastCorrectAt : null,
        prevCorrectAt: typeof w.prevCorrectAt === 'string' ? w.prevCorrectAt : null,
        lastWrongAt: typeof w.lastWrongAt === 'string' ? w.lastWrongAt : null,
        nextReviewAt: typeof w.nextReviewAt === 'string' ? w.nextReviewAt : null,
        reviewIntervalDays: Math.max(0, num(w.reviewIntervalDays, 0)),
        mastery: ['new', 'learning', 'mastered'].indexOf(w.mastery) >= 0 ? w.mastery : 'new'
      });
    });

    /* achievements 每条补全 */
    Object.keys(save.achievements).forEach(function (id) {
      const a = save.achievements[id] || {};
      save.achievements[id] = {
        unlocked: bool(a.unlocked, false),
        unlockedAt: typeof a.unlockedAt === 'string' ? a.unlockedAt : (a.unlocked ? save.createdAt : null),
        progress: Math.max(0, num(a.progress, 0)),
        bestProgress: Math.max(0, num(a.bestProgress, 0))
      };
    });

    /* 词库规模以运行时词库为准（docs/04 T4.1：deckSize 由 WQ.WORDS.length 写入） */
    if (WQ.WORDS && WQ.WORDS.length) save.stats.deckSize = WQ.WORDS.length;

    return save;
  }

  /**
   * 版本迁移链。当前只有 v1，留空壳：后续版本在此按 v1→v2→v3 顺序补纯函数。
   *
   * v0.2 修验收报告 D6：`rawVersion > saveVersion` 时**拒绝加载**（不加载、不动原数据、交给上层提示），
   * 不再走「结构补全 + 保持高版本号」，避免旧代码把新版本存档白名单重建后回写，造成不可逆降级。
   * @returns {{save: object, migrated: boolean, backedUp: boolean, rejected: boolean, sourceVersion: number}}
   */
  function migrate(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const rawVersion = Number.isFinite(Number(src.version)) ? Number(src.version) : B.saveVersion;

    if (rawVersion > B.saveVersion) {
      return { save: src, migrated: false, backedUp: false, rejected: true, sourceVersion: rawVersion };
    }
    if (rawVersion === B.saveVersion) {
      return { save: src, migrated: false, backedUp: false, rejected: false, sourceVersion: rawVersion };
    }
    /* 版本低于当前：逐级升级（当前无历史版本，直接落到 fillDefaults 兜底） */
    return {
      save: Object.assign({}, src, { version: B.saveVersion }),
      migrated: true,
      backedUp: false,
      rejected: false,
      sourceVersion: rawVersion
    };
  }

  /**
   * v0.2 多标签合并：把「对方的存档」融进「本页的存档」。
   *
   * 场景（验收报告 D3）：B 标签页内存里是旧档，A 标签页打完整一局落了库；
   * 若 B 直接 commit() 就会用旧档覆盖 A 的写入（lost update）。
   * 这里在写盘前先做一次「读盘 + 合并」，保证谁的进度都不会丢。
   *
   * 合并规则（保守优先，宁可多留不可覆盖）：
   *  1. rounds 按 roundId 去重后合并（这是货币的唯一真相来源，先去重以免金币重复入账）；
   *  2. profile / stats / streak / achievements 逐字段取「更靠后的进度」（数值取最大）；
   *  3. progress 按单词取更靠后的 lastSeenAt，冲突时取各项计数的较大值；
   *  4. daily 取 todayDate 较新的那一份。
   * 函数就地修改 `target` 并返回它。
   */
  function mergeSave(target, incoming) {
    if (!target || !incoming || typeof incoming !== 'object') return target;

    const roundKey = function (r) { return r && r.roundId ? String(r.roundId) : null; };
    const byId = Object.create(null);
    const ordered = [];
    function pushRound(r) {
      if (!r || typeof r !== 'object') return;
      const key = roundKey(r);
      if (key && byId[key]) return; // 同一个 roundId 只留一份
      if (key) byId[key] = true;
      ordered.push(r);
    }
    (incoming.rounds || []).forEach(pushRound);
    (target.rounds || []).forEach(pushRound);
    ordered.sort(function (a, b) { return String(a.endedAt || '').localeCompare(String(b.endedAt || '')); });
    target.rounds = ordered.slice(-B.maxRounds);

    /* profile：数值取最大（进度只增不减）；布尔与字符串取「已有值优先」 */
    const tp = target.profile || (target.profile = {});
    const ip = incoming.profile || {};
    ['xp', 'totalXp', 'coins', 'coinsSpent', 'totalCoins'].forEach(function (k) {
      if (Number.isFinite(Number(ip[k]))) tp[k] = Math.max(Number(tp[k]) || 0, Number(ip[k]) || 0);
    });
    ['level', 'totalXp'].forEach(function (k) {
      if (Number.isFinite(Number(ip[k]))) tp[k] = Math.max(Number(tp[k]) || 0, Number(ip[k]) || 0);
    });
    tp.level = U.clamp(Math.max(num(tp.level, 1), num(ip.level, 1)), 1, B.level.max);
    /* 待生效道具：任何一侧有就保留（道具只多不少） */
    tp.nextRoundHpBonus = Math.max(num(tp.nextRoundHpBonus, 0), num(ip.nextRoundHpBonus, 0));
    tp.pendingScoutEye = Math.max(num(tp.pendingScoutEye, 0), num(ip.pendingScoutEye, 0));
    tp.pendingStrawDouble = bool(tp.pendingStrawDouble, false) || bool(ip.pendingStrawDouble, false);
    tp.chestOpenedTotal = Math.max(num(tp.chestOpenedTotal, 0), num(ip.chestOpenedTotal, 0));

    /* stats：累计量取最大，bestCombo 取最大，totalStudyMs 取最大 */
    const ts = target.stats || (target.stats = {});
    const is = incoming.stats || {};
    ['totalRounds', 'totalQuestions', 'totalCorrect', 'totalWrong', 'totalSkipped',
      'bestCombo', 'perfectRounds', 'totalStudyMs', 'coinsEarned', 'coinsSpent',
      'masteredCount', 'deckSize'].forEach(function (k) {
      ts[k] = Math.max(num(ts[k], 0), num(is[k], 0));
    });
    if (is.daily && typeof is.daily === 'object') {
      ts.daily = ts.daily || {};
      Object.keys(is.daily).forEach(function (day) {
        const a = ts.daily[day];
        const b = is.daily[day];
        if (!a) { ts.daily[day] = U.deepClone(b); return; }
        ['questions', 'correct', 'wrong', 'xp', 'coins', 'rounds', 'studyMs'].forEach(function (k) {
          a[k] = Math.max(num(a[k], 0), num(b[k], 0));
        });
      });
    }
    if (is.byType && typeof is.byType === 'object') {
      ts.byType = ts.byType || {};
      Object.keys(is.byType).forEach(function (t) {
        const a = ts.byType[t] || (ts.byType[t] = { questions: 0, correct: 0, totalMs: 0 });
        const b = is.byType[t] || {};
        a.questions = Math.max(num(a.questions, 0), num(b.questions, 0));
        a.correct = Math.max(num(a.correct, 0), num(b.correct, 0));
        a.totalMs = Math.max(num(a.totalMs, 0), num(b.totalMs, 0));
      });
    }

    /* streak：取更靠后的 lastStudyDate，且连击数取最大 */
    const tst = target.streak || (target.streak = {});
    const ist = incoming.streak || {};
    tst.dailyStreak = Math.max(num(tst.dailyStreak, 0), num(ist.dailyStreak, 0));
    tst.longestStreak = Math.max(num(tst.longestStreak, 0), num(ist.longestStreak, 0));
    const lastA = String(tst.lastStudyDate || '');
    const lastB = String(ist.lastStudyDate || '');
    if (lastB > lastA) tst.lastStudyDate = ist.lastStudyDate;
    tst.freezeCards = Math.max(num(tst.freezeCards, 0), num(ist.freezeCards, 0));
    tst.repairCards = Math.max(num(tst.repairCards, 0), num(ist.repairCards, 0));
    if (num(ist.freezeUsedThisMonth, 0) > num(tst.freezeUsedThisMonth, 0)) tst.freezeUsedThisMonth = num(ist.freezeUsedThisMonth, 0);
    if (num(ist.monthlyProtectedDays, 0) > num(tst.monthlyProtectedDays, 0)) tst.monthlyProtectedDays = num(ist.monthlyProtectedDays, 0);
    tst.pendingBreak = bool(tst.pendingBreak, false) || bool(ist.pendingBreak, false);

    /* achievements：解锁不可逆，取并集（解锁时间取较早的那个） */
    const ta = target.achievements || (target.achievements = {});
    const ia = incoming.achievements || {};
    Object.keys(ia).forEach(function (id) {
      const a = ta[id];
      const b = ia[id];
      if (!a || !a.unlocked) {
        if (b && b.unlocked) ta[id] = U.deepClone(b);
        else if (!a) ta[id] = U.deepClone(b);
      }
    });

    /* progress：逐词取更靠后的 lastSeenAt，计数取较大值（掌握度只增不减） */
    const tpr = target.progress || (target.progress = {});
    const ipr = incoming.progress || {};
    Object.keys(ipr).forEach(function (id) {
      const a = tpr[id];
      const b = ipr[id];
      if (!a) { tpr[id] = U.deepClone(b); return; }
      if (!b) return;
      const seenA = String((a && a.lastSeenAt) || '');
      const seenB = String((b && b.lastSeenAt) || '');
      if (seenB > seenA) {
        tpr[id] = Object.assign(U.deepClone(a), U.deepClone(b));
      }
      const merged = tpr[id];
      ['seenCount', 'correctCount', 'wrongCount', 'consecutiveCorrect', 'reviewIntervalDays'].forEach(function (k) {
        merged[k] = Math.max(num(merged[k], 0), num(a[k], 0), num(b[k], 0));
      });
    });

    /* daily：取 todayDate 更新的那一份（跨天结算状态以新日期为准） */
    const td = target.daily;
    const idy = incoming.daily;
    if (idy && typeof idy === 'object') {
      if (!td || String(idy.todayDate || '') > String(td.todayDate || '')) {
        target.daily = U.deepClone(idy);
      } else if (td && idy.shopMonthlyKey !== td.shopMonthKey && String(idy.shopMonthKey || '') > String(td.shopMonthKey || '')) {
        td.shopMonthKey = idy.shopMonthKey;
      }
    }

    return target;
  }

  /** 把 YYYY-MM-DD 的日期键加上 n 天（非法输入返回 null） */
  function shiftKey(key, n) {
    return U.addDays(key, n);
  }

  /** v0.2：错题本重练冷却天数 —— 错得越多越快能重练，封顶 B.reclaim.maxDays */
  function reclaimIntervalDays(wrongCount) {
    const n = Math.max(1, Math.floor(num(wrongCount, 1)));
    return Math.min(B.reclaim.maxDays, Math.max(B.reclaim.baseDays, n));
  }

  /** v0.2：该词当前是否可重练（从未答错过 → 不可重练；已到冷却 → 可重练） */
  function reclaimState(p, now) {
    const nowDate = now instanceof Date ? now : new Date(Number(now) || Date.now());
    const today = U.todayKey(nowDate);
    const wrongCount = Math.max(0, num(p && p.wrongCount, 0));
    if (!wrongCount) return { can: false, days: null, dueAt: null, reason: 'none' };
    const days = reclaimIntervalDays(wrongCount);
    const lastWrongDay = U.dayOf(p && p.lastWrongAt);
    const dueAt = lastWrongDay ? shiftKey(lastWrongDay, days) : today;
    const can = !dueAt || dueAt <= today;
    return { can: can, days: days, dueAt: dueAt, reason: can ? 'ready' : 'cooling' };
  }

  WQ.save = {
    defaultSave: defaultSave,
    defaultSettings: defaultSettings,
    defaultProfile: defaultProfile,
    defaultDaily: defaultDaily,
    defaultCounters: defaultCounters,
    defaultStreak: defaultStreak,
    defaultStats: defaultStats,
    defaultProgress: defaultProgress,
    defaultByType: defaultByType,
    fillDefaults: fillDefaults,
    migrate: migrate,
    mergeSave: mergeSave,
    reclaimIntervalDays: reclaimIntervalDays,
    reclaimState: reclaimState
  };
})(window.WQ = window.WQ || {});
