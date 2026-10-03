/* src/ui/pages/result.js
 * 唯一职责：#/result/:roundId 结算页渲染与交互（docs/03 §4.8）。
 * 依赖：WQ.shell、WQ.state、WQ.router、WQ.flow、WQ.anim、WQ.overlay、WQ.util
 * 被依赖：src/main.js（路由注册）
 *
 * 幂等：结算写入在离开对局时已由 flow.finishSession 完成（roundId 幂等键），
 *       本页刷新后从 save.rounds 末条重建展示，绝不重复发奖。
 */
(function (WQ) {
  'use strict';

  const U = WQ.util;
  const B = WQ.balance;

  /** 取本局结算数据：优先内存结果，刷新后回落到最近一条 RoundRecord */
  function resolveResult(roundId) {
    if (WQ.state.lastResult && WQ.state.lastResult.roundRecord) {
      return WQ.state.lastResult;
    }
    const rounds = (WQ.state.save && WQ.state.save.rounds) || [];
    let rec = null;
    if (roundId && roundId !== 'last') rec = rounds.filter(function (r) { return r.roundId === roundId; })[0] || null;
    if (!rec) rec = rounds[rounds.length - 1] || null;
    if (!rec) return null;
    const prev = rounds[rounds.indexOf(rec) - 1] || null;
    return {
      applied: false,
      roundRecord: rec,
      levelUps: rec.levelUps || [],
      unlocked: (rec.unlockedAchievementIds || []).map(function (id) {
        const def = WQ.achievementById(id);
        return def ? { id: def.id, name: def.name, icon: def.icon, desc: def.desc, coinReward: def.coinReward } : { id: id, name: id, icon: '🏅', desc: '' };
      }),
      baseline: {
        level: Number(rec.levelBefore) || 1,
        xp: prev ? Math.max(0, WQ.level.cumulativeXpForLevel(Number(rec.levelBefore) || 1)) : 0
      }
    };
  }

  function breakdownHtml(rec) {
    const rows = (rec.breakdown || []).map(function (b) {
      const sign = b.unit === 'xp' ? ' XP' : ' 金币';
      return '<div class="breakdown-row"><span>' + U.esc(b.label) + '</span><span class="val">+' + U.esc(b.value) + sign + '</span></div>';
    });
    return rows.join('') || '<div class="empty-note">本局没有加分项</div>';
  }

  function wrongReviewHtml(rec) {
    const wrongs = (rec.log || []).filter(function (l) { return l && !l.correct; });
    if (!wrongs.length) return '';
    const byId = WQ.qe.indexWords(WQ.WORDS);
    const rows = wrongs.map(function (l) {
      const entry = byId[l.wordId] || { word: l.wordId, meaningCn: '' };
      const yours = l.skipped ? '跳过' : (l.answer || '—');
      return '<div class="wrong-item">' +
        '<span><span class="w" lang="en">' + U.esc(entry.word) + '</span> <span class="m">' + U.esc(entry.meaningCn) + '</span></span>' +
        '<span class="m">你选 ' + U.esc(yours) + ' / 正确 ' + U.esc(l.correctAnswer) + '</span>' +
        '</div>';
    });
    return [
      '<section class="card">',
      '  <details class="disclosure">',
      '    <summary>本局错题 (' + wrongs.length + ')</summary>',
      rows.join(''),
      '  </details>',
      '</section>'
    ].join('');
  }

  function badgesHtml(list) {
    if (!list || !list.length) return '';
    return [
      '<section class="card">',
      '  <h2 class="card-title">新解锁徽章</h2>',
      list.map(function (b) {
        return '<div class="wrong-item"><span><span style="font-size:20px">' + U.esc(b.icon || '🏅') + '</span> <strong>' + U.esc(b.name) + '</strong></span><span class="m">' + U.esc(b.desc || '') + '</span></div>';
      }).join(''),
      '</section>'
    ].join('');
  }

  function render() {
    const hash = WQ.router.parse(location.hash);
    const res = resolveResult(hash.parts[1]);
    if (!res || !res.roundRecord) {
      WQ.shell.setActions(actions);
      WQ.shell.render('<main class="page" id="main"><h1>还没有结算数据</h1><p class="empty-note">先打一局吧</p>' +
        '<button class="btn btn-primary btn-block" type="button" data-action="home">返回营地</button></main>');
      return;
    }

    const rec = res.roundRecord;
    const save = WQ.state.save;
    const total = rec.totalQuestions || 0;
    const acc = total ? rec.correct / total : 0;
    const isWin = !!rec.isWin;
    /* v0.2：顶部三列展示"本局总入账"。
       XP：对局本体 + 徽章 XP + 每日任务 XP（明细里就是这三类）。
       金币：直接由明细行汇总 —— 明细已经覆盖了徽章/升级/任务全部金币来源，
             这样「顶部合计 === 明细逐行相加 === profile.coins 实增」三个数永远一致，
             也不会因为以后再加一类奖励而忘记同步（v0.2 修掉过一次这类脏账）。 */
    const totalXp = (Number(rec.xpGained) || 0) + (Number(rec.bonusXp) || 0) + (Number(rec.questXp) || 0);
    const detailCoinSum = (rec.breakdown || [])
      .filter(function (b) { return b && b.unit === 'coin'; })
      .reduce(function (a, b) { return a + (Number(b.value) || 0); }, 0);
    const totalCoins = (Number(rec.coinsGained) || 0) + detailCoinSum;

    WQ.shell.setActions(actions);
    WQ.shell.render([
      '<main class="page" id="main">',
      '  <div class="result-hero">',
      '    <div class="result-shield' + (isWin ? '' : ' is-lose') + '" aria-hidden="true">' + (isWin ? (rec.isPerfect ? '🏆' : '🛡️') : '💔') + '</div>',
      '    <h1 class="result-title">' + (rec.aborted ? '本局已中断' : (isWin ? '本局完成！' : '再接再厉')) + '</h1>',
      '    <p class="result-sub">' + total + ' 题 · 用时 ' + U.esc(U.formatDuration(rec.durationMs)) + (rec.isPerfect ? ' · 无伤通关 ✨' : '') + (rec.aborted ? ' · 已获得收益全部保留' : '') + '</p>',
      '  </div>',
      '  <section class="card">',
      '    <div class="stat-grid">',
      '      <div class="stat"><div class="stat-value is-rate" data-roll="' + Math.round(acc * 100) + '" data-suffix="%">0%</div><div class="stat-label">正确率 ' + rec.correct + '/' + total + '</div></div>',
      '      <div class="stat"><div class="stat-value is-xp" data-roll="' + totalXp + '" data-prefix="+">+0</div><div class="stat-label">获得 XP</div></div>',
      '      <div class="stat"><div class="stat-value is-coin" data-roll="' + totalCoins + '" data-prefix="+">+0</div><div class="stat-label">金币</div></div>',
      '    </div>',
      '    <div class="stat-grid" style="margin-top:10px">',
      '      <div class="stat"><div class="stat-value">' + U.esc(rec.maxCombo || 0) + '</div><div class="stat-label">最高连击</div></div>',
      '      <div class="stat"><div class="stat-value">' + U.esc(rec.correct) + '</div><div class="stat-label">答对</div></div>',
      '      <div class="stat"><div class="stat-value">' + U.esc(rec.wrong) + '</div><div class="stat-label">答错</div></div>',
      '    </div>',
      '  </section>',
      '  <section class="card">',
      '    <h2 class="card-title"><span>' + (WQ.level.isMaxLevel(save.profile.level) ? '巅峰值' : 'XP 进度') + '</span><span class="progress-label">' +
        (WQ.level.isMaxLevel(save.profile.level) ? U.esc(U.formatNumber(save.profile.totalXp)) : U.esc(save.profile.xp) + '/' + U.esc(WQ.level.needXp(save.profile.level))) + '</span></h2>',
      '    <div class="progress" id="result-xpbar" role="progressbar" aria-label="经验值进度"><i></i></div>',
      '    <p class="overlay-text">Lv.' + U.esc(save.profile.level) + ' · ' + U.esc(WQ.level.titleFor(save.profile.level)) + '</p>',
      /* v0.2 修验收报告 D9（A7 第 5 个数字）：结算页补「距下一级还差 X XP」，满级显示巅峰值 */
      '    <p class="xp-to-next" role="status">' + (WQ.level.isMaxLevel(save.profile.level)
        ? '已达满级 · 巅峰值 ' + U.esc(U.formatNumber(save.profile.totalXp)) + ' XP'
        : '距下一级还差 <strong class="mono">' + U.esc(WQ.state.xpToNext == null ? 0 : WQ.state.xpToNext) + '</strong> XP 升到 Lv.' + U.esc(save.profile.level + 1)) + '</p>',
      '  </section>',
      '  <section class="card">',
      '    <h2 class="card-title">奖励明细</h2>',
      breakdownHtml(rec),
      '    <div class="breakdown-row is-total"><span>合计</span><span class="val">+' + U.esc(totalXp) + ' XP · +' + U.esc(totalCoins) + ' 金币</span></div>',
      '  </section>',
      badgesHtml(res.unlocked),
      wrongReviewHtml(rec),
      '  <div class="result-actions">',
      '    <button class="btn btn-primary" type="button" data-action="again">再来一局</button>',
      '    <button class="btn btn-ghost" type="button" data-action="home">返回营地</button>',
      '  </div>',
      '</main>'
    ].join(''));

    animate(res);
    playOverlays(res);
  }

  /** 数字滚动 + XP 条动画（跨级时先灌满 → 白闪 → 归零续走） */
  function animate(res) {
    document.querySelectorAll('[data-roll]').forEach(function (el) {
      WQ.anim.rollNumber(el, Number(el.getAttribute('data-roll')) || 0, {
        prefix: el.getAttribute('data-prefix') || '',
        suffix: el.getAttribute('data-suffix') || '',
        /* v0.2：数字滚完时给该数字加一次弹动，让「+250 XP」真的有落地感 */
        onDone: function () {
          el.classList.remove('is-bump');
          void el.offsetWidth; /* 强制重排，保证连点也能重新触发动画 */
          el.classList.add('is-bump');
        }
      });
    });

    const bar = document.querySelector('#result-xpbar > i');
    const barBox = document.getElementById('result-xpbar');
    if (!bar) return;
    const save = WQ.state.save;
    const p = save.profile;
    const maxLevel = WQ.level.isMaxLevel(p.level);
    const afterRatio = maxLevel ? 1 : (WQ.level.needXp(p.level) ? Math.min(1, p.xp / WQ.level.needXp(p.level)) : 0);
    const baseline = res.baseline || { level: p.level, xp: p.xp };
    const beforeRatio = (baseline.level === p.level && WQ.level.needXp(baseline.level))
      ? Math.max(0, Math.min(1, baseline.xp / WQ.level.needXp(baseline.level)))
      : 0;

    const levelUps = res.levelUps || [];
    if (!levelUps.length || WQ.anim.reducedMotion()) {
      WQ.anim.setProgress(bar, beforeRatio, false);
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () { WQ.anim.setProgress(bar, afterRatio, true); });
      });
      return;
    }

    /* 跨级：先灌满 → 白闪 → 归零 → 续走 */
    WQ.anim.setProgress(bar, beforeRatio, false);
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        WQ.anim.setProgress(bar, 1, true);
        window.setTimeout(function () {
          if (barBox) {
            barBox.classList.add('is-flash');
            window.setTimeout(function () { barBox.classList.remove('is-flash'); }, 300);
          }
          WQ.anim.setProgress(bar, 0, false);
          window.setTimeout(function () { WQ.anim.setProgress(bar, afterRatio, true); }, 60);
        }, 720);
      });
    });
  }

  /** 升级覆盖层（连升多级排队逐段播放）→ 徽章覆盖层；动效不阻塞落库 */
  function playOverlays(res) {
    const queue = (res.levelUps || []).slice();
    const badges = (res.unlocked || []).slice();
    document.title = '结算 · 单词猎手';

    function nextLevel() {
      if (!queue.length) { nextBadge(); return; }
      const lv = queue.shift();
      WQ.overlay.levelUp(lv.from, lv.to, lv.title, nextLevel);
    }
    function nextBadge() {
      if (!badges.length) return;
      WQ.overlay.badgeUnlock(badges, null);
    }
    if (queue.length || badges.length) {
      window.setTimeout(nextLevel, 900);
    }
  }

  const actions = {
    again: function () {
      WQ.overlay.close();
      const s = WQ.flow.createSession({ source: 'normal' });
      if (!s) { WQ.toast.show('词库不可用，无法开局'); return; }
      WQ.router.go('#/battle/' + s.roundId);
    },
    home: function () {
      WQ.overlay.close();
      WQ.router.go('#/home');
    }
  };

  WQ.pages = WQ.pages || {};
  WQ.pages.result = { render: render, actions: actions, resolveResult: resolveResult };
})(window.WQ = window.WQ || {});
