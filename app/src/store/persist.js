/* src/store/persist.js
 * 唯一职责：localStorage 读写（全项目唯一允许触碰 localStorage 的文件）。
 * 依赖：WQ.save、WQ.log、WQ.bus、WQ.balance
 * 被依赖：src/store/state.js、src/main.js
 *
 * 键（docs/03 §6.1）：
 *   wordquest.save.v1      主存档
 *   wordquest.save.v1.bak  损坏原文备份（覆盖式，只留最近一份）
 *   wordquest.settings.v1  设置
 *   wordquest.session.v1   对局会话（崩溃恢复提示用）
 *   wordquest.log.v1       事件日志（见 log.js）
 */
(function (WQ) {
  'use strict';

  const B = WQ.balance;

  const K_SAVE = 'wordquest.save.v1';
  const K_BAK = 'wordquest.save.v1.bak';
  const K_SET = 'wordquest.settings.v1';
  const K_SESSION = 'wordquest.session.v1';

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
   * 读主存档：JSON 解析失败时把原文写进 .bak 并返回默认档（不抛异常）。
   * @returns {{save: object, restored: boolean, repaired: boolean}}
   */
  function loadSave(now) {
    const raw = readKey(K_SAVE);
    if (raw == null) {
      setStatus('ok');
      return { save: WQ.save.fillDefaults(WQ.save.defaultSave(now)), restored: false, repaired: false };
    }
    let parsed = null;
    let broken = false;
    try { parsed = JSON.parse(raw); } catch (e) { broken = true; }

    if (broken || !parsed || typeof parsed !== 'object') {
      try { writeKey(K_BAK, raw); } catch (e) { /* 备份失败不阻塞 */ }
      WQ.log.warn('旧存档读取失败，已备份到 ' + K_BAK);
      setStatus('ok');
      return { save: WQ.save.fillDefaults(WQ.save.defaultSave(now)), restored: true, repaired: false };
    }

    const before = JSON.stringify(parsed);
    const mig = WQ.save.migrate(parsed);
    const filled = WQ.save.fillDefaults(mig.save);
    const repaired = JSON.stringify(filled) !== before || mig.migrated;
    setStatus('ok');
    return { save: filled, restored: false, repaired: repaired };
  }

  /**
   * 写主存档。失败绝不抛给调用方，只把 persistStatus 置为 failed（docs/04 R4 对策⑦）。
   * 配额满时按 docs/07.3 裁剪 rounds 到最近 500 条后重试一次。
   * @returns {boolean} 是否写入成功
   */
  function saveNow(save) {
    if (!save) return false;
    let text;
    try { text = JSON.stringify(save); } catch (e) {
      WQ.log.persistError('序列化失败：' + e.message, 0);
      setStatus('failed', 'serialize');
      return false;
    }

    try {
      writeKey(K_SAVE, text);
      setStatus('ok');
      return true;
    } catch (e) {
      const quota = /quota|exceed|storage/i.test(String(e && e.name) + ' ' + String(e && e.message));
      if (quota && Array.isArray(save.rounds) && save.rounds.length > B.maxRounds) {
        save.rounds = save.rounds.slice(-B.maxRounds);
        try {
          const trimmed = JSON.stringify(save);
          writeKey(K_SAVE, trimmed);
          WQ.log.persistError('配额满，已裁剪历史记录后写入成功', trimmed.length);
          setStatus('ok');
          return true;
        } catch (e2) {
          WQ.log.persistError('裁剪后仍写入失败：' + e2.message, 0);
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
    catch (e) { WQ.log.persistError('设置写入失败：' + e.message, 0); setStatus('failed', 'settings'); return false; }
  }

  /** 会话写入（可选，仅用于崩溃恢复提示） */
  function saveSession(session) {
    try {
      if (!session) { const ls = storage(); if (ls) ls.removeItem(K_SESSION); return true; }
      writeKey(K_SESSION, JSON.stringify({ roundId: session.roundId, startedAt: session.startedAt }));
      return true;
    } catch (e) { return false; }
  }

  function loadSession() {
    const raw = readKey(K_SESSION);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
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
      return true;
    } catch (e) { return false; }
  }

  /** 多标签同步：只提示，不在答题中途打断 */
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
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    saveSession: saveSession,
    loadSession: loadSession,
    clearSession: clearSession,
    clearAll: clearAll,
    backupRaw: backupRaw,
    onStorage: onStorage
  };
})(window.WQ = window.WQ || {});
