/* src/core/router.js
 * 唯一职责：location.hash 解析、路由注册表、404 兜底。
 * 依赖：WQ.bus
 * 被依赖：src/main.js、src/ui/pages/*（通过 WQ.router.go 跳转）
 * 路由表（docs/03 §3.3）：#/boot #/home #/battle/:roundId #/result/:roundId
 *                        #/growth #/shop #/settings #/selfcheck
 */
(function (WQ) {
  'use strict';

  const routes = [];
  let current = '#/boot';
  let started = false;

  /** 解析 hash：'#/battle/abc?x=1' → { path:'/battle/abc', parts:['battle','abc'], query:{x:'1'} } */
  function parse(hash) {
    const raw = String(hash || '').replace(/^#/, '') || '/boot';
    const qIndex = raw.indexOf('?');
    const path = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
    const search = qIndex >= 0 ? raw.slice(qIndex + 1) : '';
    const parts = path.split('/').filter(Boolean);
    const query = {};
    search.split('&').filter(Boolean).forEach(function (kv) {
      const i = kv.indexOf('=');
      const k = i >= 0 ? kv.slice(0, i) : kv;
      const v = i >= 0 ? kv.slice(i + 1) : '';
      query[decodeURIComponent(k)] = decodeURIComponent(v);
    });
    return { path: path, parts: parts, query: query };
  }

  /**
   * 注册路由。
   * @param {string} pattern 形如 '#/battle/:roundId'
   * @param {function} handler (ctx) => void，ctx = { name, params, query, hash }
   */
  function register(pattern, handler) {
    routes.push({ pattern: pattern, segments: parse(pattern).parts, handler: handler });
  }

  /** 找出匹配的路由，:name 段作为参数 */
  function match(parsed) {
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (r.segments.length !== parsed.parts.length) continue;
      const params = {};
      let ok = true;
      for (let j = 0; j < r.segments.length; j++) {
        const seg = r.segments[j];
        if (seg.charAt(0) === ':') params[seg.slice(1)] = parsed.parts[j];
        else if (seg !== parsed.parts[j]) { ok = false; break; }
      }
      if (ok) return { route: r, params: params };
    }
    return null;
  }

  /** 跳转（写 hash，hashchange 会触发渲染） */
  function go(hash) {
    if (location.hash === hash) { dispatch(); return; }
    location.hash = hash;
  }

  /** 替换 hash，不产生历史记录 */
  function replace(hash) {
    const url = location.href.split('#')[0] + hash;
    try { history.replaceState(null, '', url); } catch (e) { location.hash = hash; }
    dispatch();
  }

  /** 执行当前 hash 对应的渲染 */
  function dispatch() {
    const hash = location.hash || '#/boot';
    current = hash;
    const parsed = parse(hash);
    const hit = match(parsed);
    const ctx = {
      name: hit ? hit.route.pattern : null,
      params: hit ? hit.params : {},
      query: parsed.query,
      hash: hash
    };
    if (WQ.state) WQ.state.route = hash;
    if (hit) {
      hit.route.handler(ctx);
    } else {
      WQ.shell.renderNotFound(hash);
    }
    WQ.bus.emit('route', ctx);
  }

  function start() {
    if (started) return;
    started = true;
    window.addEventListener('hashchange', dispatch);
    if (!location.hash) {
      // 首次进入：落到 #/boot（不合法也兜底）
      try { history.replaceState(null, '', location.href.split('#')[0] + '#/boot'); } catch (e) { location.hash = '#/boot'; }
    }
    dispatch();
  }

  function currentHash() { return current; }

  WQ.router = {
    parse: parse,
    register: register,
    go: go,
    replace: replace,
    dispatch: dispatch,
    start: start,
    currentHash: currentHash
  };
})(window.WQ = window.WQ || {});
