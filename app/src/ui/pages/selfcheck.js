/* src/ui/pages/selfcheck.js
 * 唯一职责：#/selfcheck 自检面板（docs/04 §8.1）。
 * 依赖：WQ.selfcheck、WQ.shell、WQ.util
 * 被依赖：src/main.js（路由注册）
 */
(function (WQ) {
  'use strict';

  const U = WQ.util;

  let lastResults = null;

  function rowsHtml(results) {
    if (!results) return '<p class="empty-note">点上面的按钮运行全部断言。</p>';
    const groups = {};
    results.forEach(function (r) { (groups[r.group] || (groups[r.group] = [])).push(r); });
    return Object.keys(groups).map(function (g) {
      return [
        '<h3 style="margin:12px 0 4px">' + U.esc(g) + '</h3>',
        groups[g].map(function (r) {
          return '<div class="breakdown-row"><span>' + (r.pass ? '✅' : '❌') + ' ' + U.esc(r.name) + '</span>' +
            '<span class="val">期望 ' + U.esc(r.expected) + ' · 实际 ' + U.esc(r.actual) + '</span></div>';
        }).join('')
      ].join('');
    }).join('');
  }

  function render() {
    const results = lastResults;
    const total = results ? results.length : (WQ.selfcheck.checks || []).length;
    const passed = results ? results.filter(function (r) { return r.pass; }).length : 0;
    WQ.shell.setActions(actions);
    WQ.shell.render([
      '<main class="page" id="main">',
      '  <h1>自检面板</h1>',
      '  <p class="overlay-text">数值与状态机的纯函数断言（docs/04 §8.1）。共 ' + total + ' 条' +
        (results ? '，通过 ' + passed + ' / ' + total : '') + '。</p>',
      '  <div style="height:12px"></div>',
      '  <button class="btn btn-primary btn-block" type="button" data-action="run">运行全部</button>',
      '  <button class="btn btn-ghost btn-block" style="margin-top:8px" type="button" data-action="home">返回营地</button>',
      '  <section class="card" style="margin-top:12px">',
      results
        ? '<h2 class="card-title"><span>结果</span><span class="chip ' + (passed === total ? 'chip-success' : 'chip-muted') + '">' + (passed === total ? '全部 PASS' : (total - passed) + ' 条 FAIL') + '</span></h2>'
        : '<h2 class="card-title">结果</h2>',
      rowsHtml(results),
      '  </section>',
      '  <section class="card">',
      '    <h2 class="card-title">开发开关（自用，默认折叠）</h2>',
      '    <details class="disclosure">',
      '      <summary>造数据</summary>',
      '      <button class="btn btn-sm btn-ghost btn-block" style="margin-top:8px" type="button" data-action="coins">+500 金币</button>',
      '      <button class="btn btn-sm btn-ghost btn-block" style="margin-top:8px" type="button" data-action="xp">+200 XP（可能升级）</button>',
      '      <button class="btn btn-sm btn-ghost btn-block" style="margin-top:8px" type="button" data-action="reset">清空存档</button>',
      '    </details>',
      '  </section>',
      '</main>'
    ].join(''));
  }

  const actions = {
    run: function () {
      lastResults = WQ.selfcheck.run();
      render();
      const failed = lastResults.filter(function (r) { return !r.pass; });
      WQ.toast.show(failed.length ? failed.length + ' 条断言未通过' : '全部 ' + lastResults.length + ' 条断言通过');
    },
    coins: function () {
      WQ.actions.commit(function (s) { s.save.profile.coins = (Number(s.save.profile.coins) || 0) + 500; });
      WQ.toast.show('已加 500 金币');
    },
    xp: function () {
      WQ.actions.commit(function (s) {
        s.save.profile.xp = (Number(s.save.profile.xp) || 0) + 200;
        s.save.profile.totalXp = (Number(s.save.profile.totalXp) || 0) + 200;
        WQ.level.applyLevelUps(s.save.profile);
      });
      WQ.toast.show('已加 200 XP');
    },
    reset: function () {
      WQ.persist.clearAll();
      WQ.state.save = WQ.save.fillDefaults(WQ.save.defaultSave());
      WQ.actions.commit();
      lastResults = null;
      render();
      WQ.toast.show('已清空存档');
    },
    home: function () { WQ.router.go('#/home'); }
  };

  WQ.pages = WQ.pages || {};
  WQ.pages.selfcheck = { render: render, actions: actions };
})(window.WQ = window.WQ || {});
