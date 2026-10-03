/* src/core/audio.js
 * 唯一职责：WebAudio 合成音效 + speechSynthesis 发音封装。
 * 依赖：WQ.settings（通过 WQ.state.settings 读取开关；无则视为默认开启）
 * 被依赖：src/ui/pages/battle.js、src/ui/pages/result.js、src/core/router.js 无关
 * 硬约束：音频失败绝不影响游戏逻辑（全部 try/catch 吞掉）。
 */
(function (WQ) {
  'use strict';

  let ctx = null;
  let ttsWarned = false;

  function settings() {
    return (WQ.state && WQ.state.settings) || { sfxEnabled: true, autoSpeak: false };
  }

  /** 首次用户手势后才能创建/恢复 AudioContext（浏览器自动播放策略） */
  function ensureCtx() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }

  /**
   * 播放一个简单音符。
   * @param {number} freq 频率
   * @param {number} start 相对当前时间的延迟（秒）
   * @param {number} dur 时长（秒）
   * @param {string} type 波形
   * @param {number} gain 音量
   */
  function tone(freq, start, dur, type, gain) {
    const ac = ensureCtx();
    if (!ac) return;
    try {
      const t0 = ac.currentTime + start;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.14, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* 静默 */ }
  }

  function enabled() {
    const s = settings();
    return s.sfxEnabled !== false;
  }

  function sfxCorrect() {
    if (!enabled()) return;
    tone(660, 0, 0.12, 'triangle', 0.12);
    tone(880, 0.09, 0.16, 'triangle', 0.12);
  }

  function sfxWrong() {
    if (!enabled()) return;
    tone(330, 0, 0.16, 'sawtooth', 0.09);
    tone(220, 0.12, 0.22, 'sawtooth', 0.09);
  }

  function sfxLevelUp() {
    if (!enabled()) return;
    tone(523.25, 0, 0.18, 'triangle', 0.12);
    tone(659.25, 0.14, 0.18, 'triangle', 0.12);
    tone(783.99, 0.28, 0.32, 'triangle', 0.13);
  }

  function sfxCoin() {
    if (!enabled()) return;
    tone(1174.66, 0, 0.07, 'square', 0.06);
  }

  function sfxBadge() {
    if (!enabled()) return;
    tone(880, 0, 0.1, 'sine', 0.1);
    tone(1318.51, 0.08, 0.2, 'sine', 0.1);
  }

  /** 连击档位提示音（03 文档未定义，用两音上行，音量更低以免抢戏） */
  function sfxCombo() {
    if (!enabled()) return;
    tone(740, 0, 0.09, 'triangle', 0.1);
    tone(988, 0.07, 0.12, 'triangle', 0.1);
  }

  /** TTS 可用性探测 */
  function ttsAvailable() {
    try {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
      // 有些环境有对象但没有任何 voice：仍可用（部分浏览器按需加载）
      return typeof window.SpeechSynthesisUtterance === 'function';
    } catch (e) { return false; }
  }

  /** 朗读英文单词 */
  function speak(text, opts) {
    if (!text) return false;
    if (!ttsAvailable()) {
      if (!ttsWarned) {
        ttsWarned = true;
        if (WQ.log) WQ.log.warn('TTS 不可用，发音功能已跳过');
      }
      return false;
    }
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new window.SpeechSynthesisUtterance(String(text));
      u.lang = 'en-US';
      u.rate = 0.9;
      u.pitch = 1;
      if (opts && opts.onend) u.onend = opts.onend;
      synth.speak(u);
      return true;
    } catch (e) { return false; }
  }

  function cancelSpeak() {
    try { if (ttsAvailable()) window.speechSynthesis.cancel(); } catch (e) { /* 静默 */ }
  }

  WQ.audio = {
    ensureCtx: ensureCtx,
    sfxCorrect: sfxCorrect,
    sfxWrong: sfxWrong,
    sfxLevelUp: sfxLevelUp,
    sfxCoin: sfxCoin,
    sfxBadge: sfxBadge,
    sfxCombo: sfxCombo,
    ttsAvailable: ttsAvailable,
    speak: speak,
    cancelSpeak: cancelSpeak
  };
})(window.WQ = window.WQ || {});
