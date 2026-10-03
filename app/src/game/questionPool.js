/* src/game/questionPool.js
 * 唯一职责：每局选词（优先级打分 → 排序 → 取 N，含候选不足缩减，docs/03 §4.6 / §5.8 / §7.4）。
 * 依赖：WQ.balance、WQ.util、WQ.qe、WQ.save
 * 被依赖：src/ui/pages/battle.js（开局）、src/ui/pages/home.js（开局入口）
 * 硬约束：纯函数；随机数由入参 rnd() 注入；同局 wordId 不重复。
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;
  const U = WQ.util;

  /** 词条索引缓存（词库在运行期不变） */
  let entryCache = null;
  let entryCacheKey = '';

  function entriesOf(words) {
    const key = String((words || []).length) + ':' + String(words && words[0] ? words[0].id : '');
    if (entryCache && entryCacheKey === key) return entryCache;
    entryCache = (words || []).map(function (w) { return WQ.qe.toEntry(w); });
    entryCacheKey = key;
    return entryCache;
  }

  /**
   * 给一个词算优先级与排序键（docs/03 §5.8）。
   * @returns {{priority:number, sortKey:number, reason:string}}
   */
  function priorityOf(entry, progress, nowMs) {
    const p = progress || null;
    const seen = p ? Number(p.seenCount) || 0 : 0;
    const wrongAt = p && p.lastWrongAt ? U.parseTime(p.lastWrongAt) : null;
    const nextAt = p && p.nextReviewAt ? U.parseTime(p.nextReviewAt) : null;

    /* 1. 错词复活：wrongCount > 0 且距上次答错 > 6 小时 */
    if (p && Number(p.wrongCount) > 0 && wrongAt && (nowMs - wrongAt.getTime()) > B.priority.wrongCooldownMs) {
      return { priority: B.priority.wrongRevive, sortKey: wrongAt.getTime(), reason: 'wrongRevive' };
    }
    /* 2. SRS 到期 */
    if (nextAt && nextAt.getTime() <= nowMs) {
      return { priority: B.priority.srsDue, sortKey: nextAt.getTime(), reason: 'srsDue' };
    }
    /* 3. 新词 */
    if (seen === 0) {
      const frq = Number.isFinite(Number(entry.frq)) ? Number(entry.frq) : 999999;
      return { priority: B.priority.brandNew, sortKey: frq, reason: 'brandNew' };
    }
    /* 4. 巩固 */
    const lastSeen = p && p.lastSeenAt ? U.parseTime(p.lastSeenAt) : null;
    return {
      priority: B.priority.consolidate,
      sortKey: lastSeen ? lastSeen.getTime() : 0,
      reason: 'consolidate'
    };
  }

  /** 候选池大小（自检断言：300 词库时应为 200 而不是全池） */
  function candidatePoolSize(save, deckSize) {
    const n = Number(deckSize) || 0;
    const cap = B.round.questionCount * 2 + 4;
    return Math.min(n, cap);
  }

  /**
   * 构建一局。
   * @param {object} opts
   *   save       存档（只读）
   *   words      词库原始数组（WQ.WORDS）
   *   source     'normal' | 'wrongBook'
   *   now        Date | number
   *   rnd        function 随机数发生器
   *   limit      题数上限，默认 B.round.questionCount
   *   ttsAvailable 是否可用 TTS（影响 Q4）
   * @returns {{questions:Array, totalQuestions:number, candidatePoolSize:number, skippedWordIds:string[], deckSize:number}}
   */
  function buildRound(opts) {
    const o = opts || {};
    const save = o.save || WQ.save.defaultSave();
    const words = o.words || WQ.WORDS || [];
    const rnd = typeof o.rnd === 'function' ? o.rnd : Math.random;
    const nowMs = o.now instanceof Date ? o.now.getTime() : (Number(o.now) || Date.now());
    const limit = Math.max(1, Math.floor(Number(o.limit) || B.round.questionCount));
    const source = o.source === 'wrongBook' ? 'wrongBook' : 'normal';
    const tts = o.ttsAvailable !== false;

    const deck = entriesOf(words);
    const entries = deck; // 干扰项从整册词库取（用于凑选项），选词只从优先候选取
    const progress = save.progress || {};
    const byId = Object.create(null);
    entries.forEach(function (e) { byId[e.id] = e; });

    const scored = entries.map(function (e) {
      const info = priorityOf(e, progress[e.id], nowMs);
      return { entry: e, priority: info.priority, sortKey: info.sortKey, reason: info.reason };
    });

    /* 排序：优先级降序 → 排序键升序 → id 升序稳定兜底 */
    scored.sort(function (a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      return String(a.entry.id).localeCompare(String(b.entry.id));
    });

    /* 错题本重练：只保留 wrongCount > 0 的词（docs/03 §4.10） */
    let ranked = scored;
    if (source === 'wrongBook') {
      ranked = scored.filter(function (s) {
        const p = progress[s.entry.id];
        return !!(p && Number(p.wrongCount) > 0);
      }).sort(function (a, b) {
        const pa = progress[a.entry.id] || {};
        const pb = progress[b.entry.id] || {};
        return (Number(pb.wrongCount) - Number(pa.wrongCount))
          || (String(pb.lastWrongAt || '').localeCompare(String(pa.lastWrongAt || '')))
          || String(a.entry.id).localeCompare(String(b.entry.id));
      });
    }

    /* 候选池：普通局取上限内的高优先词（按优先级依次下探补齐）；错词局取全部错词 */
    const poolCap = source === 'wrongBook' ? ranked.length : candidatePoolSize(save, entries.length);
    const candidates = ranked.slice(0, Math.max(limit, poolCap));

    const picked = [];
    const usedIds = Object.create(null);
    const skippedWordIds = [];

    /* 先按题数上限取"选中的词"（顺序即优先级顺序） */
    const selectedEntries = [];
    for (let i = 0; i < candidates.length && selectedEntries.length < limit; i++) {
      selectedEntries.push(candidates[i].entry);
    }

    /* 按权重抽题型；Q4 不可用时权重自动分摊 */
    const types = WQ.qe.pickQuestionTypes(selectedEntries.length, { ttsAvailable: tts, rnd: rnd });

    /* 每词生成题目；构造失败则尝试同词的其它题型，仍失败则换候选词补齐 */
    const fallbackOrder = WQ.questionTypeOrder.filter(function (t) {
      return tts || t !== 'Q4';
    });

    function tryBuild(entry, preferredType) {
      const order = [preferredType].concat(fallbackOrder.filter(function (t) { return t !== preferredType; }));
      for (let i = 0; i < order.length; i++) {
        const q = WQ.qe.buildQuestion(entry, entries, order[i], Object.keys(usedIds), rnd);
        if (q) {
          q.requestedType = preferredType;
          q.type = order[i];
          return q;
        }
      }
      return null;
    }

    selectedEntries.forEach(function (entry, idx) {
      /* 同一局内同一个词绝不出现两次（docs/03 §4.6 异常①；即使抽到重复也在这里挡掉） */
      if (usedIds[entry.id]) return;
      const q = tryBuild(entry, types[idx] || 'Q1');
      if (q) {
        picked.push(q);
        usedIds[entry.id] = true;
      } else {
        skippedWordIds.push(entry.id);
      }
    });

    /* 用候选池里还没用过的词补齐题数 */
    if (picked.length < limit) {
      for (let i = 0; i < candidates.length && picked.length < limit; i++) {
        const entry = candidates[i].entry;
        if (usedIds[entry.id]) continue;
        const q = tryBuild(entry, WQ.qe.pickQuestionTypes(1, { ttsAvailable: tts, rnd: rnd })[0] || 'Q1');
        if (q) {
          picked.push(q);
          usedIds[entry.id] = true;
        } else {
          skippedWordIds.push(entry.id);
        }
      }
    }

    return {
      questions: picked,
      totalQuestions: picked.length, // 候选不足时动态缩减（至少 1）
      candidatePoolSize: source === 'wrongBook' ? ranked.length : candidates.length,
      skippedWordIds: skippedWordIds,
      deckSize: entries.length
    };
  }

  WQ.questionPool = {
    priorityOf: priorityOf,
    candidatePoolSize: candidatePoolSize,
    buildRound: buildRound,
    entriesOf: entriesOf
  };
})(window.WQ = window.WQ || {});
