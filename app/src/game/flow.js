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
   * @param {object} opts { source:'normal'|'wrongBook', now:Date, rnd:function }
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

    const round = WQ.questionPool.buildRound({
      save: save,
      words: words,
      source: source,
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
      strawDoubleAvailable: !!(save.strawDoubleArmed || save.pendingStrawDouble),
      scoutEyeRemaining: Math.max(0, Number(save.pendingScoutEye) || 0),
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
    if (session.strawDoubleAvailable) save.pendingStrawDouble = false;
    if (session.scoutEyeRemaining) save.pendingScoutEye = 0;

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

    WQ.actions.commit(); // 判定后立即落库（docs/04 R4 对策①）
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

    const q = s.questions[s.index];
    if (q) {
      /* 回滚词进度：恢复作答前快照，没有快照则删除本局新增的进度 */
      if (snap.progress) s.progressMap[q.wordId] = U.deepClone(snap.progress);
      else delete s.progressMap[q.wordId];
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

  /** 本局中断（刷新/退出）：保留已得 XP 与金币，清掉会话 */
  function abortSession(keepNotice) {
    const s = WQ.state.session;
    if (s) {
      /* 中断的中途局也要把已经判定的题落库（"已获得 XP 与金币已保留"） */
      WQ.game.applyRoundEnd(WQ.state.save, s, new Date());
    }
    WQ.state.session = null;
    WQ.persist.clearSession();
    if (keepNotice) WQ.state.ui.interruptNotice = true;
    WQ.actions.commit();
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
    emptyByType: emptyByType
  };
})(window.WQ = window.WQ || {});
