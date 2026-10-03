/* src/ui/pages/shop.js
 * 唯一职责：#/shop 商店页（docs/03 §4.11 / §5.5）。
 * 依赖：WQ.shell、WQ.state、WQ.shop、WQ.overlay、WQ.router、WQ.util
 * 被依赖：src/main.js（路由注册）
 */
(function (WQ) {
  'use strict';

  const U = WQ.util;
  const B = WQ.balance;

  function itemRow(save, id) {
    const item = B.shop[id];
    const left = WQ.shop.remaining(save, id);
    const poor = (Number(save.profile.coins) || 0) < item.price;
    const disabled = left <= 0 || poor;
    const label = left <= 0
      ? (item.limitPeriod === 'monthly' ? '本月已售罄' : '今日已售罄')
      : (poor ? '还差 ' + (item.price - save.profile.coins) + ' 金币' : '购买');
    const period = item.limitPeriod === 'monthly' ? '本月剩 ' : '今日剩 ';
    return [
      '<div class="wrong-item" style="align-items:flex-start">',
      '  <span style="flex:1">',
      '    <span class="w">' + U.esc(item.icon) + ' ' + U.esc(item.name) + '</span> ',
      '    <span class="chip chip-gold">' + item.price + ' 金币</span>',
      '    <div class="m" style="margin-top:4px">' + U.esc(item.desc) + '</div>',
      '    <div class="m">' + period + left + ' / ' + item.limit + '</div>',
      '  </span>',
      '  <button class="btn btn-sm ' + (disabled ? '' : 'btn-primary') + '" type="button" data-action="buy" data-id="' + U.esc(id) + '"' + (disabled ? ' disabled' : '') + '>' + U.esc(label) + '</button>',
      '</div>'
    ].join('');
  }

  function render() {
    const save = WQ.state.save;
    const pending = WQ.shop.pendingEffects(save);
    WQ.shell.setActions(actions);
    WQ.shell.render([
      '<main class="page" id="main">',
      '  <h1>商店</h1>',
      '  <div style="height:12px"></div>',
      '  <section class="card">',
      '    <h2 class="card-title"><span>金币余额</span><span class="hud-coins">🪙 ' + U.esc(save.profile.coins) + '</span></h2>',
      pending.length
        ? '<p class="overlay-text">下一局生效：' + U.esc(pending.join('；')) + '</p>'
        : '<p class="overlay-text">当前没有待生效的道具。</p>',
      '  </section>',
      '  <section class="card">',
      '    <h2 class="card-title">物品</h2>',
      B.shopOrder.map(function (id) { return itemRow(save, id); }).join(''),
      '  </section>',
      '  <section class="card">',
      '    <h2 class="card-title">说明</h2>',
      '    <p class="overlay-text">护心符只对下一局有效；回补卡用于把漏掉的一天接上，连击不会因为漏一天就归零；侦查之眼与替身稻草人在下一局自动消耗。</p>',
      '    <p class="overlay-text">本 App 不存在任何会减少 XP、金币、等级或徽章的惩罚。</p>',
      '  </section>',
      '  <button class="btn btn-ghost btn-block" type="button" data-action="home">返回营地</button>',
      '</main>'
    ].join(''));
  }

  const actions = {
    buy: function (el, id) {
      const item = B.shop[id];
      if (!item) return;
      WQ.overlay.confirm({
        title: '购买 ' + item.name + '？',
        text: item.price + ' 金币 · ' + item.desc,
        okText: '确认购买',
        onOk: function () {
          const res = WQ.shop.buy(WQ.state.save, id, new Date());
          WQ.actions.commit();
          if (!res.ok) {
            WQ.toast.show(res.reason === 'poor' ? '金币不足' : '已达限购上限');
            return;
          }
          WQ.audio.sfxCoin();
          if (res.repaired) WQ.toast.show('连击已接上：' + res.repaired.streak + ' 天');
          else WQ.toast.show('已购买：' + item.name);
          if (res.unlocked && res.unlocked.length) {
            WQ.overlay.badgeUnlock(res.unlocked, null);
          }
          render();
        }
      });
    },
    home: function () { WQ.router.go('#/home'); }
  };

  WQ.pages = WQ.pages || {};
  WQ.pages.shop = { render: render, actions: actions };
})(window.WQ = window.WQ || {});
