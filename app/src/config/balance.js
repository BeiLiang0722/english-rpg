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

    /* ---- v0.2 每日任务（docs/03 §5.9） ----
       常驻 2 条 + 轮换 1 条 = 每日 3 条，全部自动结算（不要求玩家点「领取」，避免打卡压力）。
       reward 合计 + 全清加成 = 65 金币 / 18 XP，跨天由 game/quest.js 的 settle() 幂等结算。 */
    daily: {
      questCount: 3,          // 常驻 2 + 轮换 1
      firstClearBonusCoins: 20,
      firstClearBonusXp: 10,
      quests: [
        { id: 'questLogin', kind: 'login', name: '今日登场', desc: '打开一次游戏', target: 1, xp: 5, coins: 5 },
        { id: 'questAnswer', kind: 'answer', name: '练手 8 题', desc: '今日累计作答 8 题', target: 8, xp: 8, coins: 15 },
        { id: 'questCorrect', kind: 'correct', name: '答对 6 题', desc: '今日累计答对 6 题', target: 6, xp: 8, coins: 15 },
        { id: 'questPerfect', kind: 'perfect', name: '一局全对', desc: '今日有 1 局全对', target: 1, xp: 10, coins: 15 },
        { id: 'questRound', kind: 'round', name: '拿下 2 局', desc: '今日完成 2 局', target: 2, xp: 8, coins: 15 },
        { id: 'questWrong', kind: 'wrong', name: '挫败 4 个错词', desc: '今日答错 4 题并记入错题本', target: 4, xp: 6, coins: 12 },
        { id: 'questCombo', kind: 'combo', name: '再连胜 5 次', desc: '今日一局内连对 5 题', target: 5, xp: 8, coins: 15 },
        { id: 'questDeck', kind: 'deck', name: '碰 6 个新词', desc: '今日遇到 6 个没见过的词', target: 6, xp: 8, coins: 15 }
      ],
      /* 常驻条目（每天必出）；其余条目按当日日期确定性轮换（同一天多次进出营地结果不变） */
      alwaysIds: ['questLogin', 'questAnswer']
    },

    /* ---- v0.2 随机宝箱（docs/03 §5.9） ----
       每 3 次连续答对得 1 枚碎片，每日上限 3 枚；3 枚开 1 箱。
       连续 7 天登录额外白得 1 箱（「每天都来」的直接收益）。
       概率按 60/32/8 落在普通/稀有/传说，金币 25–70、XP 10–35 —— 与 A8 的经济区间对齐。 */
    chest: {
      shardsRequired: 3,
      shardsPerDay: 3,
      correctStreakPerShard: 3,
      loginBonusDays: 7,
      luckyStreakPerBonus: 7,     // 每日连续答对达到 7 次，额外 +1 枚碎片（当日有效）
      luckyShardCap: 4,
      tiers: [
        { id: 1, name: '普通', weight: 60, coins: 25, xp: 10, icon: '📦' },
        { id: 2, name: '稀有', weight: 32, coins: 45, xp: 20, icon: '🎁' },
        { id: 3, name: '传说', weight: 8, coins: 70, xp: 35, icon: '🏆' }
      ]
    },

    /* ---- v0.2 错题本重练冷却（docs/03 §4.10） ----
       冷却随错误次数增长且封顶，实现「错得越多 → 越快能重练」。
       例：错 1 次 → 1 天；错 2 次 → 2 天；错 3 次 → 3 天；错 4 次 → 4 天；错 6 次 → 6 天。 */
    reclaim: {
      maxDays: 7,
      baseDays: 1
    },

    /* ---- §6.2 存档版本 ---- */
    saveVersion: 1,

    /* ---- §7.3 记录裁剪 ---- */
    maxRounds: 500,
    maxLogEntries: 2000,
    /* v0.2：已中断的对局也记 1 条 RoundRecord（保留收益），但只保留最近若干条，避免存档膨胀 */
    maxAbortedRounds: 50
  };
})(window.WQ = window.WQ || {});
