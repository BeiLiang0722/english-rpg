/* src/store/save.js
 * 唯一职责：存档默认值工厂、设置默认值、版本迁移、结构补全。
 * 依赖：WQ.balance（版本号与常量）、WQ.util（本地日期）
 * 被依赖：src/store/persist.js、src/store/state.js、src/game/balance.js
 * 字段口径：docs/03-PRD §6.2 – §6.11（逐字段照抄，不新增语义）
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
      nickname: '猎人'
    };
  }

  function defaultDaily(now) {
    const t = now instanceof Date ? now : new Date();
    return {
      todayDate: U.todayKey(t),
      todayFirstRoundDone: false,
      todayRounds: 0,
      todayCorrect: 0,
      todayWrong: 0,
      todayXp: 0,
      todayCoins: 0,
      shopDailyCount: {},
      shopMonthKey: U.ymKey(t)
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
      version: num(src.version, base.version),
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
    save.daily.todayCorrect = Math.max(0, num(d.todayCorrect, 0));
    save.daily.todayWrong = Math.max(0, num(d.todayWrong, 0));
    save.daily.todayXp = Math.max(0, num(d.todayXp, 0));
    save.daily.todayCoins = Math.max(0, num(d.todayCoins, 0));
    save.daily.shopDailyCount = d.shopDailyCount && typeof d.shopDailyCount === 'object' ? d.shopDailyCount : {};
    save.daily.shopMonthKey = str(d.shopMonthKey, base.daily.shopMonthKey);

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
   * @returns {{save: object, migrated: boolean, backedUp: boolean}}
   */
  function migrate(raw) {
    const rawVersion = (raw && typeof raw === 'object' && Number.isFinite(Number(raw.version)))
      ? Number(raw.version)
      : B.saveVersion;
    if (rawVersion === B.saveVersion) return { save: raw, migrated: false, backedUp: false };

    let data = raw;
    let migrated = false;
    /* 版本低于当前：逐级升级（当前无历史版本，直接落到 fillDefaults 兜底） */
    if (rawVersion < B.saveVersion) {
      data = Object.assign({}, data, { version: B.saveVersion });
      migrated = true;
    }
    /* 版本高于当前：不认识的存档按"结构补全 + 保持高版本号"处理，不删用户数据 */
    return { save: data, migrated: migrated, backedUp: false };
  }

  WQ.save = {
    defaultSave: defaultSave,
    defaultSettings: defaultSettings,
    defaultProfile: defaultProfile,
    defaultDaily: defaultDaily,
    defaultStreak: defaultStreak,
    defaultStats: defaultStats,
    defaultProgress: defaultProgress,
    defaultByType: defaultByType,
    fillDefaults: fillDefaults,
    migrate: migrate
  };
})(window.WQ = window.WQ || {});
