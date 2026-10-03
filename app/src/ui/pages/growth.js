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
    /* v0.2（修验收报告 D8）：徽章卡改成可点按钮 → 详情弹层；Esc / 点遮罩关闭 + 焦点归还由 overlay 负责 */
    const cards = progress.map(function (a, i) {
      return [
        '<button class="stat badge-card" type="button" style="text-align:left" data-action="badge" data-id="' + U.esc(a.def.id) + '" aria-label="' + U.esc(a.def.name + '：' + a.def.desc) + '">',
        '  <span class="badge-card-icon" aria-hidden="true">' + (a.unlocked ? a.def.icon : '🔒') + '</span>',
        '  <span class="badge-card-name">' + U.esc(a.def.name) + '</span>',
        '  <span class="stat-label">' + U.esc(a.def.desc) + '</span>',
        '  <span class="chip ' + (a.unlocked ? 'chip-gold' : 'chip-muted') + '">' + (a.unlocked ? '已解锁 ' + U.esc((a.unlockedAt || '').slice(0, 10)) : U.esc(a.text)) + '</span>',
        '</button>'
      ].join('');
    }).join('');

    /* v0.2（D8 第 2 项）：下一称号预览 */
    const nextTitle = maxLevel
      ? '已是最高称号'
      : 'Lv.' + (p.level + 1) + ' · ' + WQ.level.titleFor(p.level + 1) + '（还差 ' + U.esc(WQ.state.xpToNext == null ? 0 : WQ.state.xpToNext) + ' XP）';

    return [
      '<section class="card">',
      '  <h2 class="card-title"><span>等级</span><span>Lv.' + U.esc(p.level) + ' · ' + U.esc(WQ.level.titleFor(p.level)) + '</span></h2>',
      '  <div class="progress"><i data-progress-init="' + ratio + '" style="transform:scaleX(' + ratio + ')"></i></div>',
      '  <p class="overlay-text">' + (maxLevel ? '巅峰值 ' + U.esc(p.totalXp) + ' XP（已满级）' : U.esc(p.xp) + '/' + U.esc(need) + ' XP · 还差 ' + U.esc(WQ.state.xpToNext) + ' XP 升到 Lv.' + (p.level + 1)) + '</p>',
      '  <div class="title-preview reward-row"><span>下一称号</span><span class="val">' + nextTitle + '</span></div>',
      '  <details class="disclosure" style="margin-top:10px">',
      '    <summary>等级阶梯 1–' + B.level.max + '（点击展开）</summary>',
      ladder.join(''),
      '  </details>',
      '</section>',
      '<section class="card">',
      '  <h2 class="card-title"><span>徽章墙</span><span>已解锁 ' + unlockedCount + '/' + progress.length + '</span></h2>',
      '  <div class="home-today-grid" style="grid-template-columns:1fr 1fr">' + cards + '</div>',
      '  <p class="empty-note">点任意徽章查看完整条件与进度</p>',
      '</section>'
    ].join('');
  }

  /* ---------------- Tab 2：错题本 ---------------- */
  /** 行数据（含 v0.2 重练冷却状态）；progress[id] 可能为 null，必须判空（D20） */
  function wrongRows(save, now) {
    const byId = WQ.qe.indexWords(WQ.WORDS);
    const nowDate = now || new Date();
    return Object.keys(save.progress)
      .map(function (id) {
        const p = save.progress[id];
        return p ? Object.assign({ id: id }, p) : null;
      })
      .filter(function (p) { return !!p && Number(p.wrongCount) > 0; })
      .sort(function (a, b) {
        return (Number(b.wrongCount) - Number(a.wrongCount)) ||
          String(b.lastWrongAt || '').localeCompare(String(a.lastWrongAt || ''));
      })
      .map(function (p) {
        const entry = byId[p.id] || { word: p.id, phonetic: '', meaningCn: '' };
        const mastered = WQ.srs.isMastered(p);
        const st = WQ.save.reclaimState(p, nowDate);
        /* v0.2 错题本重练：冷却到了给「重练这个」按钮，否则显示还差几天 */
        const badge = st.can
          ? '<span class="reclaim-badge chip chip-success">可重练</span>'
          : '<span class="reclaim-badge chip chip-muted">' + Math.max(0, WQ.util.dayDiff(WQ.util.todayKey(nowDate), st.dueAt) || 0) + ' 天后可重练</span>';
        return [
          '<div class="wrong-item">',
          '  <span class="wrong-item-main">' + (mastered ? '✓ ' : '') + '<span class="w" lang="en">' + U.esc(entry.word) + '</span> ',
          '    <span class="m mono">/' + U.esc(entry.phonetic) + '/</span> ',
          '    <span class="m">' + U.esc(entry.meaningCn) + '</span>',
          '    <span class="m">错 ' + U.esc(p.wrongCount) + ' 次' + (p.lastWrongAt ? ' · ' + U.esc(String(p.lastWrongAt).slice(0, 10)) : '') + '</span>',
          '    ' + badge,
          '  </span>',
          '  <span class="wrong-item-actions">',
          '    <button class="btn btn-sm btn-primary" type="button" data-action="reclaimOne" data-id="' + U.esc(p.id) + '"' + (st.can ? '' : ' disabled') + '>重练</button>',
          '    <button class="btn btn-sm btn-ghost" type="button" data-action="removeWrong" data-id="' + U.esc(p.id) + '" aria-label="把 ' + U.esc(entry.word) + ' 移出错题本">移出</button>',
          '  </span>',
          '</div>'
        ].join('');
      });
  }

  function wrongTab(save) {
    const rows = wrongRows(save);
    const count = rows.length;
    const ready = WQ.pages.home ? WQ.pages.home.reclaimReadyCount(save) : count;
    if (!count) {
      return [
        '<section class="card">',
        '  <h2 class="card-title">错题本</h2>',
        '  <div class="empty-state">',
        '    <div class="empty-state-icon" aria-hidden="true">📕</div>',
        '    <p class="empty-state-title">错题本是空的</p>',
        '    <p class="empty-state-note">打一局吧，答错的词会自动进来等你复活</p>',
        '    <button class="btn btn-primary btn-block" type="button" data-action="startNormal">打一局</button>',
        '  </div>',
        '</section>'
      ].join('');
    }
    return [
      '<section class="card">',
      '  <h2 class="card-title"><span>共 ' + count + ' 个待复活词</span><span>今天可重练 ' + ready + ' 词</span></h2>',
      '  <button class="btn btn-primary btn-block" type="button" data-action="wrongBook">只打错词（' + Math.min(B.round.questionCount, count) + ' 题）</button>',
      ready > 0 ? '<button class="btn btn-ghost btn-block" style="margin-top:8px" type="button" data-action="reclaimOne">重练「已到冷却」的词（' + Math.min(B.round.questionCount, ready) + ' 题）</button>' : '',
      '  <p class="overlay-text">错得越多冷却越短：错 1 次 1 天后可重练、错 4 次 4 天后，最多 7 天。</p>',
      '  <div style="margin-top:10px">' + rows.join('') + '</div>',
      '</section>'
    ].join('');
  }

  /* ---------------- Tab 3：数据统计 ---------------- */
  /* 时间范围是模块内状态（不动路由、不动 currentTab）。两个按钮走统一的 data-action 委托，
     对应的 actions 条目在本文件末尾的 actions 表里：statsRange。 */
  let statsRange = 7;

  /** 切换「近 N 天」窗口（只认 7 / 30），改完重渲染当前页 */
  function setStatsRange(n) {
    const v = Number(n) === 30 ? 30 : 7;
    if (v === statsRange) return;
    statsRange = v;
    render();
  }

  /** 近 N 天窗口 + 汇总：一次扫描 daily；没有记录的日期保持 has=false（不补零） */
  function statsWindow(st, n) {
    const daily = (st && st.daily) || {};
    const today = U.todayKey();
    const days = [];
    let maxQuestions = 0, questions = 0, correct = 0, rounds = 0, studyMs = 0, activeDays = 0;
    for (let i = n - 1; i >= 0; i--) {
      const key = U.addDays(today, -i);
      const rec = (key && daily[key]) || null;
      const q = rec ? Math.max(0, Math.round(Number(rec.questions) || 0)) : 0;
      const c = rec ? Math.max(0, Math.min(q, Math.round(Number(rec.correct) || 0))) : 0;
      if (q > 0) {
        questions += q;
        correct += c;
        rounds += Math.max(0, Math.round(Number(rec.rounds) || 0));
        studyMs += Math.max(0, Math.round(Number(rec.studyMs) || 0));
        activeDays++;
        if (q > maxQuestions) maxQuestions = q;
      }
      days.push({ key: key, has: q > 0, q: q, c: c });
    }
    return {
      n: n, days: days, maxQuestions: maxQuestions, questions: questions,
      correct: correct, rounds: rounds, studyMs: studyMs, activeDays: activeDays
    };
  }

  /** 正确率文案：没有题量时给 '--'，不给 0% */
  function statsAccText(correct, questions) {
    return questions > 0 ? Math.round((correct / questions) * 100) + '%' : '--';
  }

  /**
   * 近 N 天双编码曲线：
   *   柱 = 当天答题数（按窗口最大值缩放，0 题为 is-empty 空槽，不补零）
   *   线 = 当天正确率（断档按"连续有数据的区段"分段，不插值、不按 0 连）
   */
  function statsChartHtml(w) {
    const cols = w.days.map(function (day) {
      const h = day.has && w.maxQuestions ? Math.max(2, Math.round((day.q / w.maxQuestions) * 100)) : 0;
      const acc = day.has ? Math.round((day.c / day.q) * 100) : null;
      const label = day.key ? String(day.key).slice(5) : '--';
      const title = day.has
        ? label + '：' + day.c + '/' + day.q + ' · 正确率 ' + acc + '%'
        : label + '：没有答题记录';
      return [
        '<div class="chart-col" title="' + U.esc(title) + '">',
        '  <div class="chart-bar' + (day.has ? '' : ' is-empty') + '">' +
          (day.has ? '<i class="chart-bar-fill" style="height:' + h + '%"></i>' : '') + '</div>',
        '  <span class="chart-x">' + U.esc(label) + '</span>',
        '  <span class="chart-y">' + (day.has ? U.esc(day.c + '/' + day.q) : '--') + '</span>',
        '</div>'
      ].join('');
    }).join('');

    /* 折线点：x 取每天列的中心，y 取正确率（100 - acc*100），断档直接断线 */
    const runs = [];
    let run = [];
    w.days.forEach(function (day, i) {
      if (day.has) {
        run.push({ x: ((i + 0.5) / w.n) * 100, y: (1 - day.c / day.q) * 100 });
      } else if (run.length) {
        runs.push(run);
        run = [];
      }
    });
    if (run.length) runs.push(run);

    const xy = function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); };
    const lines = runs.filter(function (r) { return r.length > 1; }).map(function (r) {
      return '<polyline points="' + r.map(xy).join(' ') + '" vector-effect="non-scaling-stroke"></polyline>';
    }).join('');
    const dots = runs.reduce(function (out, r) { return out.concat(r); }, []).map(function (p) {
      return '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="2" fill="currentColor" vector-effect="non-scaling-stroke"></circle>';
    }).join('');
    const chartAria = w.questions > 0
      ? '近 ' + w.n + ' 天：共 ' + w.questions + ' 题，正确率 ' + statsAccText(w.correct, w.questions)
      : '近 ' + w.n + ' 天：暂无答题记录';

    return [
      '<figure style="margin:0">',
      '  <div class="chart-bars" role="img" aria-label="' + U.esc(chartAria) + '">',
      cols,
      '    <svg class="chart-accuracy" viewBox="0 0 100 100" preserveAspectRatio="none" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">',
      lines,
      dots,
      '    </svg>',
      '  </div>',
      '  <div class="chart-legend">',
      '    <span class="chart-legend-item"><i class="legend-dot" aria-hidden="true"></i>柱=答题数</span>',
      '    <span class="chart-legend-item"><i class="legend-dot is-line" aria-hidden="true"></i>线=正确率</span>',
      '  </div>',
      '  <figcaption class="overlay-text">空槽表示当天没有答题记录（不补零）。</figcaption>',
      '</figure>'
    ].join('\n');
  }

  /** 各词库进度：一次遍历 WQ.WORDS 分档；百分比一律按运行时词库长度算（不写死 200） */
  function statsDeckHtml(save) {
    const deck = WQ.WORDS || [];
    const total = deck.length;
    const progress = save.progress || {};
    let mastered = 0, learning = 0, unseen = 0, revived = 0;
    for (let i = 0; i < total; i++) {
      const p = progress[deck[i].id];
      if (!p || !p.seenCount) unseen++;
      else if (WQ.srs.isMastered(p)) mastered++;
      else learning++;
    }
    Object.keys(progress).forEach(function (id) {
      const p = progress[id];
      if (p && Number(p.wrongCount) > 0) revived++;
    });
    const pct = function (n) { return total > 0 ? Math.round((n / total) * 1000) / 10 : 0; };
    const overall = pct(mastered);
    const rows = [
      { name: '已掌握', n: mastered },
      { name: '学习中', n: learning },
      { name: '未接触', n: unseen },
      { name: '待复活（错题）', n: revived }
    ].map(function (r) {
      return [
        '<div class="deck-row">',
        '  <span class="deck-name">' + U.esc(r.name) + '</span>',
        '  <div class="deck-bar"><i class="deck-bar-fill" style="width:' + pct(r.n) + '%"></i></div>',
        '  <span class="deck-count">' + U.esc(r.n) + '/' + U.esc(total) + '</span>',
        '</div>'
      ].join('');
    }).join('');

    return [
      '<div class="deck-progress">',
      '  <p class="overlay-text">四六级高频 ' + U.esc(total) + ' 词 · 已掌握 ' + U.esc(mastered) + ' (' + overall + '%)</p>',
      '  <div class="deck-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + overall + '" aria-label="词库掌握进度">',
      '    <i class="deck-bar-fill" style="width:' + overall + '%"></i>',
      '  </div>',
      rows,
      '</div>'
    ].join('\n');
  }

  function statsTab(save) {
    const st = save.stats || {};
    if (!st.totalRounds) {
      return [
        '<section class="card">',
        '  <div class="empty-state">',
        '    <div class="empty-state-icon" aria-hidden="true">📊</div>',
        '    <h2 class="empty-state-title">还没有统计数据</h2>',
        '    <p class="empty-state-note">打一局就能看到数据了</p>',
        '    <button class="btn btn-primary btn-block" type="button" data-action="startNormal">去营地开局</button>',
        '  </div>',
        '</section>'
      ].join('');
    }

    const profile = save.profile || {};
    const byId = WQ.qe.indexWords(WQ.WORDS);   /* 整个渲染只索引一次词库 */
    const w = statsWindow(st, statsRange);
    const totalQuestions = Math.max(0, Math.round(Number(st.totalQuestions) || 0));
    const totalCorrect = Math.max(0, Math.round(Number(st.totalCorrect) || 0));
    const totalRounds = Math.max(0, Math.round(Number(st.totalRounds) || 0));
    const totalStudyMs = Math.max(0, Number(st.totalStudyMs) || 0);
    const overallAcc = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : null;
    const windowAcc = w.questions > 0 ? Math.round((w.correct / w.questions) * 100) : null;
    const avgMs = totalRounds > 0 ? Math.round(totalStudyMs / totalRounds) : 0;
    const studyDays = Object.keys(st.daily || {}).length;

    const rangeBar = '<div class="stats-range" role="group" aria-label="统计时间范围">' +
      [7, 30].map(function (n) {
        const on = n === statsRange;
        return '<button class="btn btn-sm ' + (on ? 'btn-primary' : 'btn-ghost') + '" type="button" data-action="statsRange" data-id="' + n + '" aria-pressed="' + on + '">近 ' + n + ' 天</button>';
      }).join('') + '</div>';

    /* 题型表现：最差在最上；同正确率时题量多者在前，仍并列则按题型 id 稳定排序 */
    const byType = st.byType || {};
    const typeRows = Object.keys(byType).filter(function (t) {
      return byType[t] && Number(byType[t].questions) > 0;
    }).sort(function (a, b) {
      const qa = Number(byType[a].questions) || 0;
      const qb = Number(byType[b].questions) || 0;
      const ra = qa > 0 ? (Number(byType[a].correct) || 0) / qa : 0;
      const rb = qb > 0 ? (Number(byType[b].correct) || 0) / qb : 0;
      return (ra - rb) || (qb - qa) || String(a).localeCompare(String(b));
    }).map(function (t) {
      const item = byType[t];
      const q = Math.max(0, Math.round(Number(item.questions) || 0));
      const c = Math.max(0, Math.min(q, Math.round(Number(item.correct) || 0)));
      const label = (WQ.questionTypes && WQ.questionTypes[t]) ? WQ.questionTypes[t].label : t;
      return '<div class="breakdown-row"><span>' + U.esc(label) + '</span>' +
        '<span class="val">' + statsAccText(c, q) + ' · ' + U.esc(c) + '/' + U.esc(q) + '</span></div>';
    }).join('') || '<p class="empty-note">还没有题型数据</p>';

    const topWrong = Object.keys(save.progress || {})
      .map(function (id) { return Object.assign({ id: id }, save.progress[id]); })
      .filter(function (p) { return Number(p.wrongCount) > 0; })
      .sort(function (a, b) {
        return (Number(b.wrongCount) - Number(a.wrongCount)) ||
          String(b.lastWrongAt || '').localeCompare(String(a.lastWrongAt || ''));
      })
      .slice(0, 10)
      .map(function (p) {
        const e = byId[p.id] || { word: p.id, phonetic: '', meaningCn: '' };
        return [
          '<div class="breakdown-row">',
          '  <span><span class="w" lang="en">' + U.esc(e.word) + '</span> ',
          '    <span class="m mono">/' + U.esc(e.phonetic) + '/</span> ',
          '    <span class="m">' + U.esc(e.meaningCn) + '</span></span>',
          '  <span class="val">错 ' + U.esc(p.wrongCount) + ' 次</span>',
          '</div>'
        ].join('');
      }).join('') || '<p class="empty-note">暂无错词</p>';

    return [
      rangeBar,
      '<section class="card">',
      '  <h2 class="card-title">核心指标</h2>',
      '  <div class="stat-grid">',
      '    <div class="stat"><div class="stat-value">' + U.esc(totalQuestions) + '</div><div class="stat-label">总答题数</div></div>',
      '    <div class="stat"><div class="stat-value is-rate">' + (overallAcc === null ? '--' : overallAcc + '%') + '</div><div class="stat-label">总正确率</div></div>',
      '    <div class="stat"><div class="stat-value is-xp">' + U.esc(profile.totalXp) + '</div><div class="stat-label">累计 XP</div></div>',
      '  </div>',
      '  <div class="stat-grid" style="margin-top:10px">',
      '    <div class="stat"><div class="stat-value">' + U.esc(studyDays) + '</div><div class="stat-label">累计学习天数</div></div>',
      '    <div class="stat"><div class="stat-value">' + U.esc(totalRounds) + '</div><div class="stat-label">完成局数</div></div>',
      '    <div class="stat"><div class="stat-value">' + U.esc(U.formatDuration(totalStudyMs)) + '</div><div class="stat-label">累计时长（均 ' + U.esc(U.formatDuration(avgMs)) + '）</div></div>',
      '  </div>',
      '</section>',
      '<section class="card chart-card">',
      '  <h2 class="card-title"><span>近 ' + w.n + ' 天答题曲线</span><span>' + (w.questions > 0 ? '共 ' + U.esc(w.questions) + ' 题 · 正确率 ' + windowAcc + '%' : '暂无记录') + '</span></h2>',
      '  <div class="stat-grid">',
      '    <div class="mini-metric"><div class="mini-metric-value">' + U.esc(w.questions) + '</div><div class="mini-metric-label">近 ' + w.n + ' 天答题</div></div>',
      '    <div class="mini-metric"><div class="mini-metric-value">' + (windowAcc === null ? '--' : windowAcc + '%') + '</div><div class="mini-metric-label">近 ' + w.n + ' 天正确率</div></div>',
      '    <div class="mini-metric"><div class="mini-metric-value">' + U.esc(w.rounds) + '</div><div class="mini-metric-label">近 ' + w.n + ' 天局数</div></div>',
      '    <div class="mini-metric"><div class="mini-metric-value">' + U.esc(U.formatDuration(w.studyMs)) + '</div><div class="mini-metric-label">近 ' + w.n + ' 天时长</div></div>',
      '  </div>',
      statsChartHtml(w),
      '</section>',
      '<section class="card">',
      '  <h2 class="card-title"><span>各词库进度</span><span>共 ' + U.esc((WQ.WORDS || []).length) + ' 词</span></h2>',
      statsDeckHtml(save),
      '</section>',
      '<section class="card">',
      '  <h2 class="card-title">题型表现（最差在最上）</h2>',
      typeRows,
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
    /* 数据统计 Tab 的时间范围切换（statsRange / setStatsRange 在 Tab 3 区域内定义） */
    statsRange: function (el, id) { setStatsRange(id); },
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
    /* v0.2 错题本重练：单个词 / 只重练「冷却已到」的词 */
    reclaimOne: function (el, id) {
      const s = WQ.flow.createSession(id
        ? { source: 'wrongBook', wordIds: [id] }
        : { source: 'wrongBook', reclaimOnly: true });
      if (!s) {
        WQ.toast.show(id ? '这个词还打不了，先等冷却' : '还没有到冷却期的错词');
        return;
      }
      WQ.audio.sfxReclaim();
      WQ.router.go('#/battle/' + s.roundId);
    },
    /* v0.2（修验收报告 D7）：错题本「移出」→ 二次确认 → wrongCount=0 / lastWrongAt=null，
       保留 SRS 状态（wordProgress 的 correctCount / consecutiveCorrect / 间隔都不动） */
    removeWrong: function (el, id) {
      if (!id) return;
      const save = WQ.state.save;
      const p = save.progress && save.progress[id];
      if (!p) return;
      const byId = WQ.qe.indexWords(WQ.WORDS);
      const entry = byId[id] || { word: id, meaningCn: '' };
      WQ.overlay.confirm({
        title: '把 ' + entry.word + ' 移出错题本？',
        text: '它会从错题本消失，但已获得的掌握度与 SRS 复习进度都会保留。',
        okText: '移出',
        cancelText: '再想想',
        onOk: function () {
          p.wrongCount = 0;
          p.lastWrongAt = null;
          WQ.actions.commit();
          WQ.toast.show('已移出：' + entry.word);
          render();
        }
      });
    },
    /* v0.2（D8）：徽章详情弹层 */
    badge: function (el, id) {
      const all = WQ.ach.getAllProgress(WQ.state.save);
      const found = all.filter(function (x) { return x.def.id === id; })[0];
      if (found) WQ.overlay.badgeDetail(found);
    },
    speakWord: function (el, id) {
      const w = (WQ.WORDS || []).filter(function (x) { return x.id === id; })[0];
      if (w) WQ.audio.speak(w.word);
    }
  };

  WQ.pages = WQ.pages || {};
  WQ.pages.growth = { render: render, actions: actions };
})(window.WQ = window.WQ || {});
