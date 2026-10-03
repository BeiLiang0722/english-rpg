/* src/ui/pages/settings.js
 * 唯一职责：#/settings 设置页（docs/03 §6.11 + 清档危险操作 + 版本信息）。
 * 依赖：WQ.shell、WQ.state、WQ.persist、WQ.router、WQ.anim、WQ.overlay
 * 被依赖：src/main.js（路由注册）
 */
(function (WQ) {
  'use strict';

  const U = WQ.util;

  function switchRow(label, desc, key) {
    const on = !!WQ.state.settings[key];
    return [
      '<div class="setting-row">',
      '  <span><span>' + U.esc(label) + '</span><div class="desc">' + U.esc(desc) + '</div></span>',
      '  <button class="switch" type="button" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + U.esc(label) + '" data-action="toggle" data-id="' + U.esc(key) + '"></button>',
      '</div>'
    ].join('');
  }

  function render() {
    const s = WQ.state.save;
    const st = WQ.state.settings;
    WQ.shell.setActions(actions);
    WQ.shell.render([
      '<main class="page" id="main">',
      '  <h1>设置</h1>',
      '  <div style="height:12px"></div>',
      '  <section class="card">',
      '    <h2 class="card-title">偏好</h2>',
      switchRow('自动发音', '打开题目时自动朗读英文单词（需要系统英文语音包）', 'autoSpeak'),
      switchRow('音效', '答对/答错/升级的合成音效', 'sfxEnabled'),
      switchRow('减弱动效', '关闭抖动、红闪、弹入等非必要动效', 'reducedMotion'),
      switchRow('答错时显示答案', '关闭后只提示"答错"，不直接给正确答案', 'showAnswerOnWrong'),
      '    <div class="setting-row">',
      '      <span><span>字号</span><div class="desc">整站字号档位</div></span>',
      '      <span class="seg" role="group" aria-label="字号档位">',
      '        <button type="button" data-action="font" data-id="md" aria-pressed="' + (st.fontSize === 'md') + '">标准</button>',
      '        <button type="button" data-action="font" data-id="lg" aria-pressed="' + (st.fontSize === 'lg') + '">大</button>',
      '        <button type="button" data-action="font" data-id="xl" aria-pressed="' + (st.fontSize === 'xl') + '">特大</button>',
      '      </span>',
      '    </div>',
      '  </section>',
      '  <section class="card">',
      '    <h2 class="card-title">当前存档</h2>',
      '    <div class="breakdown-row"><span>等级</span><span class="val">Lv.' + U.esc(s.profile.level) + ' ' + U.esc(WQ.level.titleFor(s.profile.level)) + '</span></div>',
      '    <div class="breakdown-row"><span>累计 XP</span><span class="val">' + U.esc(s.profile.totalXp) + '</span></div>',
      '    <div class="breakdown-row"><span>金币</span><span class="val">' + U.esc(s.profile.coins) + '</span></div>',
      '    <div class="breakdown-row"><span>连续天数</span><span class="val">' + U.esc(s.streak.dailyStreak) + ' 天</span></div>',
      '    <div class="breakdown-row"><span>完成局数</span><span class="val">' + U.esc(s.stats.totalRounds) + '</span></div>',
      '    <div class="breakdown-row"><span>词库</span><span class="val">' + U.esc((WQ.WORDS || []).length) + ' 词</span></div>',
      '    <div class="breakdown-row"><span>存档写入</span><span class="val">' + (WQ.persistStatus === 'failed' ? '失败（未保存）' : '正常') + '</span></div>',
      '  </section>',
      '  <section class="card settings-danger">',
      '    <h2 class="card-title">危险操作</h2>',
      '    <p class="overlay-text">清空全部数据会删除等级、金币、词库进度与连续天数，且无法撤销。</p>',
      '    <button class="btn btn-danger btn-block" style="margin-top:12px" type="button" data-action="reset">清空全部数据</button>',
      '  </section>',
      '  <p class="empty-note">单词猎手 v0.1 · 词库 ' + U.esc((WQ.WORDS || []).length) + ' 词 · 数据仅存于本机浏览器 localStorage</p>',
      '</main>'
    ].join(''));
  }

  const actions = {
    toggle: function (el, key) {
      const next = !(WQ.state.settings[key]);
      WQ.actions.commitSettings({ [key]: next });
      WQ.anim.applyMotionAttr();
      render();
      WQ.toast.show((next ? '已开启：' : '已关闭：') + key);
    },
    font: function (el, size) {
      WQ.actions.commitSettings({ fontSize: size === 'lg' || size === 'xl' ? size : 'md' });
      WQ.anim.applyFontSize(WQ.state.settings.fontSize);
      render();
    },
    reset: function () {
      WQ.overlay.confirm({
        title: '清空全部数据？',
        text: '等级、金币、词库进度、连续天数都会被删除，无法撤销。',
        okText: '继续',
        onOk: function () {
          WQ.overlay.confirm({
            title: '最后确认',
            text: '确定要回到全新存档吗？',
            okText: '确定清空',
            onOk: function () {
              WQ.persist.clearAll();
              WQ.state.save = WQ.save.fillDefaults(WQ.save.defaultSave());
              WQ.state.session = null;
              WQ.state.lastResult = null;
              WQ.actions.commit();
              WQ.toast.show('已清空，回到全新存档');
              WQ.router.go('#/home');
            }
          });
        }
      });
    }
  };

  WQ.pages = WQ.pages || {};
  WQ.pages.settings = { render: render, actions: actions };
})(window.WQ = window.WQ || {});
