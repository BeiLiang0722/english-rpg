/* src/ui/pages/battle.js
 * 唯一职责：#/battle/:roundId 对局页渲染与交互（docs/03 §4.2）。
 * 依赖：WQ.shell、WQ.state、WQ.flow、WQ.router、WQ.audio、WQ.overlay、WQ.anim、WQ.util
 * 被依赖：src/main.js（路由注册）
 *
 * 交互要点：判定后锁定选项（judged 锁）、立即落库、血量归零 → 红闪 200ms → 跳结算。
 */
(function (WQ) {
  'use strict';

  const U = WQ.util;
  const B = WQ.balance;

  let questionShownAt = Date.now();
  /* v0.2：上一帧的血量，用于给「刚掉的那颗心」加 is-losing 动效；以及上一帧的 XP，用于得分弹动 */
  let prevHpLeft = null;
  let prevXp = 0;
  /* v0.2：本帧被侦查之眼排除的选项下标（键盘忽略它） */
  let excludeIdx = -1;
  /* v0.2：当前正在渲染的 roundId，用于在新的一局开始时重置动效基准 */
  let currentRoundId = null;

  function session() { return WQ.state.session; }

  /** 血量心形（v0.2：刚失去的那颗心加 .is-losing，触发心碎动效 A08） */
  function heartsHtml(hpLeft, hpMax, justLostIndex) {
    const out = [];
    for (let i = 0; i < hpMax; i++) {
      const cls = ['heart'];
      if (i < hpLeft) cls.push('is-full');
      if (i === justLostIndex) cls.push('is-losing');
      out.push('<span class="' + cls.join(' ') + '">♥</span>');
    }
    return '<span class="hearts" role="img" aria-label="剩余 ' + hpLeft + ' 颗心，共 ' + hpMax + ' 颗">' + out.join('') + '</span>';
  }

  /** 连击徽标（3–4 蓝 / 5–7 紫 / ≥8 金；刚命中档位时加 is-burst 播放冲击波动效 A09/A10） */
  function comboHtml(combo, res) {
    if (Number(combo) < 3) return '';
    const tier = combo >= 8 ? 3 : (combo >= 5 ? 2 : 1);
    const burst = !!(res && res.comboTiersHit && res.comboTiersHit.length);
    return '<span class="combo-badge tier-' + tier + (burst ? ' is-burst' : '') + '">×' + U.esc(combo) + '</span>';
  }

  /** 题目卡（按题型给不同题面） */
  function questionCard(q, res, settings) {
    const typeDef = WQ.questionTypes[q.type];
    const rows = [];
    rows.push('<div class="question-card">');
    rows.push('  <span class="chip">' + U.esc(typeDef.label) + '</span>');

    if (q.type === 'Q1') {
      rows.push('  <p class="question-word"><span lang="en">' + U.esc(q.word) + '</span></p>');
      rows.push('  <p class="question-meta mono">/<span lang="en">' + U.esc(q.phonetic) + '</span>/ · ' + U.esc(q.pos || '') + '</p>');
    } else if (q.type === 'Q2') {
      rows.push('  <p class="question-word is-cn">' + U.esc(q.meaningCn) + '</p>');
      rows.push('  <p class="question-meta">选出对应的英文单词</p>');
    } else if (q.type === 'Q4') {
      rows.push('  <p class="question-meta">听发音，选出正确的单词</p>');
      rows.push('  <div class="question-tools">',
        '<button class="speak-btn speak-btn-lg" type="button" data-action="speak">🔊 播放发音</button>',
        '</div>');
    } else if (q.type === 'Q3') {
      rows.push('  <p class="question-word is-cn">' + U.esc(q.meaningCn) + '</p>');
      rows.push('  <p class="spell-hint">' + U.esc(q.hint) + '</p>');
    } else if (q.type === 'Q5') {
      rows.push('  <p class="question-word is-cn"><span lang="en">' + U.esc(q.maskedExample) + '</span></p>');
      rows.push('  <p class="question-meta">' + U.esc(q.meaningCn) + ' · ' + U.esc(q.hint) + '</p>');
    }

    if (q.type !== 'Q4') {
      rows.push('  <div class="question-tools">',
        '<button class="speak-btn" type="button" data-action="speak">🔊 发音</button>',
        '</div>');
    }

    /* 例句折叠区（Q5 已在题面给了挖空例句，不再重复展示完整句） */
    if (q.type !== 'Q5') {
      rows.push('  <div class="example-toggle"><button class="btn btn-sm btn-ghost" type="button" data-action="toggleExample">' +
        (WQ.state.ui.exampleOpen ? '收起例句' : '查看例句') + '</button></div>');
      if (WQ.state.ui.exampleOpen) {
        rows.push('  <div class="example-box"><span lang="en">' + U.esc(q.example) + '</span><br>' + U.esc(q.exampleCn) + '</div>');
      }
    }
    rows.push('</div>');
    return rows.join('');
  }

  /** 选项区（选择题） */
  function optionsHtml(q, res) {
    const letters = ['A', 'B', 'C', 'D'];
    const revealed = !!res;
    /* v0.2 侦查之眼：开局排除 1 个错误选项（每题 1 次，共 3 次），被排除项置灰且不可点 */
    const excluded = revealed ? -1 : WQ.questionPool.scoutExcludeIndex(q, WQ.state.session);
    const list = (q.options || []).map(function (opt, i) {
      const cls = ['option'];
      let mark = '';
      if (i === excluded) {
        cls.push('is-excluded');
        mark = '🚫';
      } else if (revealed) {
        if (opt.correct) { cls.push('is-correct'); mark = '✓'; }
        else if (String(res.answerIndex) === String(i)) { cls.push('is-wrong'); mark = '✗'; }
        else cls.push('is-dim');
      }
      const label = opt.text;
      const disabled = revealed || i === excluded;
      return '<button class="' + cls.join(' ') + '" type="button" role="radio" aria-checked="' + (revealed && opt.correct ? 'true' : 'false') + '"' +
        (disabled ? ' disabled' : '') +
        (i === excluded ? ' aria-label="已被侦查之眼排除"' : '') +
        ' data-action="answer" data-id="' + i + '">' +
        '<span class="option-badge">' + letters[i] + '</span>' +
        '<span class="option-text"' + (q.type === 'Q2' || q.type === 'Q4' ? ' lang="en"' : '') + '>' + U.esc(label) + '</span>' +
        (mark ? '<span class="option-mark">' + mark + '</span>' : '') +
        '</button>';
    });
    const hint = excluded >= 0
      ? '<p class="overlay-text scout-hint" role="status">👁️ 侦查之眼已排除 1 个错误选项（本局剩余 ' + Math.max(0, Number(WQ.state.session.scoutEyeRemaining) || 0) + ' 次）</p>'
      : '';
    return '<div class="options" role="radiogroup" aria-label="选项">' + list.join('') + '</div>' + hint;
  }

  /** 拼写输入区 */
  function spellHtml(q, res) {
    const disabled = res ? ' disabled' : '';
    return [
      '<div class="options">',
      '  <div class="spell-row">',
      '    <input class="spell-input" type="text" inputmode="latin" autocomplete="off" autocapitalize="off" spellcheck="false"',
      '           data-spell-input aria-label="拼写答案" placeholder="输入英文单词"' + disabled + '>',
      '  </div>',
      '  <p class="spell-hint">首字母与长度提示：' + U.esc(q.hint) + '</p>',
      '  <button class="btn btn-primary btn-block" type="button" data-action="submitSpell"' + (res ? ' disabled' : '') + '>提交答案</button>',
      '</div>'
    ].join('');
  }

  /** 反馈条 */
  function feedbackHtml(q, res) {
    if (!res) return '';
    const isCorrect = !!res.correct;
    const head = isCorrect
      ? '✓ ' + (res.skipped ? '已跳过' : '答对了') + (res.xpGained ? '　+' + res.xpGained + ' XP' : '')
      : '✗ 答错' + (res.skipped ? '' : '　正确答案 ' + res.correctAnswer);
    const body = [];
    if (res.approximate) body.push('≈ 近似拼写，记为未掌握');
    if (!isCorrect && WQ.state.settings.showAnswerOnWrong) {
      /* v0.2（修验收报告 D16）：Q1 的 correctText 就是 meaningCn，直接打印两遍会重复 */
      const answerText = (q.type === 'Q1')
        ? U.esc(res.correctText || res.meaningCn || q.meaningCn)
        : U.esc(q.word) + '　' + U.esc(q.meaningCn);
      body.push('正确答案：' + answerText);
    }
    if (isCorrect) body.push(U.esc(q.meaningCn));
    if (res.comboTiersHit && res.comboTiersHit.length) {
      body.push('🔥 连击 ×' + res.combo + '　+' + res.comboTiersHit.reduce(function (a, t) { return a + B.xp.combo[t]; }, 0) + ' XP');
    }
    if (res.revived) body.push('🎭 替身稻草人替你挡了一下');
    if (!isCorrect && !res.skipped) body.push('剩余 ' + res.hpLeft + ' 颗心');
    return [
      '<div class="feedback ' + (isCorrect ? 'is-correct' : 'is-wrong') + '" role="status">',
      '  <div class="feedback-head' + (isCorrect && res.xpGained ? ' is-bump' : '') + '">' + head + '</div>',
      body.length ? '  <div class="feedback-body">' + body.join('<br>') + '</div>' : '',
      '</div>'
    ].join('');
  }

  /** 底部操作区：未作答=跳过；已作答=下一题 / 看结算；答错且未用过重试=重试本题 */
  function footHtml(s, res) {
    if (!res) {
      return [
        '<div class="battle-foot"><div class="battle-foot-inner">',
        '  <button class="btn btn-ghost" type="button" data-action="skip">跳过（不得 XP，不扣心）</button>',
        '</div></div>'
      ].join('');
    }
    const last = s.index >= s.totalQuestions - 1;
    const canRetry = !s.retryUsed && !res.correct && !res.skipped;
    return [
      '<div class="battle-foot"><div class="battle-foot-inner">',
      canRetry ? '  <button class="btn btn-ghost" type="button" data-action="retry">重试本题（1 次，不扣心）</button>' : '',
      '  <button class="btn btn-primary" type="button" data-action="next">' + (last ? '看结算 →' : '下一题 →') + '</button>',
      '</div></div>'
    ].join('');
  }

  /** 整页渲染 */
  function render() {
    const s = session();
    if (!s) { WQ.router.go('#/home'); return; }
    const q = WQ.flow.currentQuestion();
    if (!q) { WQ.router.go('#/home'); return; }
    const res = s.judged ? s.lastResult : null;
    if (!res) questionShownAt = Date.now();

    /* v0.2 动效：算「刚掉的那颗心」与「本帧是否有得分」 */
    /* 开局（从营地/结算跳进来后本页首次渲染）时清掉上一局的动效基准 */
    if (currentRoundId !== s.roundId) {
      currentRoundId = s.roundId;
      prevHpLeft = null;
      prevXp = 0;
    }
    const lostIndex = (prevHpLeft != null && s.hpLeft < prevHpLeft) ? s.hpLeft : -1;
    prevHpLeft = s.hpLeft;
    const xpBump = s.xpGained > prevXp;
    prevXp = s.xpGained;
    excludeIdx = res ? -1 : WQ.questionPool.scoutExcludeIndex(q, s);

    WQ.shell.setActions(actions);
    const pct = s.totalQuestions ? (s.index / s.totalQuestions) : 0;
    WQ.shell.render([
      '<div class="battle-page">',
      '  <div class="battle-top">',
      '    <button class="icon-btn" type="button" data-action="exit" aria-label="退出本局">✕</button>',
      '    <span class="spacer"></span>',
      '    <span class="battle-index">第 ' + (s.index + 1) + ' / ' + s.totalQuestions + ' 题</span>',
      '    ' + comboHtml(s.combo, res),
      '    <span class="spacer"></span>',
      '    ' + heartsHtml(s.hpLeft, s.hpMax, lostIndex),
      '  </div>',
      '  <div class="battle-progress-wrap">',
      '    <div class="progress is-thin' + (xpBump ? ' is-gain' : '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="' + s.totalQuestions + '" aria-valuenow="' + s.index + '" aria-label="本局进度">',
      '      <i data-progress-init="' + pct + '" style="transform:scaleX(' + pct + ')"></i>',
      '    </div>',
      '  </div>',
      '  <div class="battle-body">',
      questionCard(q, res, WQ.state.settings),
      (q.type === 'Q1' || q.type === 'Q2' || q.type === 'Q4') ? optionsHtml(q, res) : spellHtml(q, res),
      feedbackHtml(q, res),
      '  </div>',
      footHtml(s, res),
      '</div>'
    ].join(''), { noAnim: !!res });

    /* 自动发音 */
    if (!res && WQ.state.settings.autoSpeak && q.type !== 'Q3' && q.type !== 'Q5') speak(q);
  }

  function speak(q) {
    const question = q || WQ.flow.currentQuestion();
    if (!question) return;
    WQ.audio.speak(question.word);
  }

  /** 提交选择题答案 */
  function answerChoice(index) {
    const s = session();
    if (!s || s.judged) return;
    /* 被侦查之眼排除的选项不可作答（按钮已 disabled，这里再挡一次键盘路径） */
    if (Number(index) === excludeIdx) { WQ.toast.show('该选项已被侦查之眼排除'); return; }
    const q = WQ.flow.currentQuestion();
    const isReclaimRound = s.source === 'wrongBook';
    const res = WQ.flow.answerCurrent({ answer: String(index), ms: Date.now() - questionShownAt });
    if (!res) return;
    res.answerIndex = Number(index);
    if (res.correct) {
      WQ.audio.sfxCorrect();
      if (isReclaimRound && WQ.audio.sfxReclaim && !res.skipped) WQ.audio.sfxReclaim();
    } else WQ.audio.sfxWrong();
    if (res.comboTiersHit && res.comboTiersHit.length) WQ.audio.sfxCombo();
    render();
    if (res.isDefeat && !res.revived) return failOut();
  }

  /** 提交拼写答案 */
  function submitSpell() {
    const s = session();
    if (!s || s.judged) return;
    const input = document.querySelector('[data-spell-input]');
    const value = input ? String(input.value || '').trim() : '';
    if (!value) { WQ.toast.show('先输入答案再提交'); return; }
    const res = WQ.flow.answerCurrent({ answer: value, ms: Date.now() - questionShownAt });
    if (!res) return;
    res.answerIndex = -1;
    if (res.correct) WQ.audio.sfxCorrect(); else WQ.audio.sfxWrong();
    render();
    if (res.isDefeat && !res.revived) return failOut();
  }

  /** 血量归零：红闪 200ms×2 → 结算 */
  function failOut() {
    WQ.anim.redFlash(function () {
      WQ.flow.finishSession(new Date());
      WQ.router.go('#/result/last');
    });
  }

  const actions = {
    answer: function (el, id) { answerChoice(id); },
    submitSpell: function () { submitSpell(); },
    skip: function () {
      const s = session();
      if (!s || s.judged) return;
      WQ.flow.answerCurrent({ skip: true, ms: Date.now() - questionShownAt });
      render();
    },
    retry: function () {
      if (WQ.flow.retryCurrent()) {
        prevHpLeft = null;   /* 重试不播心碎动效 */
        WQ.toast.show('重试本题，不扣心');
        render();
      }
    },
    next: function () {
      const s = session();
      if (!s) return;
      if (s.index >= s.totalQuestions - 1) {
        WQ.flow.finishSession(new Date());
        WQ.router.go('#/result/last');
        return;
      }
      WQ.flow.nextQuestion();
      render();
    },
    speak: function () { speak(null); },
    toggleExample: function () {
      WQ.state.ui.exampleOpen = !WQ.state.ui.exampleOpen;
      render();
    },
    exit: function () {
      WQ.overlay.confirm({
        title: '退出本局？',
        text: '已获得的 XP 与金币会保留，本局不再继续。',
        okText: '退出',
        cancelText: '继续战斗',
        onOk: function () {
          WQ.flow.abortSession(false);
          WQ.router.go('#/home');
        }
      });
    },
    /* 键盘：1–4 选项、Enter 提交/下一题、Space 发音、Esc 退出 */
    '__keydown': function (evt) {
      const s = session();
      if (!s) return;
      if (WQ.overlay.isOpen()) return;
      const q = WQ.flow.currentQuestion();
      if (!q) return;
      const tag = (evt.target && evt.target.tagName) || '';
      if (tag === 'INPUT') {
        if (evt.key === 'Enter') { evt.preventDefault(); if (!s.judged) submitSpell(); else actions.next(); }
        return;
      }
      if (evt.key === 'Escape') { evt.preventDefault(); actions.exit(); return; }
      if (evt.key === ' ') { evt.preventDefault(); speak(q); return; }
      if (evt.key === 'Enter') {
        evt.preventDefault();
        if (s.judged) actions.next();
        return;
      }
      if (/^[1-4]$/.test(evt.key)) {
        if (s.judged) return;
        const idx = Number(evt.key) - 1;
        if (idx === excludeIdx) { evt.preventDefault(); WQ.toast.show('该选项已被侦查之眼排除'); return; }
        if ((q.options || [])[idx]) { evt.preventDefault(); answerChoice(idx); }
      }
    }
  };

  WQ.pages = WQ.pages || {};
  WQ.pages.battle = { render: render, actions: actions };
})(window.WQ = window.WQ || {});
