/* src/ui/pages/growth.js
 * 唯一职责：#/growth 成长页（4 个 Tab：等级与徽章 / 错题本 / 数据统计 / 词库）。
 * 依赖：WQ.shell、WQ.state、WQ.router、WQ.ach、WQ.level、WQ.flow、WQ.util
 * 被依赖：src/main.js（路由注册）
 * Tab 状态写入 #/growth?tab=xxx，刷新后停留原 Tab。
 */
(function (WQ) {
  'use strict';

  const U = WQ.util;
  const B = WQ.balance;
  const TABS = [
    { id: 'level', name: '等级与徽章' },
    { id: 'wrong', name: '错题本' },
    { id: 'stats', name: '数据统计' },
    { id: 'words', name: '词库' }
  ];

  function currentTab() {
    const q = WQ.router.parse(location.hash).query;
    const t = q.tab;
    return TABS.filter(function (x) { return x.id === t; })[0] ? t : 'level';
  }

  function tabsHtml(tab) {
    return '<div class="seg" role="tablist" aria-label="成长页标签" style="display:flex;width:100%;overflow:auto">' +
      TABS.map(function (t) {
        return '<button type="button" role="tab" aria-selected="' + (t.id === tab) + '" aria-pressed="' + (t.id === tab) + '" data-action="tab" data-id="' + t.id + '">' + U.esc(t.name) + '</button>';
      }).join('') + '</div>';
  }

  /* ---------------- Tab 1：等级与徽章 ---------------- */
  function levelTab(save) {
    const p = save.profile;
    const maxLevel = WQ.level.isMaxLevel(p.level);
    const need = maxLevel ? 0 : WQ.level.needXp(p.level);
    const ratio = maxLevel ? 1 : (need ? Math.min(1, p.xp / need) : 0);
    const ladder = [];
    for (let l = 1; l <= B.level.max; l++) {
      const reached = p.level >= l;
      const cur = p.level === l;
      ladder.push('<div class="breakdown-row' + (cur ? ' is-total' : '') + '">' +
        '<span>' + (reached ? '✓ ' : '　') + 'Lv.' + l + ' · ' + U.esc(WQ.level.titleFor(l)) + '</span>' +
        '<span class="val">' + (l === B.level.max ? '累计 ' + WQ.level.cumulativeXpForLevel(l) : '需 ' + WQ.level.needXp(l) + ' · 累计 ' + WQ.level.cumulativeXpForLevel(l)) + '</span>' +
        '</div>');
    }
    const progress = WQ.ach.getAllProgress(save);
    const unlockedCount = progress.filter(function (x) { return x.unlocked; }).length;
    const cards = progress.map(function (a) {
      return [
        '<div class="stat" style="text-align:left" title="' + U.esc(a.def.desc) + '">',
        '  <div style="font-size:22px">' + (a.unlocked ? a.def.icon : '🔒') + '</div>',
        '  <div style="font-weight:700;font-size:14px;margin-top:4px">' + U.esc(a.def.name) + '</div>',
        '  <div class="stat-label">' + U.esc(a.def.desc) + '</div>',
        '  <div class="chip ' + (a.unlocked ? 'chip-gold' : 'chip-muted') + '" style="margin-top:6px">' + (a.unlocked ? '已解锁 ' + U.esc((a.unlockedAt || '').slice(0, 10)) : U.esc(a.text)) + '</div>',
        '</div>'
      ].join('');
    }).join('');

    return [
      '<section class="card">',
      '  <h2 class="card-title"><span>等级</span><span>Lv.' + U.esc(p.level) + ' · ' + U.esc(WQ.level.titleFor(p.level)) + '</span></h2>',
      '  <div class="progress"><i data-progress-init="' + ratio + '" style="transform:scaleX(' + ratio + ')"></i></div>',
      '  <p class="overlay-text">' + (maxLevel ? '巅峰值 ' + U.esc(p.totalXp) + ' XP（已满级）' : U.esc(p.xp) + '/' + U.esc(need) + ' XP · 还差 ' + U.esc(WQ.state.xpToNext) + ' XP 升到 Lv.' + (p.level + 1)) + '</p>',
      '  <details class="disclosure" style="margin-top:10px">',
      '    <summary>等级阶梯 1–' + B.level.max + '（点击展开）</summary>',
      ladder.join(''),
      '  </details>',
      '</section>',
      '<section class="card">',
      '  <h2 class="card-title"><span>徽章墙</span><span>已解锁 ' + unlockedCount + '/' + progress.length + '</span></h2>',
      '  <div class="home-today-grid" style="grid-template-columns:1fr 1fr">' + cards + '</div>',
      '</section>'
    ].join('');
  }

  /* ---------------- Tab 2：错题本 ---------------- */
  function wrongRows(save) {
    const byId = WQ.qe.indexWords(WQ.WORDS);
    return Object.keys(save.progress)
      .map(function (id) { return Object.assign({ id: id }, save.progress[id]); })
      .filter(function (p) { return Number(p.wrongCount) > 0; })
      .sort(function (a, b) {
        return (Number(b.wrongCount) - Number(a.wrongCount)) ||
          String(b.lastWrongAt || '').localeCompare(String(a.lastWrongAt || ''));
      })
      .map(function (p) {
        const entry = byId[p.id] || { word: p.id, phonetic: '', meaningCn: '' };
        const mastered = WQ.srs.isMastered(p);
        return [
          '<div class="wrong-item">',
          '  <span>' + (mastered ? '✓ ' : '') + '<span class="w" lang="en">' + U.esc(entry.word) + '</span> ',
          '    <span class="m mono">/' + U.esc(entry.phonetic) + '/</span> ',
          '    <span class="m">' + U.esc(entry.meaningCn) + '</span></span>',
          '  <span class="m">错 ' + U.esc(p.wrongCount) + ' 次' + (p.lastWrongAt ? ' · ' + U.esc(String(p.lastWrongAt).slice(0, 10)) : '') + '</span>',
          '</div>'
        ].join('');
      });
  }

  function wrongTab(save) {
    const rows = wrongRows(save);
    const count = rows.length;
    if (!count) {
      return [
        '<section class="card">',
        '  <h2 class="card-title">错题本</h2>',
        '  <p class="empty-note">还没有需要复活的词，打一局吧</p>',
        '  <button class="btn btn-primary btn-block" type="button" data-action="startNormal">打一局</button>',
        '</section>'
      ].join('');
    }
    return [
      '<section class="card">',
      '  <h2 class="card-title"><span>共 ' + count + ' 个待复活词</span><span>错词优先出现</span></h2>',
      '  <button class="btn btn-primary btn-block" type="button" data-action="wrongBook">只打错词（' + Math.min(B.round.questionCount, count) + ' 题）</button>',
      '  <div style="margin-top:10px">' + rows.join('') + '</div>',
      '</section>'
    ].join('');
  }

  /* ---------------- Tab 3：数据统计 ---------------- */
  function statsTab(save) {
    const st = save.stats;
    if (!st.totalRounds) {
      return [
        '<section class="card">',
        '  <h2 class="card-title">数据统计</h2>',
        '  <p class="empty-note">打一局就能看到数据了</p>',
        '  <button class="btn btn-primary btn-block" type="button" data-action="startNormal">去营地开局</button>',
        '</section>'
      ].join('');
    }
    const acc = st.totalQuestions ? Math.round((st.totalCorrect / st.totalQuestions) * 100) : 0;
    const days = Object.keys(st.daily || {}).length;
    const avgMs = st.totalRounds ? Math.round(st.totalStudyMs / st.totalRounds) : 0;
    const byType = Object.keys(st.byType || {}).filter(function (t) { return st.byType[t].questions > 0; })
      .sort(function (a, b) {
        const ra = st.byType[a].correct / st.byType[a].questions;
        const rb = st.byType[b].correct / st.byType[b].questions;
        return ra - rb; // 最差在最上
      })
      .map(function (t) {
        const item = st.byType[t];
        const r = item.questions ? item.correct / item.questions : 0;
        return '<div class="breakdown-row"><span>' + U.esc(WQ.questionTypes[t] ? WQ.questionTypes[t].label : t) + '</span>' +
          '<span class="val">' + Math.round(r * 100) + '% · ' + item.correct + '/' + item.questions + '</span></div>';
      }).join('');
    const topWrong = Object.keys(save.progress)
      .map(function (id) { return Object.assign({ id: id }, save.progress[id]); })
      .filter(function (p) { return Number(p.wrongCount) > 0; })
      .sort(function (a, b) { return Number(b.wrongCount) - Number(a.wrongCount); })
      .slice(0, 10)
      .map(function (p) {
        const e = WQ.qe.indexWords(WQ.WORDS)[p.id] || { word: p.id };
        return '<div class="breakdown-row"><span lang="en">' + U.esc(e.word) + '</span><span class="val">错 ' + U.esc(p.wrongCount) + ' 次</span></div>';
      }).join('') || '<p class="empty-note">暂无错词</p>';

    /* 近 7 天趋势（无数据日期留空槽，不补零） */
    const bars = [];
    for (let i = 6; i >= 0; i--) {
      const key = U.addDays(U.todayKey(), -i);
      const d = st.daily[key];
      const h = d && d.questions ? Math.max(6, Math.round((d.correct / d.questions) * 64)) : 0;
      bars.push('<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">' +
        '<div style="height:64px;display:flex;align-items:flex-end;width:100%">' +
        (h ? '<div style="height:' + h + 'px;width:100%;background:var(--grad-xp);border-radius:4px"></div>' : '') +
        '</div>' +
        '<span class="stat-label">' + U.esc(key.slice(5)) + '</span>' +
        '<span class="stat-label">' + (d && d.questions ? U.esc(d.correct) + '/' + U.esc(d.questions) : '--') + '</span>' +
        '</div>');
    }

    return [
      '<section class="card">',
      '  <h2 class="card-title">核心指标</h2>',
      '  <div class="stat-grid">',
      '    <div class="stat"><div class="stat-value">' + U.esc(st.totalQuestions) + '</div><div class="stat-label">总答题数</div></div>',
      '    <div class="stat"><div class="stat-value is-rate">' + acc + '%</div><div class="stat-label">总正确率</div></div>',
      '    <div class="stat"><div class="stat-value is-xp">' + U.esc(save.profile.totalXp) + '</div><div class="stat-label">累计 XP</div></div>',
      '  </div>',
      '  <div class="stat-grid" style="margin-top:10px">',
      '    <div class="stat"><div class="stat-value">' + U.esc(days) + '</div><div class="stat-label">累计学习天数</div></div>',
      '    <div class="stat"><div class="stat-value">' + U.esc(st.totalRounds) + '</div><div class="stat-label">完成局数</div></div>',
      '    <div class="stat"><div class="stat-value">' + U.esc(U.formatDuration(st.totalStudyMs)) + '</div><div class="stat-label">累计时长（均 ' + U.esc(U.formatDuration(avgMs)) + '）</div></div>',
      '  </div>',
      '</section>',
      '<section class="card">',
      '  <h2 class="card-title">近 7 天正确率</h2>',
      '  <figure style="margin:0">',
      '    <div style="display:flex;gap:6px;align-items:flex-end">' + bars.join('') + '</div>',
      '    <figcaption class="overlay-text">空槽表示当天没有答题记录（不按 0 计算）。</figcaption>',
      '  </figure>',
      '</section>',
      '<section class="card">',
      '  <h2 class="card-title">题型表现（最差在最上）</h2>',
      byType || '<p class="empty-note">还没有题型数据</p>',
      '</section>',
      '<section class="card">',
      '  <h2 class="card-title">错词榜 Top 10</h2>',
      topWrong,
      '</section>'
    ].join('');
  }

  /* ---------------- Tab 4：词库总览（只读） ---------------- */
  function wordsTab(save) {
    const groups = { mastered: [], learning: [], unseen: [] };
    (WQ.WORDS || []).forEach(function (w) {
      const p = save.progress[w.id];
      if (!p || !p.seenCount) groups.unseen.push(w);
      else if (WQ.srs.isMastered(p)) groups.mastered.push(w);
      else groups.learning.push(w);
    });
    function block(title, list) {
      return [
        '<h3 style="margin:10px 0 4px">' + U.esc(title) + '（' + list.length + '）</h3>',
        list.length ? list.map(function (w) {
          return '<div class="wrong-item"><span><span class="w" lang="en">' + U.esc(w.word) + '</span> <span class="m mono">/' + U.esc(w.phonetic) + '/</span> <span class="m">' + U.esc(w.meaning_cn) + '</span></span>' +
            '<button class="btn btn-sm btn-ghost" type="button" data-action="speakWord" data-id="' + U.esc(w.id) + '" aria-label="朗读 ' + U.esc(w.word) + '">🔊</button></div>';
        }).join('') : '<p class="empty-note">（空）</p>'
      ].join('');
    }
    const total = groups.mastered.length + groups.learning.length + groups.unseen.length;
    return [
      '<section class="card">',
      '  <h2 class="card-title"><span>词库总览</span><span>共 ' + total + ' 词</span></h2>',
      block('已掌握', groups.mastered),
      block('学习中', groups.learning),
      block('未接触', groups.unseen),
      '</section>'
    ].join('');
  }

  function render() {
    const save = WQ.state.save;
    const tab = currentTab();
    WQ.shell.setActions(actions);
    const body = tab === 'wrong' ? wrongTab(save)
      : tab === 'stats' ? statsTab(save)
        : tab === 'words' ? wordsTab(save)
          : levelTab(save);
    WQ.shell.render([
      '<main class="page" id="main">',
      '  <h1>成长</h1>',
      '  <div style="height:12px"></div>',
      tabsHtml(tab),
      '<div style="height:12px"></div>',
      body,
      '  <button class="btn btn-ghost btn-block" style="margin-top:12px" type="button" data-action="home">返回营地</button>',
      '</main>'
    ].join(''));
  }

  const actions = {
    tab: function (el, id) { WQ.router.go('#/growth?tab=' + id); },
    home: function () { WQ.router.go('#/home'); },
    startNormal: function () {
      const s = WQ.flow.createSession({ source: 'normal' });
      if (!s) { WQ.toast.show('词库不可用'); return; }
      WQ.router.go('#/battle/' + s.roundId);
    },
    wrongBook: function () {
      const s = WQ.flow.createSession({ source: 'wrongBook' });
      if (!s) { WQ.toast.show('错词池为空'); return; }
      WQ.router.go('#/battle/' + s.roundId);
    },
    speakWord: function (el, id) {
      const w = (WQ.WORDS || []).filter(function (x) { return x.id === id; })[0];
      if (w) WQ.audio.speak(w.word);
    }
  };

  WQ.pages = WQ.pages || {};
  WQ.pages.growth = { render: render, actions: actions };
})(window.WQ = window.WQ || {});
