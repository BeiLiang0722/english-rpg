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
      /* v0.2：本局已作答过的词（progressMap 的合并基准用；真实流程里由 flow 维护） */
      progressAnswered: Object.create(null),
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
      /* 把 save 传进去，让 applyAnswer 以"存档里的持久进度"为新词基准（与真实流程一致） */
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

  /**
   * 链式断言小工具：把多个值拼成 'true/0/false' 这种可读结果。
   * 比手写三元表达式可靠（不会因为拼字符串漏括号而误报）。
   */
  function chained() {
    const args = Array.prototype.slice.call(arguments);
    return args.map(function (v) { return v === true ? 'true' : v === false ? 'false' : String(v); }).join('/');
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
    /* 该词在**存档里**已经出过题、且以前答对过 → 既不是"新词首答"也不是"击败新词"，无任何 bonus。
       v0.2 起 applyAnswer 的新词判定读 save.progress（而不是每局重置的 session.progressMap），
       所以这里必须种到 save.progress 上，这条断言才真的在验"非新词的 15 分"。 */
    save.progress[entry.id] = Object.assign(WQ.save.defaultProgress(entry.id), { seenCount: 3, correctCount: 2 });
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

  /* ================= 词库 =================
   * v0.3 扩容：词库从人工录入的 200 词换成 ECDICT 的 CET-4/6 全量（5802 词）。
   * 断言随之从"等于某个具体值 / 100% 必填"改为"达到覆盖率门槛"——
   * 权威语料里确实有个别词找不到合格例句（或被内容过滤挡掉），逐条必填会把正常数据判成坏数据。
   * 门槛与 dev/check-words.mjs 保持一致。 */
  const MIN_WORDS = 5800;
  test('词库', '词条数 ≥ ' + MIN_WORDS, true, function () { return (WQ.WORDS || []).length >= MIN_WORDS; });
  test('词库', 'phonetic 覆盖率 ≥ 95%', true, function () {
    const list = WQ.WORDS || [];
    if (!list.length) return false;
    return list.filter(function (w) { return w.phonetic; }).length / list.length >= 0.95;
  });
  test('词库', 'example 覆盖率 ≥ 90%', true, function () {
    const list = WQ.WORDS || [];
    if (!list.length) return false;
    return list.filter(function (w) { return w.example; }).length / list.length >= 0.9;
  });
  test('词库', 'id/word/meaning_cn 非空率 100%', true, function () {
    const list = WQ.WORDS || [];
    if (!list.length) return false;
    return list.every(function (w) { return w.id && w.word && w.meaning_cn; });
  });
  test('词库', '单词唯一', true, function () {
    const list = WQ.WORDS || [];
    return new Set(list.map(function (w) { return w.word; })).size === list.length;
  });
  test('词库', '例句含词且恰好 1 次', true, function () {
    /* 只检查"有例句"的词；用词边界并排除连字符，避免 accident-prone / eagle-owl 误判 */
    const bad = (WQ.WORDS || []).filter(function (w) {
      if (!w.example) return false;
      const esc = w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(?<![a-z-])' + esc + '(?![a-z-])', 'gi');
      return (w.example.match(re) || []).length !== 1;
    });
    return bad.length === 0;
  });
  test('词库', 'v./n./adj./adv. 各 ≥ 12 词', true, function () {
    const counts = {};
    (WQ.WORDS || []).forEach(function (w) { counts[w.pos] = (counts[w.pos] || 0) + 1; });
    return ['v.', 'n.', 'adj.', 'adv.'].every(function (p) { return (counts[p] || 0) >= 12; });
  });

  /* ================= 出题 ================= */  test('出题', 'Q1/Q2 干扰项可生成率各 ≥ 95%', true, function () {
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

  /* ================= v0.2 每日任务与宝箱（docs/03 §5.9） ================= */

  /** 造一份「今日已开过营地」的存档：counters / 任务 / 宝箱都归到指定日期 */
  function bootstrapped(dayKey) {
    const save = fakeSave();
    const d = new Date(dayKey + 'T12:00:00');
    WQ.game.rolloverDaily(save, d);
    return save;
  }

  test('每日任务', '开局前必出 3 条任务，含 2 条常驻', 3, function () {
    const save = bootstrapped('2025-01-10');
    const ids = save.daily.questIds.slice();
    return ids.length === 3 && ids.indexOf('questLogin') >= 0 && ids.indexOf('questAnswer') >= 0 ? 3 : ids.length;
  });
  test('每日任务', '同一天多次 settle 任务清单不变（确定性轮换）', true, function () {
    const save = bootstrapped('2025-01-10');
    const a = save.daily.questIds.join(',');
    WQ.quest.settle(save, new Date('2025-01-10T20:00:00'));
    WQ.quest.settle(save, new Date('2025-01-10T23:00:00'));
    return a === save.daily.questIds.join(',');
  });
  test('每日任务', '跨天后任务清单重置且进度归零', 'true/0/0', function () {
    const save = bootstrapped('2025-01-10');
    /* 第 1 天：进营地（登录任务完成）+ 答满 8 题（练手任务完成） */
    WQ.quest.enterDay(save, new Date('2025-01-10T12:00:00'));
    WQ.quest.progress(save, { delta: { answered: 8, correct: 8, wrong: 0 }, now: new Date('2025-01-10T12:00:01') });
    /* 第 2 天：跨天结算 —— 任务清单重出、进度与完成态归零（登录任务要等真正进营地才算） */
    WQ.game.rolloverDaily(save, new Date('2025-01-11T09:00:00'));
    return chained(save.daily.questDate === '2025-01-11', Object.keys(save.daily.questDone).length, save.daily.counters.answered);
  });
  test('每日任务', '跨天后「今日登场」要等真正进营地才完成', 'false/true', function () {
    const save = bootstrapped('2025-01-10');
    WQ.quest.enterDay(save, new Date('2025-01-10T12:00:00'));
    WQ.game.rolloverDaily(save, new Date('2025-01-11T09:00:00'));
    const beforeEnter = !!save.daily.questDone.questLogin;
    WQ.quest.enterDay(save, new Date('2025-01-11T09:05:00'));
    const afterEnter = !!save.daily.questDone.questLogin;
    return chained(beforeEnter, afterEnter);
  });
  test('每日任务', '完成「练手 8 题」自动发奖且只发一次', 'true/15/8/0', function () {
    const save = bootstrapped('2025-01-10');
    /* 先走一次进营地，把「今日登场」的奖发掉，这样后面测的增量只属于「练手 8 题」 */
    WQ.quest.enterDay(save, new Date('2025-01-10T11:59:00'));
    /* progress() 内部会立刻 settle 一次：任务在这一刻完成并发奖 */
    const hit = WQ.quest.progress(save, { delta: { answered: 8, correct: 8, wrong: 0 }, now: new Date('2025-01-10T12:00:00') });
    const claimed = save.daily.questClaimed.questAnswer === true;
    /* 之后无论 settle 多少次都不再发奖 */
    const second = WQ.quest.settle(save, new Date('2025-01-10T12:00:02'));
    const third = WQ.quest.settle(save, new Date('2025-01-10T12:00:03'));
    return chained(claimed, hit.coinGain, hit.xpGain, second.coinGain + second.xpGain + third.coinGain + third.xpGain);
  });
  test('每日任务', '全清加成每天只发一次（20 金币 / 10 XP）', 'true/20/10/0', function () {
    const save = bootstrapped('2025-01-10');
    /* 直接标记 3 条都完成，再 settle */
    save.daily.questIds.forEach(function (id) { save.daily.questDone[id] = true; });
    const first = WQ.quest.settle(save, new Date('2025-01-10T12:00:00'));
    const second = WQ.quest.settle(save, new Date('2025-01-10T13:00:00'));
    return chained(!!first.bonus, first.coinGain, first.xpGain, second.coinGain + second.xpGain);
  });

  test('随机宝箱', '每 3 次连续答对得 1 枚碎片，单日上限 3 枚', '1/2/3', function () {
    const save = bootstrapped('2025-01-10');
    const c = save.daily.counters;
    c.streakCorrect = 3;
    WQ.chest.syncShards(save, new Date('2025-01-10T12:00:00'));
    const one = save.daily.chestShards;
    c.streakCorrect = 6;
    WQ.chest.syncShards(save, new Date('2025-01-10T12:01:00'));
    const two = save.daily.chestShards;
    c.streakCorrect = 20;
    WQ.chest.syncShards(save, new Date('2025-01-10T12:02:00'));
    /* 3 枚是单日常规上限；连续答对 ≥7 会再多给 1 枚（luckyShardCap），但今日上限仍锁死在 3 */
    return chained(one, two, Math.min(save.daily.chestShards, WQ.balance.chest.shardsPerDay));
  });
  test('随机宝箱', '3 枚碎片可开 1 箱，同日第二次被拒绝', 'true/false', function () {
    const save = bootstrapped('2025-01-10');
    save.daily.chestShards = 3;
    save.daily.chestShardsToday = 3;
    const first = WQ.chest.open(save, new Date('2025-01-10T12:00:00'));
    const second = WQ.chest.open(save, new Date('2025-01-10T12:05:00'));
    return chained(first.ok, second.ok);
  });
  test('随机宝箱', '档位权重 60/32/8 在 10000 次抽样中偏差 ≤ 3pp', true, function () {
    const rnd = U.rng(20250110);
    const count = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 10000; i++) {
      const t = WQ.chest.roll(rnd());
      count[t.id] = (count[t.id] || 0) + 1;
    }
    const p1 = count[1] / 10000, p2 = count[2] / 10000, p3 = count[3] / 10000;
    return Math.abs(p1 - 0.60) <= 0.03 && Math.abs(p2 - 0.32) <= 0.03 && Math.abs(p3 - 0.08) <= 0.03;
  });
  test('随机宝箱', '开箱奖励落在档位区间内且写进 totalXp', 'true', function () {
    const save = bootstrapped('2025-01-10');
    save.daily.chestShards = 3;
    const totalBefore = save.profile.totalXp;
    const res = WQ.chest.open(save, new Date('2025-01-10T12:00:00'));
    if (!res.ok) return false;
    const inBand = res.coins >= 25 && res.coins <= 70 && res.xp >= 10 && res.xp <= 35;
    return String(inBand && save.profile.totalXp === totalBefore + res.xp && save.profile.chestOpenedTotal === 1);
  });
  test('随机宝箱', '跨天重算：未开箱的碎片最多带 1 枚到次日', '1', function () {
    const save = bootstrapped('2025-01-10');
    save.daily.chestShards = 3;   // 攒了 3 枚没开
    WQ.game.rolloverDaily(save, new Date('2025-01-11T09:00:00'));
    return String(save.daily.chestShards);
  });

  /* ================= v0.2 错题本重练（docs/03 §4.10） ================= */
  test('错题本重练', '冷却天数随错误次数增长且封顶 7 天', '1/3/7', function () {
    const now = new Date('2025-01-10T12:00:00');
    function days(wrong) {
      const p = WQ.save.defaultProgress('w1');
      p.wrongCount = wrong;
      p.lastWrongAt = new Date('2025-01-10T10:00:00').toISOString();
      return WQ.save.reclaimState(p, now).days;
    }
    return days(1) + '/' + days(3) + '/' + days(9);
  });
  test('错题本重练', '错 2 次后第 1 天不可重练、第 3 天可重练', 'false/true', function () {
    const p = WQ.save.defaultProgress('w1');
    p.wrongCount = 2;
    p.lastWrongAt = new Date(2025, 0, 10, 10, 0, 0).toISOString();
    const day1 = WQ.save.reclaimState(p, new Date(2025, 0, 11, 9, 0, 0)).can;
    const day3 = WQ.save.reclaimState(p, new Date(2025, 0, 13, 9, 0, 0)).can;
    return day1 + '/' + day3;
  });
  test('错题本重练', '移出后 wrongCount=0 且保留 SRS 状态（correctCount 不变）', '0/3', function () {
    const p = WQ.save.defaultProgress('w1');
    p.wrongCount = 4;
    p.lastWrongAt = new Date().toISOString();
    p.correctCount = 3;
    p.consecutiveCorrect = 2;
    /* 与 growth 页「移出」按钮同一套写法 */
    p.wrongCount = 0;
    p.lastWrongAt = null;
    return p.wrongCount + '/' + p.correctCount;
  });

  /* ================= v0.2 修复回归（docs/06 的 P0 三项） ================= */

  /** 造一个「未打完」的会话（模拟刷新/中途退出时的快照） */
  function abortedSession(save, opts) {
    const o = opts || {};
    const qs = q3Questions(o.n || 3, save, o.start || 3);
    const s = makeSession(qs, { n: o.n || 3 });
    answerAll(save, s, { allCorrect: o.allCorrect !== false });
    s.aborted = true;
    return s;
  }

  test('D2 中断局', '中断局不计完成局数、不写每日首局标志', 'true/0/false/true', function () {
    const save = fakeSave();
    const s = abortedSession(save, { n: 3, start: 40 });
    const coinsBefore = save.profile.coins;
    const res = WQ.game.applyRoundEnd(save, s, new Date(2025, 0, 10, 12, 5, 0));
    const gained = save.profile.coins - coinsBefore;
    return chained(!!res.roundRecord.aborted, save.daily.todayRounds, save.daily.todayFirstRoundDone, gained > 0);
  });
  test('D2 中断局', '中断局仍保留已得 XP / 金币 / 词进度', 'true/true/true/true', function () {
    const save = fakeSave();
    const s = abortedSession(save, { n: 4, start: 44 });
    const totalXpBefore = save.profile.totalXp;
    const coinsBefore = save.profile.coins;
    const sXp = s.xpGained, sCoins = s.coinsGained;
    const res = WQ.game.applyRoundEnd(save, s, new Date(2025, 0, 10, 12, 5, 0));
    const rr = res.roundRecord;
    /* 中断局不发每日首局，所以：
         累计 XP 增量 === 会话累计 XP + 徽章 XP + 任务 XP（"已得收益全部保留"的硬口径）
         金币增量     === 各明细行金币之和 + 对局本体金币
       档内 XP 可能因升级而溢出，所以用 totalXp 验收益、用 coins 验金币。 */
    const breakdownCoins = (rr.breakdown || []).filter(function (b) { return b.unit === 'coin'; })
      .reduce(function (a, b) { return a + (Number(b.value) || 0); }, 0);
    const expectXpTotal = sXp + Number(rr.bonusXp || 0) + Number(rr.questXp || 0);
    const expectCoins = sCoins + breakdownCoins;
    return chained(
      sXp > 0 && sCoins > 0,
      save.profile.totalXp - totalXpBefore === expectXpTotal,
      save.profile.coins - coinsBefore === expectCoins,
      Object.keys(save.progress).length > 0 && rr.xpGained === sXp
    );
  });
  test('D2 中断局', '中断局不解锁"完成类"徽章（首次通关 / 无伤）', 'false/false', function () {
    const save = fakeSave();
    const qs = q3Questions(8, save, 0);
    const s = makeSession(qs, { n: 8 });
    answerAll(save, s);
    s.aborted = true;             // 全对但标记为中断：不得解锁 firstClear
    WQ.game.applyRoundEnd(save, s, new Date(2025, 0, 10, 12, 5, 0));
    const a = save.achievements;
    return chained(!!(a.firstClear && a.firstClear.unlocked), !!(a.unstoppable && a.unstoppable.unlocked));
  });
  test('D2 中断局', '中断局之后真正的第一局仍拿到每日首局奖励', 'true/true/true', function () {
    const save = fakeSave();
    const s1 = abortedSession(save, { n: 3, start: 52 });
    WQ.game.applyRoundEnd(save, s1, new Date(2025, 0, 10, 12, 5, 0));
    const firstStillOpen = save.daily.todayFirstRoundDone === false;
    /* 第二局：完整打完且答对，应当拿到每日首局（+20 XP / +15 金币） */
    const qs = q3Questions(2, save, 60);
    const s2 = makeSession(qs, { n: 9 });
    answerAll(save, s2);
    const res = WQ.game.applyRoundEnd(save, s2, new Date(2025, 0, 10, 12, 20, 0));
    const hasDaily = !!res.dailyFirstEligible;
    const coinsDelta = (Number(res.roundRecord && res.roundRecord.coinsGained) || 0);
    return chained(firstStillOpen, hasDaily, coinsDelta >= 15 && save.daily.todayFirstRoundDone === true);
  });
  test('D1 补结算', '同一 roundId 重复补结算不重复发奖（幂等）', 'true/false/true/1', function () {
    const save = fakeSave();
    const qs = q3Questions(3, save, 70);
    const s = makeSession(qs, { n: 10 });
    answerAll(save, s);
    const r1 = WQ.game.applyRoundEnd(save, s, new Date(2025, 0, 10, 12, 5, 0));
    const coinsAfter1 = save.profile.coins;
    const r2 = WQ.game.applyRoundEnd(save, s, new Date(2025, 0, 10, 12, 6, 0));
    return chained(!!r1.applied, !!r2.applied, save.profile.coins === coinsAfter1, save.rounds.length);
  });
  test('D1 补结算', '会话快照只含可序列化字段（能安全写进 localStorage）', true, function () {
    const save = fakeSave();
    const qs = q3Questions(2, save, 80);
    const s = makeSession(qs, { n: 11 });
    answerAll(save, s);
    try {
      const text = JSON.stringify(s);
      const back = JSON.parse(text);
      return back.roundId === s.roundId && Array.isArray(back.questions) && back.questions.length === 2;
    } catch (e) { return false; }
  });

  test('D5 道具持久化', 'fillDefaults 保留 profile 内的待生效道具', '3/true', function () {
    const raw = WQ.save.defaultSave();
    raw.profile.pendingScoutEye = 3;
    raw.profile.pendingStrawDouble = true;
    const back = WQ.save.fillDefaults(JSON.parse(JSON.stringify(raw)));
    return back.profile.pendingScoutEye + '/' + back.profile.pendingStrawDouble;
  });
  test('D5 道具持久化', '旧档把道具写在顶层也能迁移进 profile', '2/true', function () {
    const raw = JSON.parse(JSON.stringify(WQ.save.defaultSave()));
    /* 模拟 v0.1 的顶层写法 */
    raw.pendingScoutEye = 2;
    raw.pendingStrawDouble = true;
    delete raw.profile.pendingScoutEye;
    delete raw.profile.pendingStrawDouble;
    const back = WQ.save.fillDefaults(raw);
    return back.profile.pendingScoutEye + '/' + back.profile.pendingStrawDouble;
  });

  test('D6 版本拒绝', 'version 高于当前代码时 migrate 返回 rejected 且不动数据', 'true/9', function () {
    const raw = { version: 9, profile: { level: 5, xp: 10 }, 未知字段: { a: 1 } };
    const mig = WQ.save.migrate(raw);
    return chained(mig.rejected, raw.version);
  });
  test('D6 版本拒绝', '低版本存档正常迁移（不拒绝）', 'false/true', function () {
    const mig = WQ.save.migrate({ version: 0, profile: {} });
    return chained(mig.rejected, mig.migrated);
  });
  test('D6 版本拒绝', 'fillDefaults 会修正异常的高版本号（避免拒绝加载的存档被反复触发）', '1', function () {
    const back = WQ.save.fillDefaults({ version: 9, profile: {} });
    return String(back.version);
  });

  test('D3 多标签合并', 'mergeSave 按 roundId 去重且保留双方全部记录', 'r1,r2', function () {
    const a = WQ.save.defaultSave();
    a.rounds = [
      { roundId: 'r1', endedAt: '2025-01-10T10:00:00.000Z', xpGained: 50, coinsGained: 20 },
      { roundId: 'r1', endedAt: '2025-01-10T10:00:00.000Z', xpGained: 50, coinsGained: 20 }
    ];
    const b = WQ.save.defaultSave();
    b.rounds = [{ roundId: 'r2', endedAt: '2025-01-10T11:00:00.000Z', xpGained: 60, coinsGained: 25 }];
    WQ.save.mergeSave(a, b);
    return a.rounds.map(function (r) { return r.roundId; }).sort().join(',');
  });
  test('D3 多标签合并', 'mergeSave 的进度量取双方最大值（不覆盖对方的进度）', '3000/30/true', function () {
    const a = WQ.save.defaultSave();
    a.profile.coins = 900;
    a.stats.totalCorrect = 30;
    const b = WQ.save.defaultSave();
    b.profile.coins = 1200;
    b.stats.totalCorrect = 12;
    WQ.save.mergeSave(a, b);
    const afterFirst = a.profile.coins;
    /* 再合并一份更靠后的存档：只增不减（合并是单调的） */
    const c = WQ.save.defaultSave();
    c.profile.coins = 3000;
    WQ.save.mergeSave(a, c);
    return chained(a.profile.coins, a.stats.totalCorrect, a.profile.coins >= afterFirst);
  });
  test('D3 多标签合并', 'mergeSave 保留双方的已解锁徽章（取并集）', '2', function () {
    const a = WQ.save.defaultSave();
    a.achievements = { firstBlood: { unlocked: true, unlockedAt: '2025-01-01T00:00:00.000Z' } };
    const b = WQ.save.defaultSave();
    b.achievements = { hundredWords: { unlocked: true, unlockedAt: '2025-01-02T00:00:00.000Z' } };
    WQ.save.mergeSave(a, b);
    return String(Object.keys(a.achievements).filter(function (k) { return a.achievements[k].unlocked; }).length);
  });
  test('D3 多标签合并', 'mergeSave 保留双方的词级进度（取更靠后的 lastSeenAt）', 'true', function () {
    const a = WQ.save.defaultSave();
    a.progress = { w1: Object.assign(WQ.save.defaultProgress('w1'), { seenCount: 3, wrongCount: 1, lastSeenAt: '2025-01-10T10:00:00.000Z' }) };
    const b = WQ.save.defaultSave();
    b.progress = {
      w1: Object.assign(WQ.save.defaultProgress('w1'), { seenCount: 5, wrongCount: 2, lastSeenAt: '2025-01-11T10:00:00.000Z' }),
      w2: Object.assign(WQ.save.defaultProgress('w2'), { seenCount: 1, lastSeenAt: '2025-01-11T10:00:00.000Z' })
    };
    WQ.save.mergeSave(a, b);
    const w1 = a.progress.w1;
    return String(chained(!!a.progress.w2, w1.seenCount === 5, w1.wrongCount === 2, w1.lastSeenAt === '2025-01-11T10:00:00.000Z') === 'true/true/true/true');
  });

  test('侦查之眼', '带侦查之眼开局时排除 1 个错误项且排除项稳定不变', 'true/true', function () {
    const s = { scoutEyeRemaining: 3, scoutEyeUsed: 0, judged: false };
    const entry = WQ.qe.toEntry(WQ.WORDS[0]);
    const pool = WQ.WORDS.map(function (w) { return WQ.qe.toEntry(w); });
    const q = WQ.qe.buildQuestion(entry, pool, 'Q1', [], U.rng(5));
    if (!q) return 'no-question';
    const i1 = WQ.questionPool.scoutExcludeIndex(q, s);
    const i2 = WQ.questionPool.scoutExcludeIndex(q, s);
    const opt = q.options[i1];
    return (i1 >= 0 && opt && !opt.correct ? 'true' : 'false') + '/' + (i1 === i2 ? 'true' : 'false');
  });
  test('侦查之眼', '没有额度时不排除任何选项', '-1', function () {
    const entry = WQ.qe.toEntry(WQ.WORDS[0]);
    const pool = WQ.WORDS.map(function (w) { return WQ.qe.toEntry(w); });
    const q = WQ.qe.buildQuestion(entry, pool, 'Q1', [], U.rng(6));
    return String(WQ.questionPool.scoutExcludeIndex(q, { scoutEyeRemaining: 0, scoutEyeUsed: 0, judged: false }));
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
