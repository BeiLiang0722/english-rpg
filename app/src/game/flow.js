/* src/game/flow.js
 * 唯一职责：把"开局 / 逐题判定 / 结算"这套流程串起来（唯一修改 WQ.state.session 的地方）。
 * 依赖：WQ.questionPool、WQ.game、WQ.srs、WQ.log、WQ.util、WQ.persist、WQ.actions
 * 被依赖：src/ui/pages/battle.js、src/ui/pages/home.js、src/ui/pages/result.js
 *
 * 设计说明：session 是内存态（不持久化，docs/03 §6.10）；每次判定后由 commit() 立即落库。
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;
  const U = WQ.util;

  /** 空白的题型聚合表 */
  function emptyByType() {
    const out = {};
    WQ.questionTypeOrder.forEach(function (t) { out[t] = { questions: 0, correct: 0, totalMs: 0 }; });
    return out;
  }

  /**
   * 开一局。
   * @param {object} opts { source:'normal'|'wrongBook', wordIds:Array, reclaimOnly:boolean, now:Date, rnd:function }
   * @returns {object|null} session；词库为空时返回 null
   */
  function createSession(opts) {
    const o = opts || {};
    const state = WQ.state;
    const save = state.save;
    if (!save) return null;

    const words = WQ.WORDS || [];
    if (!words.length) return null;

    const now = o.now instanceof Date ? o.now : new Date();
    const rnd = typeof o.rnd === 'function' ? o.rnd : Math.random;
    const source = o.source === 'wrongBook' ? 'wrongBook' : 'normal';
    const ttsAvailable = WQ.audio ? WQ.audio.ttsAvailable() : false;

    /* v0.2：开局前先做一次跨天结算 + 记「今日登场」，保证每日任务/宝箱/每日首局在任意入口都收敛。
       enterDay 返回的任务奖励必须在这里真正入账（quest.grant 只记账、不写 profile）。 */
    if (WQ.game && WQ.game.rolloverDaily) WQ.game.rolloverDaily(save, now);
    if (WQ.quest) {
      const q = WQ.quest.enterDay(save, now);
      if (q && (q.coinGain || q.xpGain)) {
        if (q.coinGain) {
          save.profile.coins = (Number(save.profile.coins) || 0) + q.coinGain;
          if (save.stats) save.stats.coinsEarned = (Number(save.stats.coinsEarned) || 0) + q.coinGain;
        }
        if (q.xpGain) {
          save.profile.xp = (Number(save.profile.xp) || 0) + q.xpGain;
          save.profile.totalXp = (Number(save.profile.totalXp) || 0) + q.xpGain;
          WQ.level.applyLevelUps(save.profile);
        }
      }
      WQ.quest.resetPending();
    }

    /* v0.2 错题本重练：可以把选词范围收窄到指定词 / 只收窄到「冷却已到」的词 */
    let wordIds = Array.isArray(o.wordIds) ? o.wordIds.slice() : null;
    if (o.reclaimOnly) {
      const ready = Object.keys(save.progress || {}).filter(function (id) {
        const p = save.progress[id];
        return !!p && WQ.save.reclaimState(p, now).can;
      });
      wordIds = wordIds ? wordIds.filter(function (id) { return ready.indexOf(id) >= 0; }) : ready;
    }
    if (wordIds && !wordIds.length) return null;

    const round = WQ.questionPool.buildRound({
      save: save,
      words: words,
      source: source,
      wordIds: wordIds,
      now: now,
      rnd: rnd,
      ttsAvailable: ttsAvailable
    });
    if (!round.questions.length) return null;

    /* 护心符：下一局血量上限 +1，开局消耗并复位 */
    const hpBonus = Math.max(0, Number(save.profile.nextRoundHpBonus) || 0);
    const hpMax = B.hp.max + hpBonus;

    const session = {
      roundId: U.uid(),
      source: source,
      aborted: false,
      /* v0.2：本局是否是错题本重练（用于音效与徽章 B13「重练答对」） */
      reclaim: source === 'wrongBook',
      questions: round.questions,
      totalQuestions: round.totalQuestions,
      index: 0,
      hpMax: hpMax,
      hpLeft: hpMax,
      combo: 0,
      maxCombo: 0,
      correct: 0,
      wrong: 0,
      skipped: 0,
      xpGained: 0,
      coinsGained: 0,
      comboTiersHit: [],
      retryUsed: false,
      strawDoubleAvailable: !!(save.profile.pendingStrawDouble || save.pendingStrawDouble),
      scoutEyeRemaining: Math.max(0, Number(save.profile.pendingScoutEye) || Number(save.pendingScoutEye) || 0),
      scoutEyeUsed: 0,
      isFirstRoundToday: !save.daily.todayFirstRoundDone,
      startedAt: now.toISOString(),
      startedDate: U.todayKey(now),
      pendingWrongIds: [],
      lastSnapshot: null,
      progressMap: Object.create(null),
      byTypeLog: emptyByType(),
      breakdown: [],
      log: [],
      judged: false,
      lastResult: null,
      lastAnswer: null
    };

    /* 购买的道具在开局消耗（nextRoundHpBonus 复位；侦查之眼/稻草人保持"本局有效"） */
    if (hpBonus) save.profile.nextRoundHpBonus = 0;
    if (session.strawDoubleAvailable) save.profile.pendingStrawDouble = false;
    if (session.scoutEyeRemaining) save.profile.pendingScoutEye = 0;

    state.session = session;
    state.ui.exampleOpen = false;
    state.roundBaseline = { level: save.profile.level, xp: save.profile.xp };

    WQ.log.add('roundStart', {
      roundId: session.roundId,
      totalQuestions: session.totalQuestions,
      isFirstRoundToday: session.isFirstRoundToday,
      source: source,
      candidatePoolSize: round.candidatePoolSize
    });
    if (!ttsAvailable) WQ.log.add('ttsUnavailable', { roundId: session.roundId });
    if (round.totalQuestions < B.round.questionCount) {
      state.ui.queuedToast = '本局只有 ' + round.totalQuestions + ' 题';
    }

    WQ.persist.saveSession(session);
    WQ.actions.commit();
    return session;
  }

  /** 当前题目 */
  function currentQuestion() {
    const s = WQ.state.session;
    if (!s) return null;
    return s.questions[s.index] || null;
  }

  /**
   * 判定当前题。
   * @param {object} opts { answer:string, skip:boolean, ms:number, now:Date }
   * @returns {object|null} AnswerResult
   */
  function answerCurrent(opts) {
    const o = opts || {};
    const s = WQ.state.session;
    if (!s) return null;
    const q = currentQuestion();
    if (!q) return null;
    if (s.judged) return s.lastResult; // 防重复判定（双击）

    const now = o.now instanceof Date ? o.now : new Date();

    /* 记住"作答前"的会话级数值，供免费重试回滚（docs/03 §5.6） */
    s.snapshot = {
      index: s.index,
      combo: s.combo,
      maxCombo: s.maxCombo,
      correct: s.correct,
      wrong: s.wrong,
      skipped: s.skipped,
      xpGained: s.xpGained,
      coinsGained: s.coinsGained,
      comboTiersHit: s.comboTiersHit.slice(),
      breakdown: U.deepClone(s.breakdown),
      hpLeft: s.hpLeft,
      byTypeLog: U.deepClone(s.byTypeLog),
      progress: U.deepClone(s.progressMap[q.wordId] || null),
      pendingWrongIds: s.pendingWrongIds.slice()
    };

    const res = WQ.game.applyAnswer({
      session: s,
      question: q,
      answer: o.answer,
      skip: !!o.skip,
      save: WQ.state.save,
      now: now
    });

    /* 侦查之眼：答完即消耗一次排除额度（每题生效 1 次） */
    if (!o.skip && s.scoutEyeRemaining > 0 && (q.type === 'Q1' || q.type === 'Q2' || q.type === 'Q4')) {
      s.scoutEyeRemaining -= 1;
      s.scoutEyeUsed += 1;
    }

    /* 明细累加 */
    if (res.breakdown && res.breakdown.length) {
      res.breakdown.forEach(function (b) {
        const found = s.breakdown.filter(function (x) { return x.key === b.key; })[0];
        if (found) found.value += b.value;
        else s.breakdown.push({ key: b.key, label: b.label, value: b.value, unit: b.unit });
      });
    }

    /* 题型聚合 */
    const bucket = s.byTypeLog[q.type] || (s.byTypeLog[q.type] = { questions: 0, correct: 0, totalMs: 0 });
    if (!o.skip) {
      bucket.questions += 1;
      if (res.correct) bucket.correct += 1;
      bucket.totalMs += Math.max(0, Number(o.ms) || 0);
    }

    /* 逐题日志（log.length 必须 === totalQuestions，重试时覆盖原记录） */
    const entry = {
      wordId: q.wordId,
      type: q.type,
      correct: !!res.correct,
      approximate: !!res.approximate,
      skipped: !!res.skipped,
      retried: !!o.retry,
      answer: String(o.answer == null ? '' : o.answer),
      correctAnswer: q.correctAnswer,
      ms: Math.max(0, Number(o.ms) || 0),
      xpGained: res.xpGained,
      hpAfter: s.hpLeft,
      comboAfter: s.combo
    };
    if (o.retry && s.log[s.index]) s.log[s.index] = entry;
    else s.log[s.index] = entry;

    s.judged = true;
    s.lastResult = res;
    s.lastAnswer = entry.answer;

    /* ---- 替身稻草人：本局首次血量归零时以 1 心复活（只触发 1 次） ---- */
    if (s.hpLeft <= 0 && s.strawDoubleAvailable) {
      s.strawDoubleAvailable = false;
      s.strawDoubleUsed = true;
      s.hpLeft = 1;
      res.revived = true;
      WQ.state.ui.queuedToast = '替身稻草人替你挡了一下，剩 1 颗心';
    }

    WQ.log.add('answer', {
      roundId: s.roundId,
      wordId: q.wordId,
      type: q.type,
      correct: !!res.correct,
      approximate: !!res.approximate,
      skipped: !!res.skipped,
      ms: entry.ms,
      comboAfter: s.combo,
      hpAfter: s.hpLeft
    });

    /* 判定后立即落库：存档 + 完整会话快照（刷新/崩溃后可补结算，修 D1）。
       注意：每日任务的进度不在这里逐题推进 —— 它在结算时从 stats.daily 统一重建（见 game/quest.js），
       这样"逐题加一次 + 结算再加一次"的双重记账在结构上就不可能发生。 */
    WQ.actions.commit();
    persistSession(s);
    return res;
  }

  /**
   * 免费重试：把上一题（或当前题）的会话数值回滚到作答前，重新作答。
   * 不扣心、不增加题数；log 覆盖原记录并置 retried=true（docs/03 §5.6 / §6.8）。
   * @returns {boolean} 是否成功进入重试
   */
  function retryCurrent() {
    const s = WQ.state.session;
    if (!s || s.retryUsed || !s.snapshot) return false;
    const snap = s.snapshot;

    /* 回滚会话数值（血量不恢复：重试本身不扣心，但也不退还之前答错已经掉的心） */
    s.index = snap.index;
    s.combo = snap.combo;
    s.maxCombo = snap.maxCombo;
    s.correct = snap.correct;
    s.wrong = snap.wrong;
    s.skipped = snap.skipped;
    s.xpGained = snap.xpGained;
    s.coinsGained = snap.coinsGained;
    s.comboTiersHit = snap.comboTiersHit.slice();
    s.breakdown = U.deepClone(snap.breakdown);
    s.byTypeLog = U.deepClone(snap.byTypeLog);
    s.pendingWrongIds = snap.pendingWrongIds.slice();
    /* hpLeft 保持当前值（不清零、不回满）：血量归零时由替身稻草人机制处理 */

    /* 回滚词进度：恢复作答前快照，没有快照则删除本局新增的进度 */
    const retryQ = s.questions[s.index] || null;
    if (retryQ) {
      if (snap.progress) s.progressMap[retryQ.wordId] = U.deepClone(snap.progress);
      else delete s.progressMap[retryQ.wordId];
      /* 重试后这次作答要重新以**本局快照**为基准累加，而不是再读一遍存档（否则会重复计一次） */
      if (s.progressAnswered) delete s.progressAnswered[retryQ.wordId];
    }
    if (s.log[s.index]) s.log[s.index] = null;

    s.retryUsed = true;
    s.judged = false;
    s.lastResult = null;
    s.lastAnswer = null;
    s.snapshot = null;
    WQ.state.ui.exampleOpen = false;
    WQ.actions.touch();
    return true;
  }

  /** 是否有下一题 */
  function hasNext() {
    const s = WQ.state.session;
    if (!s) return false;
    return s.index < s.totalQuestions - 1;
  }

  /** 前进到下一题 */
  function nextQuestion() {
    const s = WQ.state.session;
    if (!s) return false;
    s.judged = false;
    s.lastResult = null;
    WQ.state.ui.exampleOpen = false;
    if (s.index < s.totalQuestions - 1) {
      s.index += 1;
      WQ.actions.touch();
      return true;
    }
    return false;
  }

  /** 是否本局已经结束（血量归零，或最后一题已判定） */
  function isRoundOver() {
    const s = WQ.state.session;
    if (!s) return true;
    if (s.hpLeft <= 0) return true;
    const answered = s.correct + s.wrong + s.skipped;
    return answered >= s.totalQuestions;
  }

  /**
   * 把当前会话完整落盘（D1）。
   * 只去掉纯 UI 临时字段；题目与进度都要保留，刷新后才能真正补结算。
   * 写入失败只影响"崩溃恢复"这一项，绝不影响正常流程（persist.saveSession 内部已 try/catch）。
   */
  function persistSession(session) {
    const s = session || WQ.state.session;
    if (!s) return false;
    try {
      return WQ.persist.saveSession({
        roundId: s.roundId,
        source: s.source,
        aborted: false,
        questions: s.questions,
        totalQuestions: s.totalQuestions,
        index: s.index,
        hpMax: s.hpMax,
        hpLeft: s.hpLeft,
        combo: s.combo,
        maxCombo: s.maxCombo,
        correct: s.correct,
        wrong: s.wrong,
        skipped: s.skipped,
        xpGained: s.xpGained,
        coinsGained: s.coinsGained,
        comboTiersHit: s.comboTiersHit,
        retryUsed: s.retryUsed,
        strawDoubleAvailable: s.strawDoubleAvailable,
        strawDoubleUsed: s.strawDoubleUsed,
        scoutEyeRemaining: s.scoutEyeRemaining,
        scoutEyeUsed: s.scoutEyeUsed,
        isFirstRoundToday: s.isFirstRoundToday,
        startedAt: s.startedAt,
        startedDate: s.startedDate,
        pendingWrongIds: s.pendingWrongIds,
        progressMap: s.progressMap,
        byTypeLog: s.byTypeLog,
        breakdown: s.breakdown,
        log: s.log
      });
    } catch (e) { return false; }
  }

  /**
   * 结算落库（幂等）。可重复调用，第二次不会重复发奖。
   * @returns {object|null} 结算结果
   */
  function finishSession(now) {
    const s = WQ.state.session;
    if (!s) return WQ.state.lastResult;
    const nowDate = now instanceof Date ? now : new Date();
    const res = WQ.game.applyRoundEnd(WQ.state.save, s, nowDate);
    WQ.persist.clearSession();
    WQ.state.lastResult = res;
    WQ.state.session = null;
    WQ.state.boot.levelUps = (res && res.levelUps) || [];
    WQ.state.boot.unlockedBadges = (res && res.unlocked) || [];
    WQ.actions.commit();
    return res;
  }

  /**
   * 本局中断（刷新 / 点「✕ 退出」）：保留已得 XP / 金币 / 词进度，清掉会话。
   *
   * v0.2（修 D2）：中断局一定带 aborted 标记 —— 保留收益，但不算完成局、
   * 不写 daily.todayFirstRoundDone、不进 stats.totalRounds、不解锁"完成类"徽章。
   */
  function abortSession(keepNotice) {
    const s = WQ.state.session;
    if (s) {
      s.aborted = true;
      WQ.game.applyRoundEnd(WQ.state.save, s, new Date());
      WQ.log.add('roundAbort', {
        roundId: s.roundId,
        answered: (Number(s.correct) || 0) + (Number(s.wrong) || 0) + (Number(s.skipped) || 0),
        total: s.totalQuestions,
        xpGained: Number(s.xpGained) || 0
      });
    }
    WQ.state.session = null;
    WQ.persist.clearSession();
    if (keepNotice) WQ.state.ui.interruptNotice = true;
    WQ.actions.commit();
  }

  /**
   * 启动时恢复上一次中断的对局（D1 的核心修复）。
   *
   * 刷新 / 崩溃 / 关标签页后，localStorage 里留着完整会话快照；
   * 这里把它读回来补一次 applyRoundEnd：本局已得的 XP、金币、词级进度、stats 聚合、
   * daily 聚合、任务进度与宝箱碎片全部进账，然后清掉会话键。
   *
   * 幂等性：applyRoundEnd 以 roundId 为幂等键，因此即使上一次其实已经结算成功
   * （例如在结算与 clearSession 之间崩溃），这里也只会返回 applied:false，不会重复发奖。
   *
   * @returns {{recovered:boolean, xp:number, coins:number, roundId?:string, reason?:string}}
   */
  function recoverSession(now) {
    const out = { recovered: false, xp: 0, coins: 0 };
    if (!WQ.persist || !WQ.persist.loadSession) return out;
    let snap = null;
    try { snap = WQ.persist.loadSession(); } catch (e) { snap = null; }
    if (!snap) return out;

    const nowDate = now instanceof Date ? now : new Date();
    const save = WQ.state.save;
    /* 已存在同 roundId 的结算记录 → 上次其实结算成功，只清会话键 */
    const existed = (save.rounds || []).some(function (r) { return r && r.roundId === snap.roundId; });
    if (existed) {
      WQ.persist.clearSession();
      out.reason = 'alreadySettled';
      return out;
    }

    snap.aborted = true;    // 未打完的局：保留收益但不计完成局（D2 口径）
    snap.log = Array.isArray(snap.log) ? snap.log.filter(Boolean) : [];
    snap.progressMap = snap.progressMap || Object.create(null);
    snap.byTypeLog = snap.byTypeLog || emptyByType();
    snap.breakdown = Array.isArray(snap.breakdown) ? snap.breakdown : [];

    const beforeCoins = Number(save.profile.coins) || 0;
    const res = WQ.game.applyRoundEnd(save, snap, nowDate);
    WQ.persist.clearSession();
    WQ.actions.commit();

    out.recovered = true;
    out.roundId = snap.roundId;
    out.xp = (res && res.roundRecord && Number(res.roundRecord.xpGained)) || 0;
    out.coins = (Number(save.profile.coins) || 0) - beforeCoins;
    out.applied = !!(res && res.applied);
    WQ.log.add('sessionRecovered', {
      roundId: snap.roundId,
      xp: out.xp,
      coins: out.coins,
      answered: (Number(snap.correct) || 0) + (Number(snap.wrong) || 0) + (Number(snap.skipped) || 0),
      total: Number(snap.totalQuestions) || 0,
      applied: out.applied
    });
    return out;
  }

  WQ.flow = {
    createSession: createSession,
    currentQuestion: currentQuestion,
    answerCurrent: answerCurrent,
    retryCurrent: retryCurrent,
    hasNext: hasNext,
    nextQuestion: nextQuestion,
    isRoundOver: isRoundOver,
    finishSession: finishSession,
    abortSession: abortSession,
    persistSession: persistSession,
    recoverSession: recoverSession,
    emptyByType: emptyByType
  };
})(window.WQ = window.WQ || {});
