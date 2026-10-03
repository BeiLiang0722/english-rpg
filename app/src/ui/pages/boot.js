/* src/ui/pages/boot.js
 * 唯一职责：#/boot 启动过场与失败兜底（docs/03 §7.4 / docs/04 T1.22）。
 * 依赖：WQ.shell、WQ.router、WQ.state
 * 被依赖：src/main.js（路由注册）
 */
(function (WQ) {
  'use strict';

  /** 过场页（真实进度，不造假：只在真实步骤完成后推进） */
  function render(progress, note) {
    const pct = Math.max(0, Math.min(1, Number(progress) || 0));
    WQ.shell.setActions(actions);
    WQ.shell.render([
      '<div class="boot-page">',
      '  <p class="boot-brand">单词猎手</p>',
      '  <p class="boot-version">v0.1 · 本地离线运行</p>',
      '  <div class="boot-bar">',
      '    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct * 100) + '" aria-label="加载进度">',
      '      <i data-progress-init="' + pct + '" style="transform:scaleX(' + pct + ')"></i>',
      '    </div>',
      '  </div>',
      note ? '  <p class="overlay-text">' + WQ.util.esc(note) + '</p>' : '',
      '</div>'
    ].join(''), { noAnim: true });
  }

  /** 词库缺失兜底：停留在此页 + 重新加载按钮 */
  function renderBroken(reason) {
    WQ.shell.setActions(actions);
    WQ.shell.render([
      '<div class="boot-page">',
      '  <p class="boot-brand">单词猎手</p>',
      '  <div class="card" style="max-width:420px">',
      '    <h1 class="result-title">词库文件损坏</h1>',
      '    <p class="overlay-text">' + WQ.util.esc(reason || '读不到 WQ.WORDS') + '</p>',
      '    <p class="overlay-text">请确认 app/src/data/words.js 与 app/data/words.json 存在且未被改动。</p>',
      '  </div>',
      '  <button class="btn btn-primary" type="button" data-action="reload">重新加载</button>',
      '</div>'
    ].join(''), { noAnim: true });
  }

  const actions = {
    reload: function () { location.reload(); }
  };

  WQ.pages = WQ.pages || {};
  WQ.pages.boot = { render: render, renderBroken: renderBroken, actions: actions };
})(window.WQ = window.WQ || {});
