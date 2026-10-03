/* src/config/questions.js
 * 唯一职责：docs/03-PRD §4.4 的 5 种题型定义、权重、判定方式与题干模板。
 * 依赖：无（纯常量 + 纯函数模板）。
 * 被依赖：src/game/questionEngine.js、src/ui/pages/battle.js
 */
(function (WQ) {
  'use strict';

  /* 权重合计 1.00；Q4 不可用时按比例分摊到其余 4 种（见 questionEngine.pickQuestionTypes） */
  WQ.questionTypes = {
    Q1: {
      id: 'Q1',
      label: '英译中',
      weight: 0.40,
      kind: 'choice',
      xpBaseKey: 'baseQ1',
      desc: '看英文单词，选中文释义'
    },
    Q2: {
      id: 'Q2',
      label: '中译英',
      weight: 0.25,
      kind: 'choice',
      xpBaseKey: 'baseQ2',
      desc: '看中文释义，选英文单词'
    },
    Q3: {
      id: 'Q3',
      label: '拼写填空',
      weight: 0.20,
      kind: 'spell',
      xpBaseKey: 'baseQ3',
      desc: '按中文释义与首字母拼出单词'
    },
    Q4: {
      id: 'Q4',
      label: '听音辨词',
      weight: 0.10,
      kind: 'choice',
      xpBaseKey: 'baseQ4',
      needsTts: true,
      desc: '听发音，选正确单词'
    },
    Q5: {
      id: 'Q5',
      label: '例句填空',
      weight: 0.05,
      kind: 'spell',
      xpBaseKey: 'baseQ5',
      desc: '按挖空例句与首字母拼出单词'
    }
  };

  WQ.questionTypeOrder = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'];

  /* 干扰项硬规则：Q1 比较中文释义首字，其余比较单词首字母。此函数绝不放宽。 */
  WQ.optionKeyOf = function (type, entry) {
    if (type === 'Q1') return String(entry.meaningCn || '').trim().charAt(0);
    return String(entry.word || '').trim().charAt(0).toLowerCase();
  };

  /* 题干模板（供 UI 层直接取用，避免文案散落） */
  WQ.prompts = {
    Q1: function (q) { return q.word; },
    Q2: function (q) { return q.meaningCn; },
    Q3: function (q) { return q.meaningCn; },
    Q4: function () { return ''; },
    Q5: function (q) { return q.maskedExample; }
  };
})(window.WQ = window.WQ || {});
