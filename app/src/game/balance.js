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

  /** 金币明细行（与 XP 行分开，便于结算页显示「金币」单位） */
  function pushCoin(list, key, label, value) {
    pushItem(list, key, label, value, 'coin');
  }

  /**
   * 未完成局（中途退出 / 刷新补结算）允许解锁的徽章白名单。
   *
   * 为什么需要它：中断局要保留收益，就不能把整条结算路径砍掉；但它没有"完成一局"这个事实，
   * 所以「首次通关 / 无伤 / 百发百中 / 挥金如土」这类**必须由一个完整结果触发**的徽章一律不发。
   * 其余靠累计量（总答对数、等级、累计消费）的徽章在中断局里照常判定，避免收益被无谓卡住。
   * 另外 B8/B9（早起鸟 / 夜猫子）由「完成一局」定义，中断局不参与判定。
   */
  const ABORT_SAFE_BADGES = {
    firstBlood: true,
    hundredWords: true,
    veteranHunter: true,
    hunterLeader: true,
    bigSpender: true,
    maxHunter: true
  };

  function filterUnlockedForAbort(unlocked) {
    const kept = (unlocked || []).filter(function (b) { return !!(b && ABORT_SAFE_BADGES[b.id]); });
    const dropped = (unlocked || []).filter(function (b) { return !(b && ABORT_SAFE_BADGES[b.id]); });
    if (dropped.length) {
      /* 理论上不会发生：checkAchievements 只按传入的白名单判定。留作防御与日志。 */
      WQ.log.warn('中断局拦下了不应解锁的徽章：' + dropped.map(function (b) { return b.id; }).join(','));
    }
    return { unlocked: kept, dropped: dropped };
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
    if (!session.progressAnswered) session.progressAnswered = Object.create(null);

    /* v0.2 修 D-new：`before` 必须以**存档里的持久进度**为基准，而不是每局新建的 session.progressMap。
       否则 words 的 seenCount / correctCount 每局都从 0 开始 →「新词首答 +5」「击败新词 +5」每局重发，
       单局 XP 被系统性抬高（这也是 docs/06 把 285 归因于"PRD 算术错误"时漏掉的一半原因）。
       同一局内第一次作答该词时用存档值做基准，之后沿用本局已累计的 session 值（重试也走这条路径）。 */
    const base = WQ.save.defaultProgress(q.wordId);
    let before;
    if (!session.progressAnswered[q.wordId]) {
      const persisted = (save.progress && save.progress[q.wordId]) || null;
      before = Object.assign(base, persisted ? U.deepClone(persisted) : {});
      session.progressAnswered[q.wordId] = true;
    } else {
      before = Object.assign(base, session.progressMap[q.wordId] ? U.deepClone(session.progressMap[q.wordId]) : {});
    }
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

    /* ---- 中断局判定（docs/06 D2）----
       未完成就退出的局：保留全部已得收益与词进度，但
         · isWin = false（不再把它当成"完成局"）
         · 不写 daily.todayFirstRoundDone（每日首局奖励留给今天真正的第一局）
         · 不进 stats.totalRounds / daily.todayRounds / 徽章的"完成类"判定
       旧版存档里没有 aborted 标记的中断会话，用「血量未归零且没答完全部题」反推。 */
    const answeredTotal = (Number(session.correct) || 0) + (Number(session.wrong) || 0) + (Number(session.skipped) || 0);
    const incomplete = (Number(session.hpLeft) || 0) > 0 && answeredTotal < (Number(session.totalQuestions) || 0);
    const isAborted = session.aborted === true || (session.aborted == null && incomplete);
    const isCompletedRun = !isAborted && answeredTotal >= (Number(session.totalQuestions) || 0);

    const nowDate = now instanceof Date ? now : new Date(Number(now) || Date.now());
    const levelBefore = Number(save.profile.level) || 1;
    const xpBaseline = Number(save.profile.xp) || 0;   // 结算前等级内的 XP（结算页 XP 条起点）

    /* ---- 完美局 / 每日首局（放在 session 上，明细与金币都要用） ---- */
    const perfectXp = applyPerfectBonus(session);
    const dailyBonus = isAborted ? { xp: 0, coins: 0 } : applyDailyFirstBonus(session);

    /* ---- 本局"对局本体"收益（不含徽章与升级奖励，口径见 docs/03 §5.1 上限构造） ---- */
    const xpGained = (Number(session.xpGained) || 0) + perfectXp + dailyBonus.xp;
    const coinsGained = (Number(session.coinsGained) || 0) + B.coins.roundEnd + dailyBonus.coins + (perfectXp ? B.coins.perfect : 0);

    /* ---- 汇总 breakdown（结算页逐行展示） ---- */
    const breakdown = [];
    const sessionBreakdown = Array.isArray(session.breakdown) ? session.breakdown : [];
    sessionBreakdown.forEach(function (b) {
      pushItem(breakdown, b.key, b.label, b.value, b.unit);
    });
    if (perfectXp) pushItem(breakdown, 'perfect', '完美局', perfectXp, 'xp');
    if (dailyBonus.xp) pushItem(breakdown, 'dailyFirst', '每日首局', dailyBonus.xp, 'xp');
    /* 结算金币（单独成行，单位 coin） */
    pushCoin(breakdown, 'roundEnd', '结算奖励', B.coins.roundEnd);
    if (dailyBonus.coins) pushCoin(breakdown, 'dailyFirstCoin', '每日首局', dailyBonus.coins);
    if (perfectXp) pushCoin(breakdown, 'perfectCoin', '完美局', B.coins.perfect);

    /* ---- 写 profile 的 XP 部分 ---- */
    save.profile.xp = (Number(save.profile.xp) || 0) + xpGained;
    save.profile.totalXp = (Number(save.profile.totalXp) || 0) + xpGained;

    /* ---- 本局「对局本体」的升级结算 ----
       必须紧跟在 xpGained 入账之后：否则后面的每日任务/宝箱也会往 profile.xp 里加 XP，
       而这些 XP 可能先把等级顶上去，最终这段"对局本体 XP"反而被升级逻辑吞掉，
       造成「档内 XP 增量 ≠ 本局本体育量」的账目不一致（v0.2 修正）。
       升级金币不在这里入账（applyLevelUps 默认不写 coins），只记进明细，由下面的总账统一写。 */
    const lv = WQ.level.applyLevelUps(save.profile);
    const levelAfterRound = Number(save.profile.level) || levelBefore;
    if (lv.coinsFromLevels) pushCoin(breakdown, 'levelUp', '升级奖励（' + lv.levelUps.length + ' 级）', lv.coinsFromLevels);

    /* ---- 词库进度落库 ----
       只落"本局实际作答过的词"（作答过的词都在 session.log 里），避免每局全量深拷贝 progressMap
       （500 局历史下这是 O(词库 × 历史局数) 的开销）。 */
    const answeredIds = Object.create(null);
    (Array.isArray(session.log) ? session.log : []).forEach(function (l) {
      if (l && l.wordId) answeredIds[l.wordId] = true;
    });
    if (session.progressMap) {
      Object.keys(session.progressMap).forEach(function (id) {
        if (!answeredIds[id]) return;
        const p = WQ.srs.refreshMastery(session.progressMap[id]);
        save.progress[id] = p;
      });
    }

    const todayKey = session.startedDate || U.todayKey(nowDate);
    const isWin = !isAborted && (Number(session.hpLeft) || 0) > 0;
    const totalQuestions = Number(session.totalQuestions) || 0;
    const isPerfect = perfectXp > 0;
    const log = Array.isArray(session.log) ? session.log.slice() : [];

    /* ---- stats 累加 ----
       中断局照常累计题数与正确数（收益要保留、正确率要真实），
       但 totalRounds 表示"完成局数"，中断局不计入。 */
    const st = save.stats;
    if (!isAborted) st.totalRounds += 1;
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

    /* 注意：这里只加"本局本体"金币。
       徽章金币与任务/宝箱金币在各自的发奖点已经加过 stats.coinsEarned
       （achievements.js 的 checkAchievements、quest.grant、chest.open），
       升级金币与徽章金币在下方一起补，避免重复计数（v0.2 修正）。 */

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
    if (!isAborted) day.rounds += 1;   /* 每日曲线的"局数"只数完成局 */
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

    /* ---- daily 状态 ----
       todayRounds / todayFirstRoundDone 只对"完成的局"生效（修 D2）；
       todayAttempts 单独记中断局，供统计与调试查看。 */
    save.daily.todayAttempts = (Number(save.daily.todayAttempts) || 0) + 1;
    if (!isAborted) {
      save.daily.todayRounds = (Number(save.daily.todayRounds) || 0) + 1;
      if (isWin) save.daily.todayFirstRoundDone = true;
    }
    save.daily.todayCorrect = (Number(save.daily.todayCorrect) || 0) + (Number(session.correct) || 0);
    save.daily.todayWrong = (Number(save.daily.todayWrong) || 0) + (Number(session.wrong) || 0);
    save.daily.todayXp = (Number(save.daily.todayXp) || 0) + xpGained;
    save.daily.todayCoins = (Number(save.daily.todayCoins) || 0) + coinsEarnedThisRound;

    /* ---- streak（结算分支，docs/03 §4.7；中断局不计入签到） ---- */
    const streakRes = isAborted ? { stage: 'aborted', changed: false } : (WQ.streak.settleOnRoundEnd(save, nowDate) || {});

    /* ---- 每日任务推进 + 宝箱碎片（v0.2，docs/03 §5.9） ----
       quest.settle() 只返回"应发的金币/XP"，不直接改 profile —— 由下面统一入账，
       保证 profile 的增量能被 RoundRecord 的明细行精确对账。 */
    const questReward = { coins: 0, xp: 0, completed: [], bonus: false };
    if (WQ.quest) {
      WQ.quest.advance(save, {
        roundId: session.roundId,
        aborted: isAborted,
        maxCombo: Number(session.maxCombo) || 0,
        isPerfect: isPerfect && isCompletedRun,
        /* 错题本重练：本局答对的词算「重练打回来」（徽章 B13） */
        reclaimed: session.reclaim ? (Number(session.correct) || 0) : 0
      });
      const q = WQ.quest.settle(save, nowDate) || {};
      questReward.coins = Number(q.coinGain) || 0;
      questReward.xp = Number(q.xpGain) || 0;
      questReward.completed = q.completed || [];
      questReward.bonus = !!q.bonus;
      if (questReward.coins) st.coinsEarned += questReward.coins;   // 统计口径，不算进 profile（总账里统一写）
      if (questReward.xp) {
        /* 任务 XP 也不直接进 profile：它要参与 totalXp 和升级队列，由总账统一入账 */
      }
    }
    const questCoins = questReward.coins;
    const questXp = questReward.xp;
    if (questCoins) pushCoin(breakdown, 'quest', '每日任务', questCoins);
    if (questXp) pushItem(breakdown, 'questXp', '每日任务经验', questXp, 'xp');
    /* 宝箱碎片随今日连续答对增长（每日上限内） */
    if (WQ.chest) WQ.chest.syncShards(save, nowDate);

    /* ---- 徽章（结算批量判定）；中断局只允许"累计量类"徽章解锁 ---- */
    /* unlockedBefore 必须取 def.id：getAllProgress() 返回的是 { def, progress, target, text, unlocked, unlockedAt }，
       没有顶层 id 字段（v0.2 修：这里写成 x.id 会让 indexOf 永远命中不到，
       导致 questUnlocked 退化成"全部已解锁徽章"，把旧徽章奖励每局重发一次）。 */
    const unlockedBefore = WQ.ach.getAllProgress(save)
      .filter(function (x) { return x.unlocked && x.def; })
      .map(function (x) { return x.def.id; });
    const achCtx = {
      maxCombo: session.maxCombo,
      isPerfect: isPerfect,
      masteredCount: st.masteredCount,
      level: save.profile.level
    };
    if (isAborted) achCtx.allowIds = ABORT_SAFE_BADGES;
    /* deferAward：徽章奖励不在这里写 profile，交给总账统一入账（避免与 earnedCoins 重复） */
    achCtx.deferAward = true;
    const achRes = WQ.ach.checkAchievements(save, nowDate, achCtx);
    /* 任务/宝箱在上一段就可能当场解锁 B12–B14（它们的 checkOn 分别是 quest/chest/reclaim）：
       这里把"任务结算前后新解锁的"补进本局明细，结算页的「新解锁徽章」块才完整。 */
    const questUnlocked = WQ.ach.getAllProgress(save)
      .filter(function (x) { return x.unlocked && x.def && unlockedBefore.indexOf(x.def.id) < 0; })
      .filter(function (x) { return achRes.unlocked.every(function (b) { return b.id !== x.def.id; }); })
      .map(function (x) { return x.def; });
    const allUnlocked = achRes.unlocked.concat(questUnlocked);
    const badgeCoins = allUnlocked.reduce(function (a, b) { return a + (b.coinReward || 0); }, 0);
    const badgeXp = allUnlocked.reduce(function (a, b) { return a + (b.xpReward || 0); }, 0);
    if (badgeCoins) pushCoin(breakdown, 'badge', '徽章 ×' + allUnlocked.length, badgeCoins);

    /* ---- 任务/宝箱 XP 之后再滚一次升级（它们也可能顶上一级） ---- */
    const lv2 = WQ.level.applyLevelUps(save.profile);
    const levelUps = lv.levelUps.concat(lv2.levelUps);
    if (lv2.coinsFromLevels) pushCoin(breakdown, 'levelUp2', '任务/徽章经验升级', lv2.coinsFromLevels);

    /* ---- 徽章 XP 明细行 ---- */
    if (badgeXp) pushItem(breakdown, 'badgeXp', '徽章经验', badgeXp, 'xp');

    /* ---- 金币/XP 最终账目（v0.2：profile 只在这里被写一次，其余都是"记账"） ----
       定稿：roundRecord.xpGained 只含"对局本体"（基础分 + 新词 + 连击 + 完美局 + 每日首局），
       roundRecord.coinsGained 同理。其余来源分别单列，全部相加 = 本局总入账：
         xpGained + bonusXp（徽章 XP）+ questXp（任务 XP）
         coinsGained + badgeCoins + levelUpCoins + questCoins
       因此「明细行逐行相加 === 档内增量」这个不变量可以自动断言。 */
    const bonusXp = badgeXp;
    let levelUpCoins = lv.coinsFromLevels + lv2.coinsFromLevels;
    /* 对局本体的 XP 前面已经入账，这里只补"非本体的"部分，避免重复 */
    const extraXp = bonusXp + questXp;
    if (extraXp) {
      save.profile.xp = (Number(save.profile.xp) || 0) + extraXp;
      save.profile.totalXp = (Number(save.profile.totalXp) || 0) + extraXp;
      /* 这些 XP 可能还会顶上一级 → 再滚一次升级队列（金币也要一起计入总额，否则账会短 30/次） */
      const lv3 = WQ.level.applyLevelUps(save.profile);
      if (lv3.levelUps.length) {
        lv2.levelUps = lv2.levelUps.concat(lv3.levelUps);
        if (lv3.coinsFromLevels) {
          pushCoin(breakdown, 'levelUp3', '经验溢出升级', lv3.coinsFromLevels);
          levelUpCoins += lv3.coinsFromLevels;
        }
      }
    }
    const bonusCoins = badgeCoins + levelUpCoins;
    const earnedCoins = coinsGained + bonusCoins + questCoins;
    save.profile.coins = (Number(save.profile.coins) || 0) + earnedCoins;
    /* 统计口径：金币来源里只有"升级金币"还没有进过 coinsEarned
       （徽章由 checkAchievements、任务由 quest.settle 的记账点各自计入，本体金币在上面已计入） */
    st.coinsEarned += levelUpCoins;

    /* day.coins / daily.todayCoins 是"本局总入账"，因此加全额 extraCoins */
    const extraCoins = bonusCoins + questCoins;
    if (extraCoins) {
      coinsEarnedThisRound += extraCoins;
      day.coins += extraCoins;
      save.daily.todayCoins += extraCoins;
    }

    /* ---- RoundRecord（字段照 docs/03 §6.8） ---- */
    const roundRecord = {
      roundId: session.roundId,
      startedAt: session.startedAt || nowDate.toISOString(),
      endedAt: nowDate.toISOString(),
      durationMs: durationMs,
      isWin: isWin,
      isPerfect: isPerfect,
      /* v0.2（D2）：中断局单独标记，结算页与统计可以区分「完成」与「中途退出」 */
      aborted: isAborted,
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
      /* v0.2：bonusXp 只含徽章 XP；每日任务 XP 单列在 questXp（结算页会把两者都算进合计） */
      bonusXp: badgeXp,
      bonusCoins: bonusCoins,
      levelUpCoins: levelUpCoins,
      /* v0.2：每日任务/宝箱的入账单列，保证「明细逐行相加 === 顶部合计」 */
      questXp: questXp,
      questCoins: questCoins,
      extraXp: badgeXp + questXp,
      extraCoins: bonusCoins + questCoins,
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
      unlockedAchievementIds: allUnlocked.map(function (b) { return b.id; }),
      source: session.source === 'wrongBook' ? 'wrongBook' : 'normal',
      /* 便于结算页展示的附加字段（不改变上游语义） */
      levelUps: levelUps,
      accuracy: totalQuestions ? (Number(session.correct) || 0) / totalQuestions : 0
    };

    save.rounds.push(roundRecord);
    if (save.rounds.length > B.maxRounds) save.rounds = save.rounds.slice(-B.maxRounds);

    WQ.log.add('roundEnd', {
      roundId: roundRecord.roundId,
      isWin: roundRecord.isWin,
      aborted: roundRecord.aborted,
      isPerfect: roundRecord.isPerfect,
      correct: roundRecord.correct,
      wrong: roundRecord.wrong,
      skipped: roundRecord.skipped,
      maxCombo: roundRecord.maxCombo,
      xpGained: roundRecord.xpGained,
      coinsGained: roundRecord.coinsGained,
      questXp: questXp,
      questCoins: questCoins,
      durationMs: roundRecord.durationMs,
      levelBefore: roundRecord.levelBefore,
      levelAfter: roundRecord.levelAfter
    });

    return {
      applied: true,
      save: save,
      roundRecord: roundRecord,
      levelUps: levelUps,
      unlocked: achRes.unlocked,
      streak: streakRes,
      aborted: isAborted,
      /* 结算页 XP 条动画的起点：结算前等级内的 XP */
      baseline: { level: levelBefore, xp: xpBaseline },
      dailyFirstEligible: dailyBonus.xp > 0,
      totals: {
        xp: xpGained + badgeXp + questXp,
        coins: earnedCoins,
        badgeXp: badgeXp,
        badgeCoins: badgeCoins,
        levelUpCoins: levelUpCoins,
        questXp: questXp,
        questCoins: questCoins
      }
    };
  }

  /**
   * 跨天结算（docs/03 §4.3 rolloverDaily）：
   * 重置每日标志与限购、跨月重置月度计数、结清 streak、结算每日任务与宝箱。
   *
   * v0.2：这里成为「跨天唯一入口」——无论从启动、进营地还是开局前调用，结果都一致（幂等）。
   */
  function rolloverDaily(save, now) {
    if (!save) return save;
    const nowDate = now instanceof Date ? now : new Date(Number(now) || Date.now());
    const today = U.todayKey(nowDate);
    const month = U.ymKey(nowDate);
    let rolled = false;

    if (save.daily.todayDate !== today) {
      save.daily.todayDate = today;
      save.daily.todayFirstRoundDone = false;
      save.daily.todayRounds = 0;
      save.daily.todayAttempts = 0;
      save.daily.todayCorrect = 0;
      save.daily.todayWrong = 0;
      save.daily.todayXp = 0;
      save.daily.todayCoins = 0;
      save.daily.shopDailyCount = {};
      rolled = true;
    }
    if (save.daily.shopMonthKey !== month) {
      save.daily.shopMonthKey = month;
      save.daily.shopDailyCount = {};
    }
    WQ.streak.rolloverMonth(save, nowDate);
    WQ.streak.rolloverStreak(save, nowDate);

    /* 每日任务 + 宝箱的跨天结算（v0.2，内部按日期键幂等） */
    if (WQ.quest) {
      const q = WQ.quest.settle(save, nowDate);
      if (q && q.newDay) rolled = true;
    }
    save.daily.rolled = rolled;
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
