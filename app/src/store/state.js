/* src/store/state.js
 * 唯一职责：单例 store（save / session / route / ui / settings）+ 派生量 + 唯一变更入口 commit()。
 * 依赖：WQ.persist、WQ.save、WQ.bus、WQ.level、WQ.srs、WQ.streak
 * 被依赖：src/ui/*、src/main.js、src/game/*（只读状态，不反向依赖 UI）
 *
 * 约定：任何对 save 的修改都必须经过 WQ.actions.commit()，以便统一写盘与重渲染。
 */
(function (WQ) {
  'use strict';

  const U = WQ.util;

  const state = {
    save: null,
    settings: null,
    session: null,
    route: '#/boot',
    persistStatus: 'ok',
    ui: {
      tab: 'level',
      loading: true,
      exampleOpen: false,
      multiTabNotice: false,
      /* v0.2（D3）：写盘前检测到别的标签页写过并且已经合并时置位，由当前页面消费成一次提示 */
      multiTabMerged: false,
      pendingToasts: [],
      interruptNotice: null,
      /* v0.2：一次中断恢复的摘要（刷新/崩溃后补结算），营地据此给出具体数字 */
      recoveredNotice: null,
      /* v0.2：跨天结算产生的待播报内容（每日任务/宝箱），由营地消费一次 */
      dailyNotice: null,
      /* v0.3：词库总览的分页与搜索状态（5800+ 词不能整册渲染，见 growth.js wordsTab） */
      deckQuery: '',
      deckShownMastered: 100,
      deckShownLearning: 100,
      deckShownUnseen: 100
    },
    /** 本次启动的闪现数据（升级队列、徽章、Toast），不持久化 */
    boot: {
      levelUps: [],
      unlockedBadges: [],
      startedAt: 0
    },
    /** 派生缓存：本局开始前的等级/XP，供结算页 XP 条动画使用 */
    roundBaseline: null,
    /** 派生缓存：本局结束后的结算结果 */
    lastResult: null
  };

  /** 挂到 WQ 上（persistStatus 需要被 persist.js 同步写入） */
  WQ.state = state;
  WQ.persistStatus = 'ok';

  /** 派生量：升级还差多少 XP（满级返回 null，docs/03 §6.12） */
  Object.defineProperty(state, 'xpToNext', {
    get: function () {
      const p = state.save && state.save.profile;
      if (!p) return null;
      if (p.level >= WQ.balance.level.max) return null;
      return Math.max(0, WQ.level.needXp(p.level) - p.xp);
    }
  });

  /** 派生量：已掌握词数（唯一实现走 srs.isMastered） */
  Object.defineProperty(state, 'masteredCount', {
    get: function () {
      const progress = state.save && state.save.progress;
      if (!progress) return 0;
      return Object.keys(progress).filter(function (id) {
        return WQ.srs.isMastered(progress[id]);
      }).length;
    }
  });

  /** 派生量：累计正确率 */
  Object.defineProperty(state, 'accuracy', {
    get: function () {
      const st = state.save && state.save.stats;
      if (!st || !st.totalQuestions) return 0;
      return st.totalCorrect / st.totalQuestions;
    }
  });

  /** 今日统计（无记录时返回零值对象，供营地卡片安全渲染） */
  Object.defineProperty(state, 'todayStats', {
    get: function () {
      const st = state.save && state.save.stats;
      const key = U.todayKey();
      const zero = { questions: 0, correct: 0, wrong: 0, xp: 0, coins: 0, rounds: 0, studyMs: 0 };
      if (!st || !st.daily || !st.daily[key]) return zero;
      return st.daily[key];
    }
  });

  /** 已解锁徽章数 */
  Object.defineProperty(state, 'unlockedBadgeCount', {
    get: function () {
      const a = state.save && state.save.achievements;
      if (!a) return 0;
      return Object.keys(a).filter(function (k) { return a[k] && a[k].unlocked; }).length;
    }
  });

  /** v0.2 派生量：今日任务视图 / 宝箱视图（save 未就绪时返回安全空值） */
  Object.defineProperty(state, 'quests', {
    get: function () {
      if (!state.save || !WQ.quest) return [];
      try { return WQ.quest.list(state.save); } catch (e) { return []; }
    }
  });

  Object.defineProperty(state, 'chestView', {
    get: function () {
      if (!state.save || !WQ.chest) return null;
      try { return WQ.chest.view(state.save, new Date()); } catch (e) { return null; }
    }
  });

  /**
   * 唯一变更入口：执行 fn(state) → 写盘 → 广播 change。
   * fn 内部直接改 state.save / state.session 即可（对象是引用）。
   */
  function commit(fn) {
    if (typeof fn === 'function') fn(state);
    const save = state.save;
    if (save) WQ.persist.saveNow(save);
    WQ.bus.emit('change', state);
    return state;
  }

  /** 只重渲染，不写盘（用于纯 UI 状态变化，例如展开例句） */
  function touch() {
    WQ.bus.emit('change', state);
    return state;
  }

  /** 设置变更：立即写设置键并生效（字体档位 / 动效降级由 UI 监听 change 应用） */
  function commitSettings(patch) {
    state.settings = Object.assign({}, state.settings, patch);
    WQ.persist.saveSettings(state.settings);
    WQ.bus.emit('settings', state.settings);
    WQ.bus.emit('change', state);
    return state.settings;
  }

  /** 读档（main.js 启动时调用一次） */
  function loadFromStore() {
    const res = WQ.persist.loadSave();
    state.save = res.save;
    state.settings = WQ.persist.loadSettings();
    state.persistStatus = WQ.persistStatus;
    return res;
  }

  WQ.state = state;
  WQ.actions = {
    commit: commit,
    touch: touch,
    commitSettings: commitSettings,
    loadFromStore: loadFromStore
  };
})(window.WQ = window.WQ || {});
