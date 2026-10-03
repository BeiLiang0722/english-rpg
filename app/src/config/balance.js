/* src/config/balance.js
 * 唯一职责：docs/03-PRD §5 的全部游戏数值（本文件是数值的唯一出口，业务代码里不得出现魔法数字）。
 * 依赖：无。
 * 被依赖：src/game/*.js、src/ui/pages/*.js、src/store/state.js
 *
 * 每个键都标注了 FR 来源章节，便于核对。
 */
(function (WQ) {
  'use strict';

  WQ.balance = {
    /* ---- §5.1 XP 奖惩 ---- */
    xp: {
      baseQ1: 10,           // 答对 Q1（英译中）
      baseQ2: 10,           // 答对 Q2（中译英）
      baseQ4: 12,           // 答对 Q4（听音）
      baseQ3: 15,           // 答对 Q3（拼写）
      baseQ5: 15,           // 答对 Q5（例句填空）
      firstSeenCorrect: 5,  // 新词首次答对（作答前 seenCount === 0）
      defeatNewWord: 5,     // 击败新词（correctCount 0 → 1）
      dailyFirstXp: 20,     // 每日首局
      perfect: 30,          // 完美局
      combo: { 3: 5, 5: 10, 8: 20 } // §5.4 连击档位（档位制，每档每局一次）
    },

    /* ---- §5.3 金币奖惩 ---- */
    coins: {
      perCorrect: 2,
      roundEnd: 10,         // 一局结束（无论胜负）
      dailyFirst: 15,
      perfect: 20,
      levelUp: 30
    },

    /* ---- §5.6 血量与重试 ---- */
    hp: {
      max: 3,
      retryPerRound: 1,     // 每局 1 次免费重试
      wrongCost: 1
    },

    /* ---- §5.2 等级曲线与称号 ---- */
    level: {
      max: 20,
      needXpBase: 60,       // needXp(level) = 60 + 10 * level
      needXpStep: 10,
      titles: [
        '', '新兵', '拾荒者', '见习猎手', '猎人', '熟练猎人',
        '追踪者', '陷阱师', '老练猎手', '词汇匠', '猎人领袖',
        '语感大师', '词根学者', '破译者', '词域行者', '词域领主',
        '词域之主', '传奇猎人', '大猎手', '词海征服者', '单词猎手（满级）'
      ]
    },

    /* ---- §5.8 出题优先级 ---- */
    priority: {
      wrongRevive: 100,     // 错词复活（lastWrongAt > 6 小时前）
      srsDue: 80,           // SRS 到期
      brandNew: 60,         // 新词
      consolidate: 20,      // 巩固
      wrongCooldownMs: 6 * 60 * 60 * 1000
    },

    /* ---- §5.8 SRS 间隔表（天） ---- */
    srsIntervals: [1, 3, 7, 16, 35],

    /* ---- §7.4 局面常量 ---- */
    round: {
      questionCount: 8,     // 每局题数
      minPerfectQuestions: 6 // 缩减局的完美局门槛
    },

    /* ---- §5.5 商店 4 件 ---- */
    shop: {
      heartGuard: {
        id: 'heartGuard',
        name: '护心符',
        price: 60,
        icon: '🛡️',
        desc: '下一局血量上限 +1（3 → 4），局结束后失效',
        limit: 2,
        limitPeriod: 'daily'
      },
      repairCard: {
        id: 'repairCard',
        name: '回补卡',
        price: 40,
        icon: '🧵',
        desc: '修复 1 天漏签，连击续接',
        limit: 2,
        limitPeriod: 'monthly'
      },
      scoutEye: {
        id: 'scoutEye',
        name: '侦查之眼',
        price: 30,
        icon: '👁️',
        desc: '下一局开局排除 1 个错误选项，共 3 次',
        limit: 1,
        limitPeriod: 'daily'
      },
      strawDouble: {
        id: 'strawDouble',
        name: '替身稻草人',
        price: 80,
        icon: '🎭',
        desc: '下一局首次血量归零时以 1 颗心复活继续',
        limit: 1,
        limitPeriod: 'daily'
      }
    },
    shopOrder: ['heartGuard', 'repairCard', 'scoutEye', 'strawDouble'],
    scoutEyeExcludes: 3,    // 侦查之眼一局排除次数

    /* ---- §4.7 streak 保护额度 ---- */
    streak: {
      freezeCardsPerMonth: 2,   // 月初重置的冰冻卡数
      monthlyProtectedMax: 4,   // 冰冻 + 回补合计最多保住 4 天
      repairPerMonth: 2
    },

    /* ---- §6.2 存档版本 ---- */
    saveVersion: 1,

    /* ---- §7.3 记录裁剪 ---- */
    maxRounds: 500,
    maxLogEntries: 2000
  };
})(window.WQ = window.WQ || {});
