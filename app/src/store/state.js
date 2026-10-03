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
      pendingToasts: [],
      interruptNotice: null
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
