/* src/ui/selfcheck.js
 * 唯一职责：自检断言集（docs/04 §8.1 的"零依赖替代测试框架"）。
 * 依赖：WQ.balance、WQ.level、WQ.srs、WQ.qe、WQ.questionPool、WQ.game、WQ.ach、WQ.save、WQ.streak、WQ.util
 * 被依赖：src/ui/pages/selfcheck.js
 *
 * 输出结构：{ group, name, expected, actual, pass, note }
 * 注意：这里不写 DOM，因此同一套断言可以在 Node 里跑（dev/selfcheck.mjs）。
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;
  const U = WQ.util;

  /** 造一个可控的假存档 */
  function fakeSave(overrides) {
    const save = WQ.save.defaultSave(new Date(2025, 0, 10, 12, 0, 0));
    save.streak.lastStudyDate = null;
    save.daily.todayDate = '2025-01-10';
    save.daily.shopMonthKey = '2025-01';
    save.streak.monthKey = '2025-01';
    return Object.assign(save, overrides || {});
  }

  /** 造一个 session 骨架（用于 applyAnswer / applyRoundEnd） */
  function makeSession(questions, opts) {
    const o = opts || {};
    return {
      roundId: 'test-round-' + (o.n || 1),
      source: 'normal',
      questions: questions,
      totalQuestions: questions.length,
      index: 0,
      hpMax: B.hp.max,
      hpLeft: B.hp.max,
      combo: 0,
      maxCombo: 0,
      correct: 0,
      wrong: 0,
      skipped: 0,
      xpGained: 0,
      coinsGained: 0,
      comboTiersHit: [],
      retryUsed: false,
      strawDoubleAvailable: false,
      scoutEyeRemaining: 0,
      scoutEyeUsed: 0,
      isFirstRoundToday: o.isFirstRoundToday !== false,
      startedAt: new Date(2025, 0, 10, 12, 0, 0).toISOString(),
      startedDate: '2025-01-10',
      pendingWrongIds: [],
      progressMap: Object.create(null),
      byTypeLog: { Q1: { questions: 0, correct: 0, totalMs: 0 }, Q2: { questions: 0, correct: 0, totalMs: 0 }, Q3: { questions: 0, correct: 0, totalMs: 0 }, Q4: { questions: 0, correct: 0, totalMs: 0 }, Q5: { questions: 0, correct: 0, totalMs: 0 } },
      breakdown: [],
      log: []
    };
  }

  /** 造一道题的答案提交（把 applyAnswer 的结果累加到 session 上） */
  function answerAll(save, session, opts) {
    const o = opts || {};
    const now = o.now || new Date(2025, 0, 10, 12, 0, 0);
    session.questions.forEach(function (q, i) {
      const correct = o.allCorrect !== false;
      let answer = '';
      if (q.type === 'Q1' || q.type === 'Q2' || q.type === 'Q4') {
        const idx = (q.options || []).findIndex(function (x) { return x.correct; });
        answer = String(correct ? idx : (idx + 1) % (q.options || [1]).length);
      } else {
        answer = correct ? q.word : 'zzzzzz';
      }
      const res = WQ.game.applyAnswer({ session: session, question: q, answer: answer, save: save, now: now });
      if (res.breakdown && res.breakdown.length) {
        res.breakdown.forEach(function (b) {
          const found = session.breakdown.filter(function (x) { return x.key === b.key; })[0];
          if (found) found.value += b.value; else session.breakdown.push(Object.assign({}, b));
        });
      }
      session.byTypeLog[q.type].questions += 1;
      if (res.correct) session.byTypeLog[q.type].correct += 1;
      session.log[i] = {
        wordId: q.wordId, type: q.type, correct: !!res.correct, approximate: !!res.approximate,
        skipped: false, retried: false, answer: answer, correctAnswer: q.correctAnswer,
        ms: 1200, xpGained: res.xpGained, hpAfter: session.hpLeft, comboAfter: session.combo
      };
    });
    return session;
  }

  /** 构造一整局 Q3 题（用于 XP 上下限验证） */
  function q3Questions(count, save, startIndex) {
    const words = WQ.WORDS || [];
    const used = [];
    const out = [];
    for (let i = 0; i < count; i++) {
      const entry = WQ.qe.toEntry(words[(startIndex || 0) + i]);
      const q = WQ.qe.buildQuestion(entry, words.map(function (w) { return WQ.qe.toEntry(w); }), 'Q3', used, U.rng(7));
      if (q) { out.push(q); used.push(entry.id); }
    }
    return out;
  }

  const checks = [];

  /** 注册一条断言 */
  function test(group, name, expected, fn) {
    checks.push({ group: group, name: name, expected: expected, fn: fn });
  }

  /* ================= 等级曲线 ================= */
  test('等级曲线', 'needXp(1)', 70, function () { return WQ.level.needXp(1); });
  test('等级曲线', 'needXp(19)', 250, function () { return WQ.level.needXp(19); });
  test('等级曲线', 'cumulativeXpForLevel(5)', 340, function () { return WQ.level.cumulativeXpForLevel(5); });
  test('等级曲线', 'cumulativeXpForLevel(20)', 3040, function () { return WQ.level.cumulativeXpForLevel(20); });
  test('等级曲线', 'cumulativeXpForLevel(n+1)-cumulativeXpForLevel(n) === needXp(n)', true, function () {
    for (let n = 1; n <= 19; n++) {
      if (WQ.level.cumulativeXpForLevel(n + 1) - WQ.level.cumulativeXpForLevel(n) !== WQ.level.needXp(n)) return false;
    }
    return true;
  });
  test('等级曲线', 'titleFor(20)', '单词猎手（满级）', function () { return WQ.level.titleFor(20); });
  test('等级曲线', 'applyLevelUps({level:1,xp:70}).coinsFromLevels', 30, function () {
    const p = { level: 1, xp: 70, coins: 0, totalXp: 70 };
    return WQ.level.applyLevelUps(p).coinsFromLevels;
  });
  test('等级曲线', 'applyLevelUps({level:1,xp:70}) 后 level/xp', '2/0', function () {
    const p = { level: 1, xp: 70, coins: 0, totalXp: 70 };
    WQ.level.applyLevelUps(p);
    return p.level + '/' + p.xp;
  });

  /* ================= 单局 XP / 金币 ================= */
  test('单局 XP', '上限构造 8 题全 Q3 全对全为新词 = 285', 285, function () {
    /* 8×15（基础）+ 8×5（新词首答）+ 8×5（击败新词）+ 35（连击）+ 20（每日首局）+ 30（完美局） */
    const save = fakeSave();
    const qs = q3Questions(8, save, 0);
    const s = makeSession(qs, { n: 101 });
    answerAll(save, s);
    const res = WQ.game.applyRoundEnd(save, s, new Date(2025, 0, 10, 12, 5, 0));
    return res.roundRecord.xpGained;
  });
  test('单局 XP', '下限构造 1 题答对且非新词 = 15（Q3 基础分，无任何 bonus）', 15, function () {
    const save = fakeSave();
    const entry = WQ.qe.toEntry(WQ.WORDS[0]);
    const pool = WQ.WORDS.map(function (w) { return WQ.qe.toEntry(w); });
    const q = WQ.qe.buildQuestion(entry, pool, 'Q3', [], U.rng(3));
    const s = makeSession([q], { n: 102, isFirstRoundToday: false });
    /* 该词已出过题、且以前答对过 → 既不是"新词首答"也不是"击败新词"，无任何 bonus */
    s.progressMap[entry.id] = Object.assign(WQ.save.defaultProgress(entry.id), { seenCount: 3, correctCount: 2 });
    answerAll(save, s);
    const res = WQ.game.applyRoundEnd(save, s, new Date(2025, 0, 10, 12, 5, 0));
    return res.roundRecord.xpGained;
  });
  test('单局 XP', '连击 3/5/8 三档合计 35', 35, function () {
    const s = makeSession([], { n: 103 });
    const r = WQ.game.applyComboTiers(s, 8);
    return r.xp;
  });
  test('单局 XP', '同一档位不重复给奖（连对 3 → 答错 → 再连对 3）', 5, function () {
    const s = makeSession([], { n: 104 });
    const first = WQ.game.applyComboTiers(s, 3).xp;
    s.comboTiersHit = s.comboTiersHit; // 保留
    const second = WQ.game.applyComboTiers(s, 3).xp;
    return first + second;
  });
  test('单局金币', '上限构造 8 题全对 = 61（8×2 + 10 结算 + 20 完美局 + 15 每日首局）', 61, function () {
    const save = fakeSave();
    const qs = q3Questions(8, save, 8);
    const s = makeSession(qs, { n: 105 });
    answerAll(save, s);
    const res = WQ.game.applyRoundEnd(save, s, new Date(2025, 0, 10, 12, 5, 0));
    /* roundRecord.coinsGained 只算对局本体（0–71 口径）；徽章与升级奖励在 bonusCoins 里 */
    return res.roundRecord.coinsGained;
  });

  /* ================= 血量与连击 ================= */
  test('血量与连击', '3 题答错 → hpLeft 归零且已得 XP 不变', true, function () {
    const save = fakeSave();
    const qs = q3Questions(3, save, 16);
    const s = makeSession(qs, { n: 106 });
    answerAll(save, s, { allCorrect: false });
    return s.hpLeft === 0 && s.xpGained === 0;
  });
  test('血量与连击', '答错扣 1 心', B.hp.max - 1, function () {
    const save = fakeSave();
    const qs = q3Questions(1, save, 20);
    const s = makeSession(qs, { n: 107 });
    answerAll(save, s, { allCorrect: false });
    return s.hpLeft;
  });

  /* ================= 幂等与容错 ================= */
  test('幂等', '同一 roundId 结算两次结果深相等（金币不翻倍）', true, function () {
    const save = fakeSave();
    const qs = q3Questions(4, save, 24);
    const s = makeSession(qs, { n: 108 });
    answerAll(save, s);
    const r1 = WQ.game.applyRoundEnd(save, s, new Date(2025, 0, 10, 12, 5, 0));
    const after1 = JSON.stringify(save);
    const r2 = WQ.game.applyRoundEnd(save, s, new Date(2025, 0, 10, 12, 6, 0));
    return after1 === JSON.stringify(save) && r1.applied === true && r2.applied === false;
  });
  test('存档补全', 'fillDefaults({}) 后关键字段齐全且为有限数', true, function () {
    const s = WQ.save.fillDefaults({});
    return !!(s.profile && s.daily && s.progress && s.rounds && s.achievements && s.stats && s.streak)
      && Number.isFinite(s.profile.xp) && Number.isFinite(s.profile.level)
      && s.streak.freezeCards === B.streak.freezeCardsPerMonth
      && s.stats.byType.Q1.questions === 0
      && s.stats.deckSize === (WQ.WORDS || []).length;
  });

  /* ================= 日期边界 / streak ================= */
  test('日期边界', '漏 1 天 → 消耗 1 张冰冻卡且连击不减', '5/1', function () {
    const save = fakeSave();
    save.streak.dailyStreak = 5;
    save.streak.lastStudyDate = '2025-01-10';
    WQ.streak.rolloverStreak(save, new Date(2025, 0, 12, 9, 0, 0));
    return save.streak.dailyStreak + '/' + save.streak.freezeUsedThisMonth;
  });
  test('日期边界', '漏 9 天 → 归零 + pendingBreak', '0/true', function () {
    const save = fakeSave();
    save.streak.dailyStreak = 5;
    save.streak.lastStudyDate = '2025-01-10';
    WQ.streak.rolloverStreak(save, new Date(2025, 0, 20, 9, 0, 0));
    return save.streak.dailyStreak + '/' + save.streak.pendingBreak;
  });
  test('日期边界', 'rolloverStreak 连调 3 次结果一致（幂等）', true, function () {
    const save = fakeSave();
    save.streak.dailyStreak = 5;
    save.streak.lastStudyDate = '2025-01-10';
    const now = new Date(2025, 0, 13, 9, 0, 0);
    const a = WQ.streak.rolloverStreak(save, now);
    const s1 = JSON.stringify(save);
    WQ.streak.rolloverStreak(save, now);
    WQ.streak.rolloverStreak(save, now);
    return s1 === JSON.stringify(save) && a.stage === 'protected';
  });
  test('日期边界', '日期回拨不产生任何变更', true, function () {
    const save = fakeSave();
    save.streak.dailyStreak = 5;
    save.streak.lastStudyDate = '2025-01-10';
    const before = JSON.stringify(save.streak);
    WQ.streak.rolloverStreak(save, new Date(2025, 0, 5, 9, 0, 0));
    return before === JSON.stringify(save.streak);
  });
  test('日期边界', '结算分支：昨天学过 → 连击 +1', 6, function () {
    const save = fakeSave();
    save.streak.dailyStreak = 5;
    save.streak.lastStudyDate = '2025-01-09';
    WQ.streak.settleOnRoundEnd(save, new Date(2025, 0, 10, 9, 0, 0));
    return save.streak.dailyStreak;
  });

  /* ================= 词库 ================= */
  test('词库', 'WQ.WORDS.length', 200, function () { return (WQ.WORDS || []).length; });
  test('词库', '四字段非空率 100%', 1, function () {
    const list = WQ.WORDS || [];
    if (!list.length) return 0;
    const ok = list.filter(function (w) { return w.word && w.phonetic && w.meaning_cn && w.example; }).length;
    return ok / list.length;
  });
  test('词库', '单词唯一', true, function () {
    const list = WQ.WORDS || [];
    return new Set(list.map(function (w) { return w.word; })).size === list.length;
  });
  test('词库', '例句含词且恰好 1 次', 0, function () {
    const bad = (WQ.WORDS || []).filter(function (w) {
      const re = new RegExp('\\b' + w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
      return (w.example.match(re) || []).length !== 1;
    });
    return bad.length;
  });
  test('词库', 'v./n./adj./adv. 各 ≥ 12 词', true, function () {
    const counts = {};
    (WQ.WORDS || []).forEach(function (w) { counts[w.pos] = (counts[w.pos] || 0) + 1; });
    return ['v.', 'n.', 'adj.', 'adv.'].every(function (p) { return (counts[p] || 0) >= 12; });
  });

  /* ================= 出题 ================= */
  test('出题', 'Q1/Q2 干扰项可生成率各 ≥ 95%', true, function () {
    const list = WQ.WORDS || [];
    const canBuild = function (type, w) {
      const key = type === 'Q1'
        ? function (x) { return String(x.meaning_cn).trim()[0]; }
        : function (x) { return String(x.word).trim()[0].toLowerCase(); };
      const samePos = list.filter(function (x) { return x.id !== w.id && x.pos && x.pos === w.pos && key(x) !== key(w); });
      if (samePos.length >= 3) return true;
      return list.filter(function (x) { return x.id !== w.id && key(x) !== key(w); }).length >= 3;
    };
    const q1 = list.filter(function (w) { return canBuild('Q1', w); }).length / list.length;
    const q2 = list.filter(function (w) { return canBuild('Q2', w); }).length / list.length;
    return q1 >= 0.95 && q2 >= 0.95;
  });
  test('出题', '100 局模拟：选项齐全、首字规则零违反、同局不重复', true, function () {
    const save = fakeSave();
    const pool = (WQ.WORDS || []).map(function (w) { return WQ.qe.toEntry(w); });
    for (let i = 1; i <= 100; i++) {
      const rnd = U.rng(i * 977 + 13);
      const round = WQ.questionPool.buildRound({
        save: save, words: WQ.WORDS, source: 'normal',
        now: new Date(2025, 0, 10, 12, 0, 0), rnd: rnd, ttsAvailable: i % 2 === 0
      });
      if (round.questions.length !== 8) return '第 ' + i + ' 局题数 ' + round.questions.length;
      const ids = round.questions.map(function (q) { return q.wordId; });
      if (new Set(ids).size !== ids.length) return '第 ' + i + ' 局出现重复词';
      for (const q of round.questions) {
        if (q.type === 'Q1' || q.type === 'Q2' || q.type === 'Q4') {
          if (!q.options || q.options.length !== 4) return '第 ' + i + ' 局选项数不足（' + q.type + '）';
          if (new Set(q.options.map(function (o) { return o.text; })).size !== 4) return '第 ' + i + ' 局选项文本重复';
          const entry = pool.filter(function (x) { return x.id === q.wordId; })[0];
          const correctKey = WQ.optionKeyOf(q.type, entry);
          const bad = q.options.filter(function (o) {
            if (o.correct) return false;
            const other = pool.filter(function (x) { return x.id === o.wordId; })[0];
            return WQ.optionKeyOf(q.type, other) === correctKey;
          });
          if (bad.length) return '第 ' + i + ' 局违反首字规则（' + q.type + '）';
        }
        if (q.type === 'Q5') {
          const re = new RegExp('\\b' + q.word + '\\b', 'gi');
          if ((q.example.match(re) || []).length !== 1) return '第 ' + i + ' 局 Q5 例句不含词';
        }
      }
    }
    return true;
  });
  test('出题', '题型分布偏差 ≤ ±5 个百分点（Q1 目标 40%）', true, function () {
    const all = [];
    for (let i = 0; i < 100; i++) {
      all.push.apply(all, WQ.qe.pickQuestionTypes(8, { ttsAvailable: false, rnd: U.rng(i + 1) }));
    }
    const dist = WQ.qe.typeDistribution(all);
    /* Q4 不可用时其余 4 种按比例分摊：Q1 = .40/(.40+.25+.20+.05) = .444 */
    return Math.abs(dist.Q1 - 0.444) <= 0.05 && dist.Q4 === 0;
  });
  test('出题', '拼写判定：完全一致 / 编辑距离 1 / 错误', 'a/b/c', function () {
    const a = WQ.qe.checkSpelling('abandon', 'abandon');
    const b = WQ.qe.checkSpelling('abandom', 'abandon');
    const c = WQ.qe.checkSpelling('abandxx', 'abandon');
    return (a.correct && !a.approximate ? 'a' : '?') + '/' +
      (b.correct && b.approximate ? 'b' : '?') + '/' +
      (!c.correct ? 'c' : '?');
  });
  test('出题', '近似正确不推进 SRS（nextReviewAt 不变、连续数清零）', true, function () {
    const p = WQ.save.defaultProgress('w0001');
    p.consecutiveCorrect = 3;
    p.reviewIntervalDays = 7;
    p.nextReviewAt = new Date(2025, 0, 17).toISOString();
    const before = p.nextReviewAt;
    WQ.srs.applyCorrect(p, 'w0001', new Date(2025, 0, 10), true);
    return p.nextReviewAt === before && p.consecutiveCorrect === 0;
  });
  test('出题', 'SRS 间隔表 0→1、3→7、16→35、35→35', '1/7/35/35', function () {
    return WQ.srs.nextInterval(0) + '/' + WQ.srs.nextInterval(3) + '/' + WQ.srs.nextInterval(16) + '/' + WQ.srs.nextInterval(35);
  });

  /* ================= 成就 ================= */
  test('成就', '11 条进度均不返回 NaN', true, function () {
    const save = fakeSave();
    return WQ.achievements.every(function (def) {
      const p = WQ.ach.getAchievementProgress(save, def.id);
      return Number.isFinite(p.progress) && /^\d|^Lv\./.test(p.text);
    });
  });
  test('成就', '首次答对解锁 firstBlood 且只发一次金币', 'true/25/0', function () {
    const save = fakeSave();
    save.stats.totalCorrect = 1;
    const now = new Date(2025, 0, 10, 12, 0, 0);
    const r1 = WQ.ach.checkAchievements(save, now, {});
    const gotFirstBlood = r1.unlocked.some(function (x) { return x.id === 'firstBlood'; });
    /* 只统计 firstBlood 本身：它已解锁后再次检查不应重复发币 */
    const coinsAfterFirst = save.profile.coins;
    const r2 = WQ.ach.checkAchievements(save, now, {});
    const again = r2.unlocked.some(function (x) { return x.id === 'firstBlood'; });
    return (gotFirstBlood ? 'true' : 'false') + '/' + coinsAfterFirst + '/' + (again ? 1 : 0);
  });

  /* ================= 设置 ================= */
  test('设置', 'defaultSettings() 恰好 5 个键', '5', function () {
    const s = WQ.save.defaultSettings();
    return String(Object.keys(s).length);
  });

  /**
   * 运行全部断言。
   * @param {object} opts { onProgress:function(done,total) }
   * @returns {Array} 结果数组
   */
  function run(opts) {
    const o = opts || {};
    const results = [];
    checks.forEach(function (c, i) {
      let actual;
      let pass = false;
      let note = '';
      try {
        actual = c.fn();
        if (typeof c.expected === 'function') pass = !!c.expected(actual);
        else pass = actual === c.expected;
      } catch (e) {
        actual = '异常：' + (e && e.message ? e.message : String(e));
        pass = false;
      }
      results.push({
        group: c.group,
        name: c.name,
        expected: typeof c.expected === 'function' ? '(函数断言)' : String(c.expected),
        actual: typeof actual === 'number' && !Number.isInteger(actual) ? actual.toFixed(4) : String(actual),
        pass: pass,
        note: note
      });
      if (o.onProgress) o.onProgress(i + 1, checks.length);
    });
    return results;
  }

  WQ.selfcheck = { run: run, checks: checks, fakeSave: fakeSave, makeSession: makeSession, answerAll: answerAll };
})(window.WQ = window.WQ || {});
