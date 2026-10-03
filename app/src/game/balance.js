/* src/game/balance.js
 * 唯一职责：局内数值引擎（docs/03 §4.3 六件套 + §4.8 结算落库）。
 * 依赖：WQ.balance、WQ.level、WQ.srs、WQ.qe、WQ.util、WQ.log、WQ.ach、WQ.streak
 * 被依赖：src/ui/pages/battle.js、src/ui/pages/result.js
 * 硬约束：纯函数（入参 → 出新状态片段）；禁止 document / localStorage / Math.random。
 *
 * 单局 XP 上限构造成例（docs/03 §5.1）：
 *   8×15 + 8×5 + 8×5 + 35（连击）+ 20（每日首局）+ 30（完美） = 215
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;
  const U = WQ.util;

  /** 奖励明细行（key 取值照 docs/03 §6.8 的固定枚举） */
  function item(key, label, value, unit) {
    return { key: key, label: label, value: value, unit: unit };
  }

  /** 合并同 key 的明细行（累加数值） */
  function pushItem(list, key, label, value, unit) {
    if (!value) return;
    const found = list.filter(function (x) { return x.key === key; })[0];
    if (found) found.value += value;
    else list.push(item(key, label, value, unit));
  }

  /**
   * 连击档位奖励（档位制，每档每局仅一次，docs/03 §5.4）。
   * @param {object} session 需要 comboTiersHit
   * @param {number} combo 当前连击数
   * @returns {{xp:number, coins:number, tiersHit:number[]}}
   */
  function applyComboTiers(session, combo) {
    const hit = [];
    let xp = 0;
    if (!session) return { xp: 0, coins: 0, tiersHit: hit };
    const tiers = Object.keys(B.xp.combo).map(Number).sort(function (a, b) { return a - b; });
    if (!Array.isArray(session.comboTiersHit)) session.comboTiersHit = [];
    tiers.forEach(function (t) {
      if (combo >= t && session.comboTiersHit.indexOf(t) < 0) {
        session.comboTiersHit.push(t);
        xp += B.xp.combo[t];
        hit.push(t);
      }
    });
    return { xp: xp, coins: 0, tiersHit: hit };
  }

  /** 完美局 XP 加成：全对且题数 ≥ 6（缩减局规则，docs/03 §7.4） */
  function applyPerfectBonus(session) {
    if (!session) return 0;
    const total = Number(session.totalQuestions) || 0;
    const correct = Number(session.correct) || 0;
    const wrong = Number(session.wrong) || 0;
    if (total < B.round.minPerfectQuestions) return 0;
    if (correct !== total || wrong > 0) return 0;
    return B.xp.perfect;
  }

  /** 每日首局奖励（判定用开局时快照的 isFirstRoundToday） */
  function applyDailyFirstBonus(session) {
    if (!session || !session.isFirstRoundToday) return { xp: 0, coins: 0 };
    return { xp: B.xp.dailyFirstXp, coins: B.coins.dailyFirst };
  }

  /**
   * 单题判定（docs/03 §4.3 的 applyAnswer）。
   * 就地更新 session 与 session.progressMap（wordId → WordProgress）。
   * @param {object} input { session, question, answer, save, now, rnd }
   * @returns {object} AnswerResult
   */
  function applyAnswer(input) {
    const o = input || {};
    const session = o.session;
    const q = o.question;
    const save = o.save || (WQ.state && WQ.state.save) || WQ.save.defaultSave();
    const now = o.now instanceof Date ? o.now : new Date(Number(o.now) || Date.now());

    const result = {
      correct: false,
      approximate: false,
      skipped: false,
      xpGained: 0,
      coinsGained: 0,
      hpLeft: session ? session.hpLeft : 0,
      combo: session ? session.combo : 0,
      maxCombo: session ? session.maxCombo : 0,
      comboTiersHit: [],
      wordProgress: null,
      breakdown: [],
      correctAnswer: '',
      correctText: '',
      meaningCn: '',
      isDefeat: false
    };
    if (!session || !q) return result;

    if (!session.progressMap) session.progressMap = Object.create(null);
    const before = session.progressMap[q.wordId]
      ? U.deepClone(session.progressMap[q.wordId])
      : WQ.save.defaultProgress(q.wordId);
    /* 作答前的原始计数（必须先取出：srs.applyCorrect 会就地修改 before） */
    const wasNewWord = (Number(before.seenCount) || 0) === 0;
    const wasUndefeated = (Number(before.correctCount) || 0) === 0;
    session.lastSnapshot = U.deepClone(before);

    /* ---- 跳过：零收益、零扣血、不写任何 wordProgress 字段 ---- */
    if (o.skip) {
      result.skipped = true;
      result.correctAnswer = q.correctAnswer;
      result.meaningCn = q.meaningCn;
      result.hpLeft = session.hpLeft;
      result.combo = 0;
      session.combo = 0;
      session.skipped = (Number(session.skipped) || 0) + 1;
      session.progressMap[q.wordId] = WQ.srs.applySkip(before, q.wordId);
      session.lastSnapshot = null;
      return result;
    }

    const answer = String(o.answer == null ? '' : o.answer);

    /* ---- 判定正确性 ---- */
    let correct = false;
    let approximate = false;
    if (q.type === 'Q1' || q.type === 'Q2' || q.type === 'Q4') {
      /* 选择题：answer 是选项下标（字符串数字）或字母 A–D */
      let idx = -1;
      if (/^\d+$/.test(answer)) idx = Number(answer);
      else if (/^[A-Da-d]$/.test(answer)) idx = 'ABCD'.indexOf(answer.toUpperCase());
      const opt = (q.options || [])[idx];
      correct = !!(opt && opt.correct);
    } else {
      const sp = WQ.qe.checkSpelling(answer, q.word);
      correct = sp.correct;
      approximate = sp.approximate;
    }

    const breakdown = [];
    const wordProgress = correct
      ? WQ.srs.applyCorrect(before, q.wordId, now, approximate)
      : WQ.srs.applyWrong(before, q.wordId, now);

    /* ---- 答对：基础分 + 新词首答 + 击败新词 + 连击档位 + 金币 ---- */
    if (correct) {
      const base = WQ.qe.baseXpFor(q.type);
      let xp = base;
      pushItem(breakdown, 'base', '基础分', base, 'xp');

      if (wasNewWord) {
        xp += B.xp.firstSeenCorrect;
        pushItem(breakdown, 'newWordFirstCorrect', '新词首答', B.xp.firstSeenCorrect, 'xp');
      }
      if (wasUndefeated) {
        xp += B.xp.defeatNewWord;
        pushItem(breakdown, 'newWordDefeated', '击败新词', B.xp.defeatNewWord, 'xp');
      }

      session.combo = (Number(session.combo) || 0) + 1;
      session.maxCombo = Math.max(Number(session.maxCombo) || 0, session.combo);
      session.correct = (Number(session.correct) || 0) + 1;

      const combo = applyComboTiers(session, session.combo);
      if (combo.xp) {
        combo.tiersHit.forEach(function (t) {
          pushItem(breakdown, 'combo' + t, '连击 ' + t + ' 档', B.xp.combo[t], 'xp');
        });
        xp += combo.xp;
      }
      result.comboTiersHit = combo.tiersHit;

      const coins = B.coins.perCorrect;
      result.xpGained = xp;
      result.coinsGained = coins;
      session.xpGained = (Number(session.xpGained) || 0) + xp;
      session.coinsGained = (Number(session.coinsGained) || 0) + coins;
    } else {
      /* ---- 答错：0 XP、0 金币、-1 心、连击清零 ---- */
      session.combo = 0;
      session.wrong = (Number(session.wrong) || 0) + 1;
      session.hpLeft = Math.max(0, (Number(session.hpLeft) || 0) - B.hp.wrongCost);
      result.isDefeat = session.hpLeft <= 0;
    }

    session.progressMap[q.wordId] = wordProgress;
    session.pendingWrongIds = Array.isArray(session.pendingWrongIds) ? session.pendingWrongIds : [];
    if (!correct && session.pendingWrongIds.indexOf(q.wordId) < 0) session.pendingWrongIds.push(q.wordId);
    session.lastSnapshot = null;
    if (correct) session.lastCorrectWordId = q.wordId;

    result.correct = correct;
    result.approximate = approximate;
    result.breakdown = breakdown;
    result.wordProgress = wordProgress;
    result.hpLeft = session.hpLeft;
    result.combo = session.combo;
    result.maxCombo = session.maxCombo;
    result.correctAnswer = q.correctAnswer;
    result.correctText = q.correctText || '';
    result.meaningCn = q.meaningCn;
    return result;
  }

  /**
   * 结算落库（docs/03 §4.8 / §6.8）。
   * 幂等键 roundId：save.rounds 里已有同 roundId 则直接返回，不做任何写入。
   * @param {object} save 存档（就地修改）
   * @param {object} session 对局
   * @param {Date|number} now
   * @returns {{applied:boolean, save:object, roundRecord:object|null, levelUps:Array, unlocked:Array}}
   */
  function applyRoundEnd(save, session, now) {
    const empty = { applied: false, save: save, roundRecord: null, levelUps: [], unlocked: [] };
    if (!save || !session) return empty;
    if (!Array.isArray(save.rounds)) save.rounds = [];

    /* 幂等第一行（docs/04 R4 对策②） */
    const existed = save.rounds.filter(function (r) { return r && r.roundId === session.roundId; })[0];
    if (existed) {
      return { applied: false, save: save, roundRecord: existed, levelUps: [], unlocked: [] };
    }

    const nowDate = now instanceof Date ? now : new Date(Number(now) || Date.now());
    const levelBefore = Number(save.profile.level) || 1;
    const balanceBefore = { level: levelBefore, xp: Number(save.profile.xp) || 0 };

    /* ---- 完美局 / 每日首局（放在 session 上，明细与金币都要用） ---- */
    const perfectXp = applyPerfectBonus(session);
    const daily = applyDailyFirstBonus(session);

    /* ---- 本局"对局本体"收益（不含徽章与升级奖励，口径见 docs/03 §5.1 上限构造） ---- */
    const xpGained = (Number(session.xpGained) || 0) + perfectXp + daily.xp;
    const coinsGained = (Number(session.coinsGained) || 0) + B.coins.roundEnd + daily.coins + (perfectXp ? B.coins.perfect : 0);
    const xpBaseline = Number(save.profile.xp) || 0; // 结算前等级内的 XP（结算页 XP 条起点）

    /* ---- 汇总 breakdown（结算页逐行展示） ---- */
    const breakdown = [];
    const sessionBreakdown = Array.isArray(session.breakdown) ? session.breakdown : [];
    sessionBreakdown.forEach(function (b) {
      pushItem(breakdown, b.key, b.label, b.value, b.unit);
    });
    if (perfectXp) pushItem(breakdown, 'perfect', '完美局', perfectXp, 'xp');
    if (daily.xp) pushItem(breakdown, 'dailyFirst', '每日首局', daily.xp, 'xp');
    /* 结算金币（单独成行，单位 coin） */
    pushItem(breakdown, 'roundEnd', '结算奖励', B.coins.roundEnd, 'coin');
    if (daily.coins) pushItem(breakdown, 'dailyFirstCoin', '每日首局', daily.coins, 'coin');
    if (perfectXp) pushItem(breakdown, 'perfectCoin', '完美局', B.coins.perfect, 'coin');

    /* ---- 写 profile 的 XP 部分 ---- */
    save.profile.xp = (Number(save.profile.xp) || 0) + xpGained;
    save.profile.totalXp = (Number(save.profile.totalXp) || 0) + xpGained;

    /* ---- 词库进度落库 + 掌握度缓存刷新 ---- */
    if (session.progressMap) {
      Object.keys(session.progressMap).forEach(function (id) {
        const p = WQ.srs.refreshMastery(session.progressMap[id]);
        save.progress[id] = p;
      });
    }

    const todayKey = session.startedDate || U.todayKey(nowDate);
    const isWin = (Number(session.hpLeft) || 0) > 0;
    const totalQuestions = Number(session.totalQuestions) || 0;
    const isPerfect = perfectXp > 0;
    const log = Array.isArray(session.log) ? session.log.slice() : [];

    /* ---- stats 累加 ---- */
    const st = save.stats;
    st.totalRounds += 1;
    st.totalQuestions += totalQuestions;
    st.totalCorrect += Number(session.correct) || 0;
    st.totalWrong += Number(session.wrong) || 0;
    st.totalSkipped += Number(session.skipped) || 0;
    st.bestCombo = Math.max(Number(st.bestCombo) || 0, Number(session.maxCombo) || 0);
    if (isPerfect) st.perfectRounds += 1;

    const durationMs = Math.max(0, nowDate.getTime() - (U.parseTime(session.startedAt) ? U.parseTime(session.startedAt).getTime() : nowDate.getTime()));
    st.totalStudyMs += durationMs;

    /* 本局金币总入账（含徽章与升级奖励，两处在下方补算） */
    let coinsEarnedThisRound = coinsGained;
    st.coinsEarned += coinsEarnedThisRound;

    /* 每日聚合（按开局日期计入，docs/03 §7.1） */
    if (!st.daily[todayKey]) {
      st.daily[todayKey] = { questions: 0, correct: 0, wrong: 0, xp: 0, coins: 0, rounds: 0, studyMs: 0 };
    }
    const day = st.daily[todayKey];
    day.questions += totalQuestions;
    day.correct += Number(session.correct) || 0;
    day.wrong += Number(session.wrong) || 0;
    day.xp += xpGained;
    day.coins += coinsEarnedThisRound;
    day.rounds += 1;
    day.studyMs += durationMs;

    /* 题型聚合（每次判定累加，见 recordAnswerAggregates） */
    if (session.byTypeLog) {
      Object.keys(session.byTypeLog).forEach(function (t) {
        const src = session.byTypeLog[t];
        if (!st.byType[t]) st.byType[t] = { questions: 0, correct: 0, totalMs: 0 };
        st.byType[t].questions += src.questions || 0;
        st.byType[t].correct += src.correct || 0;
        st.byType[t].totalMs += src.totalMs || 0;
      });
    }

    /* 已掌握词数缓存（唯一实现走 srs.isMastered） */
    st.masteredCount = Object.keys(save.progress).filter(function (id) {
      return WQ.srs.isMastered(save.progress[id]);
    }).length;

    /* ---- daily 状态 ---- */
    save.daily.todayRounds += 1;
    save.daily.todayCorrect += Number(session.correct) || 0;
    save.daily.todayWrong += Number(session.wrong) || 0;
    save.daily.todayXp += xpGained;
    save.daily.todayCoins += coinsEarnedThisRound;
    if (isWin) save.daily.todayFirstRoundDone = true;

    /* ---- streak（结算分支，docs/03 §4.7） ---- */
    const streakRes = WQ.streak.settleOnRoundEnd(save, nowDate) || {};

    /* ---- 徽章（结算批量判定，B1→B11；可能额外发 XP 与金币） ---- */
    const achRes = WQ.ach.checkAchievements(save, nowDate, {
      maxCombo: session.maxCombo,
      isPerfect: isPerfect,
      masteredCount: st.masteredCount,
      level: save.profile.level
    });
    const badgeCoins = achRes.unlocked.reduce(function (a, b) { return a + (b.coinReward || 0); }, 0);
    const badgeXp = achRes.unlocked.reduce(function (a, b) { return a + (b.xpReward || 0); }, 0);
    if (badgeCoins) pushItem(breakdown, 'badge', '徽章 ×' + achRes.unlocked.length, badgeCoins, 'coin');

    /* ---- 升级结算（放在最后，这样徽章发的 XP 也能参与升级） ---- */
    const lv = WQ.level.applyLevelUps(save.profile);
    if (lv.coinsFromLevels) pushItem(breakdown, 'levelUp', '升级奖励（' + lv.levelUps.length + ' 级）', lv.coinsFromLevels, 'coin');

    /* ---- 徽章 XP 明细行 ---- */
    if (badgeXp) pushItem(breakdown, 'badgeXp', '徽章经验', badgeXp, 'xp');

    /* ---- 金币/XP 最终账目 ----
       定稿：roundRecord.xpGained 严格落在 10–215、coinsGained 落在 0–71（docs/03 §5.1 上限构造口径）。
       徽章奖励与升级奖励单独记在 bonusXp / bonusCoins / levelUpCoins 里，三项之和才是本局总入账。 */
    const bonusCoins = badgeCoins + lv.coinsFromLevels;
    const levelUpCoins = lv.coinsFromLevels;
    const earnedCoins = coinsGained + bonusCoins;
    save.profile.coins = (Number(save.profile.coins) || 0) + earnedCoins;

    /* 把徽章/升级带来的金币同步进"本局入账"与每日聚合（展示与统计要一致） */
    if (bonusCoins) {
      coinsEarnedThisRound += bonusCoins;
      st.coinsEarned += bonusCoins;
      day.coins += bonusCoins;
      save.daily.todayCoins += bonusCoins;
    }

    /* ---- RoundRecord（字段照 docs/03 §6.8） ---- */
    const roundRecord = {
      roundId: session.roundId,
      startedAt: session.startedAt || nowDate.toISOString(),
      endedAt: nowDate.toISOString(),
      durationMs: durationMs,
      isWin: isWin,
      isPerfect: isPerfect,
      isFirstRoundToday: !!session.isFirstRoundToday,
      totalQuestions: totalQuestions,
      correct: Number(session.correct) || 0,
      wrong: Number(session.wrong) || 0,
      skipped: Number(session.skipped) || 0,
      maxCombo: Number(session.maxCombo) || 0,
      xpGained: xpGained,
      coinsGained: coinsGained,
      endedXp: save.profile.xp,
      endedTotalXp: save.profile.totalXp,
      bonusXp: badgeXp,
      bonusCoins: bonusCoins,
      levelUpCoins: levelUpCoins,
      levelBefore: levelBefore,
      levelAfter: Number(save.profile.level) || levelBefore,
      hpMax: Number(session.hpMax) || B.hp.max,
      hpLeft: Number(session.hpLeft) || 0,
      retriesUsed: Number(session.retryUsed ? 1 : 0),
      strawDoubleUsed: !!session.strawDoubleUsed,
      scoutEyeUsed: Number(session.scoutEyeUsed) || 0,
      wordIds: (session.questions || []).map(function (q) { return q.wordId; }),
      breakdown: breakdown,
      log: log,
      unlockedAchievementIds: achRes.unlocked.map(function (b) { return b.id; }),
      source: session.source === 'wrongBook' ? 'wrongBook' : 'normal',
      /* 便于结算页展示的附加字段（不改变上游语义） */
      levelUps: lv.levelUps,
      accuracy: totalQuestions ? (Number(session.correct) || 0) / totalQuestions : 0
    };

    save.rounds.push(roundRecord);
    if (save.rounds.length > B.maxRounds) save.rounds = save.rounds.slice(-B.maxRounds);

    WQ.log.add('roundEnd', {
      roundId: roundRecord.roundId,
      isWin: roundRecord.isWin,
      isPerfect: roundRecord.isPerfect,
      correct: roundRecord.correct,
      wrong: roundRecord.wrong,
      skipped: roundRecord.skipped,
      maxCombo: roundRecord.maxCombo,
      xpGained: roundRecord.xpGained,
      coinsGained: roundRecord.coinsGained,
      durationMs: roundRecord.durationMs,
      levelBefore: roundRecord.levelBefore,
      levelAfter: roundRecord.levelAfter
    });

    return {
      applied: true,
      save: save,
      roundRecord: roundRecord,
      levelUps: lv.levelUps,
      unlocked: achRes.unlocked,
      streak: streakRes,
      /* 结算页 XP 条动画的起点：结算前等级内的 XP */
      baseline: { level: levelBefore, xp: xpBaseline },
      dailyFirstEligible: daily.xp > 0,
      totals: {
        xp: xpGained + badgeXp,
        coins: earnedCoins,
        badgeXp: badgeXp,
        badgeCoins: badgeCoins,
        levelUpCoins: levelUpCoins
      }
    };
  }

  /**
   * 跨天结算（docs/03 §4.3 rolloverDaily）：
   * 重置每日标志与限购、跨月重置月度计数、结清 streak。
   */
  function rolloverDaily(save, now) {
    if (!save) return save;
    const nowDate = now instanceof Date ? now : new Date(Number(now) || Date.now());
    const today = U.todayKey(nowDate);
    const month = U.ymKey(nowDate);

    if (save.daily.todayDate !== today) {
      save.daily.todayDate = today;
      save.daily.todayFirstRoundDone = false;
      save.daily.todayRounds = 0;
      save.daily.todayCorrect = 0;
      save.daily.todayWrong = 0;
      save.daily.todayXp = 0;
      save.daily.todayCoins = 0;
      save.daily.shopDailyCount = {};
    }
    if (save.daily.shopMonthKey !== month) {
      save.daily.shopMonthKey = month;
      save.daily.shopDailyCount = {};
    }
    WQ.streak.rolloverMonth(save, nowDate);
    WQ.streak.rolloverStreak(save, nowDate);
    return save;
  }

  WQ.game = {
    applyAnswer: applyAnswer,
    applyComboTiers: applyComboTiers,
    applyPerfectBonus: applyPerfectBonus,
    applyDailyFirstBonus: applyDailyFirstBonus,
    applyRoundEnd: applyRoundEnd,
    rolloverDaily: rolloverDaily
  };
})(window.WQ = window.WQ || {});
