/* src/store/persist.js
 * 唯一职责：本项目唯一承载存档读写的文件（事件日志见 store/log.js）。
 * 依赖：WQ.save、WQ.log、WQ.bus、WQ.balance
 * 被依赖：src/store/state.js、src/main.js、src/game/flow.js
 *
 * 键（docs/03 §6.1）：
 *   wordquest.save.v1      主存档
 *   wordquest.save.v1.bak  损坏原文备份（覆盖式，只留最近一份）
 *   wordquest.settings.v1  设置
 *   wordquest.session.v1   对局会话（v0.2 起存**完整会话**，用于刷新/崩溃后补结算，修 D1）
 *   wordquest.log.v1       事件日志（见 log.js）
 *
 * v0.2 三处一致性改造（对应 docs/06-验收报告 §7 P0 清单）：
 *   D1  会话完整落盘 → 启动时补 applyRoundEnd，收益不再因刷新丢失（见 flow.recoverSession / main.js）
 *   D3  写盘前比对「存档指纹」→ 检测到别的标签页写过就先读盘合并再写，杜绝 lost update
 *   D6  version 高于当前代码 → 拒绝加载、原文存 .bak、并且**本会话完全不再写主存档键**
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;

  const K_SAVE = 'wordquest.save.v1';
  const K_BAK = 'wordquest.save.v1.bak';
  const K_SET = 'wordquest.settings.v1';
  const K_SESSION = 'wordquest.session.v1';

  /** 最近一次「本页确认过」的存档存储指纹；用于发现别的标签页的写入（D3） */
  let savedSignature = null;
  /** 高版本存档被拒绝后置位：本次会话不再写主存档键，避免把新版本数据降级覆盖（D6） */
  let locked = false;

  /* 隐私模式下 localStorage 可能直接抛异常，全部访问都包一层 */
  function storage() {
    try {
      const ls = window.localStorage;
      if (!ls) return null;
      const probe = '__wq_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    } catch (e) {
      return null;
    }
  }

  function setStatus(status, reason) {
    WQ.persistStatus = status;
    if (WQ.state) WQ.state.persistStatus = status;
    WQ.bus.emit('persist', { status: status, reason: reason || null });
  }

  function readKey(key) {
    const ls = storage();
    if (!ls) return null;
    try { return ls.getItem(key); } catch (e) { return null; }
  }

  function writeKey(key, text) {
    const ls = storage();
    if (!ls) throw new Error('localStorage 不可用');
    ls.setItem(key, text);
  }

  /**
   * 纯解码：把主存档原文解析成 {save, restored, repaired, rejected}。不写盘、不改状态。
   * @param {string} raw
   * @returns {{save:object, restored:boolean, repaired:boolean, rejected:boolean, sourceVersion:number}}
   */
  function decodeSaveText(raw) {
    if (raw == null) {
      return { save: WQ.save.fillDefaults(WQ.save.defaultSave()), restored: false, repaired: false, rejected: false, sourceVersion: B.saveVersion };
    }
    let parsed = null;
    let broken = false;
    try { parsed = JSON.parse(raw); } catch (e) { broken = true; }

    if (broken || !parsed || typeof parsed !== 'object') {
      try { writeKey(K_BAK, raw); } catch (e) { /* 备份失败不阻塞 */ }
      WQ.log.warn('旧存档读取失败，已备份到 ' + K_BAK);
      return { save: WQ.save.fillDefaults(WQ.save.defaultSave()), restored: true, repaired: false, rejected: false, sourceVersion: B.saveVersion };
    }

    const before = JSON.stringify(parsed);
    const mig = WQ.save.migrate(parsed);

    /* D6：高版本存档拒绝加载 —— 保留原文（另存一份 .bak 便于回滚），返回默认档，且不再回写主键 */
    if (mig.rejected) {
      try { writeKey(K_BAK, raw); } catch (e) { /* 备份失败不阻塞 */ }
      WQ.log.warn('存档来自更新版本（version=' + mig.sourceVersion + '），已拒绝加载并保留原文');
      return {
        save: WQ.save.fillDefaults(WQ.save.defaultSave()),
        restored: false,
        repaired: false,
        rejected: true,
        sourceVersion: mig.sourceVersion
      };
    }

    const filled = WQ.save.fillDefaults(mig.save);
    const repaired = JSON.stringify(filled) !== before || mig.migrated;
    return { save: filled, restored: false, repaired: repaired, rejected: false, sourceVersion: mig.sourceVersion };
  }

  /**
   * 读主存档：JSON 解析失败时把原文写进 .bak 并返回默认档（不抛异常）。
   * @returns {{save: object, restored: boolean, repaired: boolean, rejected: boolean}}
   */
  function loadSave(now) {
    const raw = readKey(K_SAVE);
    const res = decodeSaveText(raw);
    if (res.rejected) locked = true;
    savedSignature = storageFingerprint();
    setStatus('ok');
    return res;
  }

  /**
   * 存档存储指纹：用于「写盘前判断 localStorage 里的存档是否已被别的标签页改过」（D3）。
   * 刻意只取稀疏、单调递增的字段，并且**不依赖 fillDefaults** ——
   * 这样「读档时的指纹」与「落盘后的指纹」是同一个函数算出来的，可以直接比较：
   *   用户自己的 commit() 不变指纹；别的标签页写过则必然变指纹。
   * 若解析失败则退化为首 200 / 末 200 字符的内容指纹（损坏路径下也能检测到外部变化）。
   */
  function storageFingerprint() {
    const raw = readKey(K_SAVE);
    if (raw == null) return null;
    try {
      const s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return 'raw:' + String(raw).length;
      const p = s.profile || {};
      const st = s.stats || {};
      const ds = (s.daily && s.daily.todayDate) || '';
      return [
        s.version, p.level, p.xp, p.totalXp, p.coins,
        st.totalCorrect, st.totalRounds,
        (s.rounds && s.rounds.length) || 0,
        (s.rounds && s.rounds[s.rounds.length - 1] && s.rounds[s.rounds.length - 1].roundId) || '',
        ds
      ].join('|');
    } catch (e) {
      return 'raw:' + String(raw).slice(0, 200) + ':' + String(raw).slice(-200);
    }
  }

  /**
   * 写主存档。失败绝不抛给调用方，只把 persistStatus 置为 failed（docs/04 R4 对策⑦）。
   *
   * v0.2（D3）：写之前先看 localStorage 里的存储指纹是否与「本页上次确认过的指纹」一致；
   * 不一致说明别的标签页写过存档，于是先读盘 + mergeSave 合并，再写合并结果。
   * 这样任何一方的进度都不会被覆盖（合并规则见 WQ.save.mergeSave）。
   *
   * @param {object} save
   * @param {object} [opts] { skipPreflight: true } 走合并后的最终写入时用
   * @returns {boolean} 是否写入成功
   */
  function saveNow(save, opts) {
    if (!save) return false;
    if (locked) {
      /* 高版本存档被拒绝加载：不写主键，避免把新版本数据降级覆盖（D6） */
      setStatus('locked', 'newerVersion');
      return false;
    }

    /* ---- 写盘前的一致性预检（D3） ---- */
    if (!(opts && opts.skipPreflight)) {
      try {
        const sigNow = storageFingerprint();
        if (sigNow && savedSignature && sigNow !== savedSignature) {
          const rawNow = readKey(K_SAVE);
          const incoming = decodeSaveText(rawNow);
          if (!incoming.rejected) {
            WQ.save.mergeSave(save, incoming.save);
            WQ.log.warn('检测到其他标签页更新了存档，已合并后写入');
            if (WQ.state && WQ.state.ui) WQ.state.ui.multiTabMerged = true;
            WQ.bus.emit('storageExternal', { key: K_SAVE, merged: true });
            /* 合并结果立刻落盘，再返回 */
            return saveNow(save, { skipPreflight: true });
          }
        }
      } catch (e) {
        /* 预检本身绝不影响正常写入 */
      }
    }

    let text;
    try { text = JSON.stringify(save); } catch (e) {
      WQ.log.persistError('序列化失败：' + String(e && e.name) + ' ' + String(e && e.message), 0);
      setStatus('failed', 'serialize');
      return false;
    }

    try {
      writeKey(K_SAVE, text);
      savedSignature = storageFingerprint();
      setStatus('ok');
      return true;
    } catch (e) {
      const quota = /quota|exceed|storage/i.test(String(e && e.name) + ' ' + String(e && e.message));
      if (quota && Array.isArray(save.rounds) && save.rounds.length > B.maxRounds) {
        save.rounds = save.rounds.slice(-B.maxRounds);
        try {
          const trimmed = JSON.stringify(save);
          writeKey(K_SAVE, trimmed);
          savedSignature = storageFingerprint();
          WQ.log.persistError('配额满，已裁剪历史记录后写入成功', trimmed.length);
          setStatus('ok');
          return true;
        } catch (e2) {
          WQ.log.persistError('裁剪后仍写入失败：' + String(e2 && e2.name) + ' ' + String(e2 && e2.message), 0);
          setStatus('failed', 'quota');
          return false;
        }
      }
      WQ.log.persistError('写入失败：' + (e && e.message ? e.message : String(e)), text.length);
      setStatus('failed', quota ? 'quota' : 'unknown');
      return false;
    }
  }

  /** 读设置（逐字段补全默认值） */
  function loadSettings() {
    const def = WQ.save.defaultSettings();
    const raw = readKey(K_SET);
    if (!raw) return def;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return def; }
    if (!parsed || typeof parsed !== 'object') return def;
    return {
      autoSpeak: typeof parsed.autoSpeak === 'boolean' ? parsed.autoSpeak : def.autoSpeak,
      sfxEnabled: typeof parsed.sfxEnabled === 'boolean' ? parsed.sfxEnabled : def.sfxEnabled,
      reducedMotion: typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : def.reducedMotion,
      fontSize: ['md', 'lg', 'xl'].indexOf(parsed.fontSize) >= 0 ? parsed.fontSize : def.fontSize,
      showAnswerOnWrong: typeof parsed.showAnswerOnWrong === 'boolean' ? parsed.showAnswerOnWrong : def.showAnswerOnWrong
    };
  }

  function saveSettings(settings) {
    try { writeKey(K_SET, JSON.stringify(settings)); setStatus('ok'); return true; }
    catch (e) { WQ.log.persistError('设置写入失败：' + (e && e.message ? e.message : String(e)), 0); setStatus('failed', 'settings'); return false; }
  }

  /**
   * 会话快照写入（D1）。只有带 roundId 的对象才允许落盘，避免把垃圾写进存档键。
   * @returns {boolean} 是否写入成功
   */
  function saveSession(session) {
    try {
      const ls = storage();
      if (!session) { if (ls) ls.removeItem(K_SESSION); return true; }
      if (!ls) return false;
      ls.setItem(K_SESSION, JSON.stringify(session));
      return true;
    } catch (e) { return false; }
  }

  /** 读会话快照；结构不完整时返回 null（调用方走正常启动路径） */
  function loadSession() {
    const snap = readSessionRaw();
    if (!snap) return null;
    /* 结构不完整（例如旧版只写了 roundId/startedAt）：当作"看到过中断痕迹"，但不交给补结算 */
    if (!snap.roundId || !Array.isArray(snap.questions) || !snap.questions.length) return null;
    return snap;
  }

  /** 原始会话快照（不做结构校验）：用于「有中断痕迹就提示一句」的降级分支 */
  function readSessionRaw() {
    const raw = readKey(K_SESSION);
    if (!raw) return null;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  }

  function clearSession() {
    const ls = storage();
    try { if (ls) ls.removeItem(K_SESSION); } catch (e) { /* 静默 */ }
  }

  /** 清空全部数据（设置页危险操作） */
  function clearAll() {
    const ls = storage();
    if (!ls) return false;
    try {
      [K_SAVE, K_BAK, K_SET, K_SESSION].forEach(function (k) { ls.removeItem(k); });
      WQ.log.clear();
      savedSignature = null;
      locked = false;
      return true;
    } catch (e) { return false; }
  }

  /** 多标签同步：转发事件；真正的「读盘合并」发生在 saveNow 的写前预检（D3） */
  function onStorage(evt) {
    if (!evt || evt.key !== K_SAVE) return;
    WQ.bus.emit('storageExternal', { key: evt.key });
  }

  function backupRaw() { return readKey(K_BAK); }

  WQ.persist = {
    K_SAVE: K_SAVE,
    K_BAK: K_BAK,
    K_SET: K_SET,
    K_SESSION: K_SESSION,
    available: function () { return !!storage(); },
    loadSave: loadSave,
    saveNow: saveNow,
    decodeSaveText: decodeSaveText,
    isLocked: function () { return locked; },
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    saveSession: saveSession,
    loadSession: loadSession,
    readSessionRaw: readSessionRaw,
    clearSession: clearSession,
    clearAll: clearAll,
    backupRaw: backupRaw,
    onStorage: onStorage,
    /** 测试/自检用：读取与重置指纹基线 */
    currentSignature: function () { return savedSignature; },
    resetSignatureBaseline: function () { savedSignature = null; }
  };
})(window.WQ = window.WQ || {});
