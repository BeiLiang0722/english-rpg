/* src/game/questionEngine.js
 * 唯一职责：题型抽取、选项与干扰项生成、拼写判定、挖空（docs/03 §4.4）。
 * 依赖：WQ.questionTypes、WQ.optionKeyOf、WQ.balance、WQ.util
 * 被依赖：src/game/questionPool.js、src/ui/pages/battle.js
 * 硬约束：纯函数；随机数一律由入参 rnd() 注入（禁止 Math.random），便于自检复现。
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;

  /** 词库原始条目 → 内存字段（小驼峰，docs/03 §3.2 映射表） */
  function toEntry(raw) {
    return {
      id: raw.id,
      word: raw.word,
      phonetic: raw.phonetic || '',
      pos: raw.pos || '',
      meaningCn: raw.meaning_cn || '',
      meaningEn: raw.meaning_en || '',
      example: raw.example || '',
      exampleCn: raw.example_cn || '',
      collins: raw.collins == null ? null : raw.collins,
      frq: raw.frq == null ? null : raw.frq,
      tags: raw.tags || [],
      audioUrl: raw.audio_url || null
    };
  }

  /** 词库条目索引：id → entry（内存条目） */
  function indexWords(words) {
    const map = Object.create(null);
    (words || []).forEach(function (w) { map[w.id] = toEntry(w); });
    return map;
  }

  /**
   * 按权重抽题型。Q4 需要 TTS：
   *   - 可用：按原始权重 0.40/0.25/0.20/0.10/0.05
   *   - 不可用：Q4 的 10% 按比例分摊给其余 4 种（.40/.25/.20/.05 归一）
   * @param {number} count
   * @param {object} opts { ttsAvailable:boolean, rnd:function }
   * @returns {string[]}
   */
  function pickQuestionTypes(count, opts) {
    const o = opts || {};
    const rnd = typeof o.rnd === 'function' ? o.rnd : Math.random;
    const tts = o.ttsAvailable !== false;
    const n = Math.max(0, Math.floor(Number(count) || 0));

    let weights = WQ.questionTypeOrder.map(function (id) {
      const t = WQ.questionTypes[id];
      if (t.needsTts && !tts) return 0;
      return t.weight;
    });
    let total = weights.reduce(function (a, b) { return a + b; }, 0);
    if (total <= 0) { weights = [1, 0, 0, 0, 0]; total = 1; }

    const out = [];
    for (let i = 0; i < n; i++) {
      let r = rnd() * total;
      let picked = 0;
      for (let j = 0; j < weights.length; j++) {
        r -= weights[j];
        if (r <= 0) { picked = j; break; }
        picked = j;
      }
      out.push(WQ.questionTypeOrder[picked]);
    }
    return out;
  }

  /** 题型分布（自检用：断言偏差 ≤ ±5 个百分点） */
  function typeDistribution(types) {
    const total = types.length || 1;
    const out = {};
    WQ.questionTypeOrder.forEach(function (t) {
      out[t] = types.filter(function (x) { return x === t; }).length / total;
    });
    return out;
  }

  /**
   * 生成 4 个选项（含正确项）。
   * 硬规则（绝不放宽）：
   *   1) Q1 干扰项的中文释义首字与正确项不同；Q2/Q4 干扰项的首字母与正确项不同；
   *   2) 同一局内已出现的词不入干扰项（usedIds）；
   *   3) 选项文本互不相同。
   * 优先同 pos；同 pos 不足 3 个时放宽 pos。
   * @param {object} entry 内存词条（正确项）
   * @param {Array} pool 全部内存词条
   * @param {string} type 题型
   * @param {string[]} usedIds 同局已出现的词 id
   * @param {function} rnd
   * @returns {{text:string, wordId:string, correct:boolean}|null} 数组，凑不满 4 项返回 null
   */
  function buildOptions(entry, pool, type, usedIds, rnd) {
    if (!entry) return null;
    const r = typeof rnd === 'function' ? rnd : Math.random;
    const used = {};
    (usedIds || []).forEach(function (id) { used[id] = true; });

    const keyOf = function (x) { return WQ.optionKeyOf(type, x); };
    const correctKey = keyOf(entry);
    const correctText = type === 'Q1' ? entry.meaningCn : entry.word;

    const baseFilter = function (x) {
      return x && x.id !== entry.id && !used[x.id];
    };
    const hardFilter = function (x) {
      return baseFilter(x) && keyOf(x) !== correctKey;
    };

    /* 同 pos 优先，并按 frq 接近度排序（难度相当） */
    const samePos = (pool || []).filter(function (x) { return hardFilter(x) && entry.pos && x.pos === entry.pos; });
    const relaxed = (pool || []).filter(function (x) { return hardFilter(x) && !(entry.pos && x.pos === entry.pos); });

    const frqOf = function (x) { return Number.isFinite(Number(x.frq)) ? Number(x.frq) : 999999; };
    const selfFrq = frqOf(entry);
    const byFrqCloseness = function (a, b) {
      return Math.abs(frqOf(a) - selfFrq) - Math.abs(frqOf(b) - selfFrq) || String(a.id).localeCompare(String(b.id));
    };

    const samePosSorted = samePos.slice().sort(byFrqCloseness);
    const relaxedSorted = relaxed.slice().sort(byFrqCloseness);

    const chosen = [];
    const texts = {};
    texts[correctText] = true;

    const takeFrom = function (list, limit) {
      for (let i = 0; i < list.length && chosen.length < limit; i++) {
        const cand = list[i];
        const text = type === 'Q1' ? cand.meaningCn : cand.word;
        if (!text || texts[text]) continue;
        /* 同一批干扰项之间也要保证首字/首字母互不相同，避免两个相似选项 */
        const dupKey = chosen.some(function (c) { return keyOf(c.entry) === keyOf(cand); });
        if (dupKey) continue;
        texts[text] = true;
        chosen.push({ entry: cand, text: text });
      }
    };

    takeFrom(samePosSorted, 3);
    if (chosen.length < 3) takeFrom(relaxedSorted, 3);

    if (chosen.length < 3) return null; // 凑不满 4 个选项：由调用方换词（docs/03 §7.4）

    const options = chosen.map(function (c) {
      return { text: c.text, wordId: c.entry.id, correct: false };
    });
    options.push({ text: correctText, wordId: entry.id, correct: true });
    return WQ.util.shuffle(options, r);
  }

  /**
   * 拼写判定（忽略大小写）：
   *   - 完全一致 → { correct:true, approximate:false }
   *   - 编辑距离 = 1 → { correct:true, approximate:true }（记为未掌握）
   *   - 其他 → { correct:false, approximate:false }
   */
  function checkSpelling(input, word) {
    const res = WQ.util.withinEditDistance1(input, word);
    if (res.equal) return { correct: true, approximate: false };
    if (res.distance1) return { correct: true, approximate: true };
    return { correct: false, approximate: false };
  }

  /**
   * 挖空：把例句里的目标词替换为等长下划线（保留大小写形状，首字母给出提示）。
   * 目标词在句中出现的次数由词库校验保证恰好 1 次；这里对全词边界做匹配，尽量避免局部误替换。
   */
  function maskWord(example, word) {
    const ex = String(example || '');
    const w = String(word || '');
    if (!w) return ex;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b' + escaped + '\\b', 'i');
    return ex.replace(re, function (m) {
      return m.charAt(0) + '_'.repeat(Math.max(1, m.length - 1));
    });
  }

  /** 例句中目标词出现次数（questionPool 用它判断能否出 Q5） */
  function countWordInExample(example, word) {
    const w = String(word || '');
    if (!w) return 0;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b' + escaped + '\\b', 'gi');
    const m = String(example || '').match(re);
    return m ? m.length : 0;
  }

  /** 生成一局的题目（内容部分）：题型 + 选项/挖空 */
  function buildQuestion(entry, pool, type, usedIds, rnd) {
    const q = {
      wordId: entry.id,
      type: type,
      word: entry.word,
      phonetic: entry.phonetic,
      pos: entry.pos,
      meaningCn: entry.meaningCn,
      meaningEn: entry.meaningEn,
      example: entry.example,
      exampleCn: entry.exampleCn,
      options: null,
      maskedExample: null,
      hint: null,
      correctAnswer: '',
      approx: false
    };

    if (type === 'Q1' || type === 'Q2' || type === 'Q4') {
      const options = buildOptions(entry, pool, type, usedIds, rnd);
      if (!options) return null;
      q.options = options;
      const ci = options.findIndex(function (o) { return o.correct; });
      q.correctAnswer = ['A', 'B', 'C', 'D'][ci] || 'A';
      q.correctText = options[ci] ? options[ci].text : '';
    } else if (type === 'Q3') {
      q.correctAnswer = entry.word;
      q.hint = entry.word.charAt(0) + ' ' + '_'.repeat(Math.max(1, entry.word.length - 1));
    } else if (type === 'Q5') {
      const cnt = countWordInExample(entry.example, entry.word);
      if (cnt !== 1) return null; // 例句不含词或含多次 → 该词不能出 Q5
      q.maskedExample = maskWord(entry.example, entry.word);
      q.correctAnswer = entry.word;
      q.hint = entry.word.charAt(0) + ' ' + '_'.repeat(Math.max(1, entry.word.length - 1));
    }
    return q;
  }

  /** 题型基础 XP（唯一出口在 balance.js） */
  function baseXpFor(type) {
    const def = WQ.questionTypes[type];
    const key = def ? def.xpBaseKey : 'baseQ1';
    return Number(B.xp[key]) || 0;
  }

  WQ.qe = {
    toEntry: toEntry,
    indexWords: indexWords,
    pickQuestionTypes: pickQuestionTypes,
    typeDistribution: typeDistribution,
    buildOptions: buildOptions,
    checkSpelling: checkSpelling,
    maskWord: maskWord,
    countWordInExample: countWordInExample,
    buildQuestion: buildQuestion,
    baseXpFor: baseXpFor
  };
})(window.WQ = window.WQ || {});
