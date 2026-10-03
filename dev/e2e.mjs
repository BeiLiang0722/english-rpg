/* dev/e2e.mjs · 真实浏览器端到端验收（开发期工具，非运行时依赖）
 * 依赖：node:fs / node:path / 全局 WebSocket(Node 22+) / fetch
 * 用法（由 dev/run-e2e.ps1 调用）：先手工/脚本启动 Edge headless 并带 --remote-debugging-port，
 *   然后 node dev/e2e.mjs <port>
 *
 * 说明：本脚本不自己 spawn 浏览器进程（受限环境下 spawn EPERM），浏览器由 PowerShell 启动。
 * 它做三件事：① 用 CDP 逐条执行验收动作；② 断言关键结果；③ 截图存到 app/_wip/shots/。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DEV_DIR, '..');
const APP_DIR = path.join(ROOT, 'app');
const SHOTS = path.join(DEV_DIR, 'out', 'shots');
const PORT = Number(process.argv[2] || 9333);

fs.mkdirSync(SHOTS, { recursive: true });

const steps = [];
let failures = 0;

function log(step, detail, ok) {
  const rec = { step, detail: detail == null ? '' : String(detail), ok: ok === undefined ? null : ok };
  steps.push(rec);
  if (ok === false) failures++;
  console.log((ok === false ? 'FAIL  ' : ok === true ? 'PASS  ' : 'INFO  ') + step + (detail ? '  → ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- CDP 客户端 ---------------- */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.console = []; this.errors = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new CDP(ws);
    ws.addEventListener('message', (ev) => cdp.onMessage(ev.data));
    return cdp;
  }
  onMessage(raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : String(raw)); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      this.console.push({ type: msg.params.type, text });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      this.errors.push((d.exception && d.exception.description) || d.text);
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error') this.errors.push('[log] ' + e.text + ' ' + (e.url || ''));
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
      }, 30000);
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression: '(function(){' + expression + '})()',
      returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (res.exceptionDetails) throw new Error('页面内异常: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    return res.result.value;
  }
  async click(selector, index = 0) {
    return this.eval(`
      const list = document.querySelectorAll(${JSON.stringify(selector)});
      const el = list[${index}];
      if (!el) return 'MISSING:' + ${JSON.stringify(selector)};
      el.click();
      return 'clicked:' + (el.textContent || '').trim().slice(0, 40);
    `);
  }
  async shot(name) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(res.data, 'base64'));
  }
}

async function findTarget() {
  const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
  const list = await res.json();
  const page = list.filter((t) => t.type === 'page')[0];
  if (!page) throw new Error('没有可用的 page target');
  return page;
}

/* ================= 主流程 ================= */
let cdp = null;
try {
  const target = await findTarget();
  cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const fileUrl = 'file:///' + path.join(APP_DIR, 'index.html').replace(/\\/g, '/');

  /* 步骤 1：打开 index.html（不带 hash，等价双击） */
  await cdp.send('Page.navigate', { url: fileUrl });
  await sleep(1800);
  log('打开 app/index.html（file://）', await cdp.eval('return location.href'));
  log('启动后路由', await cdp.eval('return location.hash'));
  const words = await cdp.eval('return WQ.WORDS.length');
  log('词库条数', String(words), words === 200);

  /* 步骤 2：首页必显 5 项 */
  const homeText = await cdp.eval('return document.querySelector("#app").innerText');
  const hud = await cdp.eval('return (document.querySelector(".level-badge")||{}).innerText || ""');
  log('首页 HUD 等级圆章', hud.replace(/\n/g, ' '));
  log('首页有 XP 进度条', await cdp.eval('return !!document.querySelector(".progress")'), true);
  const hearts = await cdp.eval('return (document.querySelector(".hearts")||{}).innerText || ""');
  log('首页血量心形', hearts);
  log('首页显示"今日已答"', homeText.includes('今日已答'), true);
  log('首页显示连续天数', /天/.test(homeText), true);
  log('首页显示金币', homeText.includes('🪙'), true);
  await cdp.shot('01-home');

  /* 步骤 3：点击「开始一局」→ 第 1 题 */
  log('点击"开始一局"', await cdp.click('[data-action="start"]'));
  await sleep(800);
  log('对局页路由', await cdp.eval('return location.hash'));
  log('第 1 题', await cdp.eval('const q=WQ.flow.currentQuestion(); return q.type + " / " + (q.word||q.meaningCn)'));
  await cdp.shot('02-battle-q1');

  /* 步骤 4：逐题作答（前 7 题答对，第 8 题故意答错） */
  for (let i = 0; i < 8; i++) {
    const info = await cdp.eval(`
      const s = WQ.state.session;
      const q = WQ.flow.currentQuestion();
      if (!q) return JSON.stringify({done:true});
      const correctIdx = (q.options||[]).findIndex(function(o){return o.correct;});
      return JSON.stringify({type:q.type, word:q.word||q.meaningCn, correctIdx:correctIdx});
    `);
    const q = JSON.parse(info);
    if (q.done) break;
    const makeWrong = i === 7 && q.correctIdx >= 0;
    const target = makeWrong ? (q.correctIdx + 1) % 4 : q.correctIdx;
    if (q.correctIdx < 0) {
      await cdp.eval('const el=document.querySelector("[data-spell-input]"); el.value=' + JSON.stringify(q.word) + '; return el.value;');
      await cdp.click('[data-action="submitSpell"]');
    } else {
      await cdp.click('.option', target);
    }
    await sleep(250);
    const after = await cdp.eval('const s=WQ.state.session; return JSON.stringify({hp:s.hpLeft,correct:s.correct,wrong:s.wrong,combo:s.combo,xp:s.xpGained});');
    log('第 ' + (i + 1) + ' 题（' + q.type + '）' + (makeWrong ? '故意答错' : '答对') + ' 后', after);
    if (i === 0) {
      const fb = await cdp.eval('return (document.querySelector(".feedback")||{}).innerText || ""');
      log('反馈条文案', fb.replace(/\n/g, ' / '));
      await cdp.shot('03-battle-feedback');
    }
    if (JSON.parse(after).hp <= 0) break;
    await cdp.click('[data-action="next"]');
    await sleep(250);
  }

  /* 步骤 5：结算页 */
  await sleep(1000);
  log('结算页路由', await cdp.eval('return location.hash'));
  const resultText = await cdp.eval('return document.querySelector("#app").innerText');
  log('结算页含"正确率"', resultText.includes('正确率'), true);
  log('结算页含 XP 与金币', resultText.includes('XP') && resultText.includes('金币'), true);
  log('结算页含连击', resultText.includes('连击'), true);
  log('结算页含奖励明细', resultText.includes('奖励明细'), true);
  await cdp.shot('04-result');
  const overlayText = await cdp.eval('return (document.getElementById("overlay-root").innerText||"").replace(/\\n/g," ").slice(0,80)');
  log('升级覆盖层', overlayText || '（本局未升级或已自动收起）');
  if (overlayText) await cdp.shot('05-levelup-overlay');

  const cross = await cdp.eval(`
    const s=WQ.state.save, rec=s.rounds[s.rounds.length-1];
    return JSON.stringify({round:rec.correct+"/"+rec.totalQuestions, xp:rec.xpGained, coins:rec.coinsGained, level:s.profile.level, xpNow:s.profile.xp, coinsNow:s.profile.coins, rounds:s.rounds.length});
  `);
  log('结算数字 ↔ 存档交叉核对', cross);

  /* 步骤 6：刷新后进度还在 */
  const beforeReload = await cdp.eval('return JSON.stringify({level:WQ.state.save.profile.level,totalXp:WQ.state.save.profile.totalXp,coins:WQ.state.save.profile.coins,rounds:WQ.state.save.rounds.length})');
  const rawSave = await cdp.eval('return localStorage.getItem("wordquest.save.v1").length');
  await cdp.send('Page.navigate', { url: fileUrl });
  await sleep(1800);
  const afterReload = await cdp.eval('return JSON.stringify({level:WQ.state.save.profile.level,totalXp:WQ.state.save.profile.totalXp,coins:WQ.state.save.profile.coins,rounds:WQ.state.save.rounds.length})');
  log('刷新前（存档 ' + rawSave + ' 字节）', beforeReload);
  log('刷新后', afterReload, beforeReload === afterReload);
  await cdp.shot('06-after-reload');

  /* 步骤 7：结算页刷新不重复发奖 */
  const lastRoundId = await cdp.eval('return WQ.state.save.rounds[WQ.state.save.rounds.length-1].roundId');
  const coinsBefore = await cdp.eval('return WQ.state.save.profile.coins');
  await cdp.send('Page.navigate', { url: fileUrl + '#/result/' + lastRoundId });
  await sleep(1600);
  const coinsAfter = await cdp.eval('return WQ.state.save.profile.coins');
  log('结算页直接刷新（roundId=' + String(lastRoundId).slice(0, 8) + '）金币', coinsBefore + ' → ' + coinsAfter, coinsBefore === coinsAfter);

  /* 步骤 8：成长页 4 个 Tab */
  for (const tab of ['level', 'wrong', 'stats', 'words']) {
    await cdp.send('Page.navigate', { url: fileUrl + '#/growth?tab=' + tab });
    await sleep(1300);
    const t = await cdp.eval('return document.querySelector("#app").innerText.slice(0,70).replace(/\\n/g," | ")');
    log('成长页 Tab=' + tab, t);
  }
  await cdp.shot('07-growth');

  /* 步骤 9：商店购买护心符 → 下一局 4 颗心 */
  await cdp.eval('return WQ.actions.commit(function(s){s.save.profile.coins=500}) && "ok"');
  await cdp.send('Page.navigate', { url: fileUrl + '#/shop' });
  await sleep(1300);
  log('商店物品按钮数', await cdp.eval('return String(document.querySelectorAll("[data-action=\\"buy\\"]").length)'));
  await cdp.shot('08-shop');
  await cdp.click('[data-action="buy"]', 0);
  await sleep(400);
  log('购买确认弹层', await cdp.eval('return document.getElementById("overlay-root").innerText.replace(/\\n/g," ")'));
  await cdp.click('[data-overlay-ok]');
  await sleep(500);
  log('购买后金币 / hpBonus', await cdp.eval('return WQ.state.save.profile.coins + " / " + WQ.state.save.profile.nextRoundHpBonus'));
  await cdp.send('Page.navigate', { url: fileUrl + '#/home' });
  await sleep(1300);
  await cdp.click('[data-action="start"]');
  await sleep(700);
  log('带护心符开局', await cdp.eval('return WQ.state.session.hpMax + " 颗心上限 / 当前 " + WQ.state.session.hpLeft'));
  await cdp.shot('09-battle-4hearts');

  /* 步骤 10：对局中途刷新 → 保留已得 + 回营地 */
  await cdp.eval(`
    const q = WQ.flow.currentQuestion();
    const idx = (q.options||[]).findIndex(function(o){return o.correct;});
    if (idx >= 0) document.querySelectorAll('.option')[idx].click();
    return 'answered';
  `);
  await sleep(500);
  const coinsMid = await cdp.eval('return WQ.state.save.profile.coins');
  await cdp.send('Page.navigate', { url: fileUrl });
  await sleep(1900);
  const afterMid = await cdp.eval('return JSON.stringify({coins:WQ.state.save.profile.coins, sessionAlive:!!WQ.state.session, toast:(document.getElementById("toast-root").innerText||"")})');
  log('对局中途刷新（刷新前金币 ' + coinsMid + '）', afterMid);

  /* 步骤 11：自检面板 */
  await cdp.send('Page.navigate', { url: fileUrl + '#/selfcheck' });
  await sleep(1400);
  await cdp.click('[data-action="run"]');
  await sleep(1500);
  const scText = await cdp.eval('return document.querySelector("#app").innerText');
  const passCount = (scText.match(/✅/g) || []).length;
  const failCount = (scText.match(/❌/g) || []).length;
  log('自检面板', passCount + ' 条 PASS / ' + failCount + ' 条 FAIL', failCount === 0);
  await cdp.shot('10-selfcheck');

  /* 步骤 12：Console 与配色/字体核对 */
  const consoleErrors = cdp.console.filter((c) => c.type === 'error');
  log('Console 错误数', String(consoleErrors.length + cdp.errors.length) + (consoleErrors.length || cdp.errors.length ? ' → ' + JSON.stringify([...consoleErrors.slice(0, 2), ...cdp.errors.slice(0, 2)]) : ''), consoleErrors.length + cdp.errors.length === 0);
  const bg = await cdp.eval('return getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim() + " / " + getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()');
  log('配色 token', bg, bg === '#0F1424 / #6C5CE7');
  log('正文字体栈', await cdp.eval('return getComputedStyle(document.body).fontFamily.slice(0,60)'));
  log('本地存储可用', await cdp.eval('return WQ.persist.available()'), true);

  /* 步骤 13：1440px 桌面居中卡片 */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: fileUrl + '#/home' });
  await sleep(1400);
  const desk = await cdp.eval('return JSON.stringify({overflow: document.documentElement.scrollWidth > window.innerWidth, pageWidth: Math.round(document.querySelector(".page").getBoundingClientRect().width), viewport: window.innerWidth})');
  log('1440px 桌面', desk);
  await cdp.shot('11-desktop-1440');

  /* 步骤 14：320px 小屏无横向滚动 */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 2, mobile: true });
  await sleep(800);
  const small = await cdp.eval('return JSON.stringify({overflow: document.documentElement.scrollWidth > window.innerWidth, scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth})');
  log('320px 小屏', small);
  await cdp.shot('12-small-320');

  /* 步骤 15：纯键盘走一局（1-4 选答案 / Enter 下一题） */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Page.navigate', { url: fileUrl + '#/home' });
  await sleep(1400);
  await cdp.eval('const el=document.querySelector("[data-action=\\"start\\"]"); el.focus(); el.click(); return "k";');
  await sleep(800);
  let keyboardOk = true;
  for (let i = 0; i < 10; i++) {
    const st = await cdp.eval(`
      const s=WQ.state.session; if(!s) return JSON.stringify({over:true});
      const q=WQ.flow.currentQuestion(); if(!q) return JSON.stringify({over:true});
      const idx=(q.options||[]).findIndex(function(o){return o.correct;});
      return JSON.stringify({over:false, correctIdx:idx, key:(idx>=0?String(idx+1):"")});
    `);
    const s = JSON.parse(st);
    if (s.over) break;
    if (s.correctIdx < 0) {
      const w = await cdp.eval('return WQ.flow.currentQuestion().word');
      await cdp.eval('const el=document.querySelector("[data-spell-input]"); el.value=' + JSON.stringify(w) + '; el.focus(); return 1;');
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    } else {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: String(s.correctIdx + 1), code: 'Digit' + (s.correctIdx + 1), windowsVirtualKeyCode: 49 + s.correctIdx });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: String(s.correctIdx + 1), code: 'Digit' + (s.correctIdx + 1), windowsVirtualKeyCode: 49 + s.correctIdx });
    }
    await sleep(280);
    const judged = await cdp.eval('return !!(WQ.state.session && WQ.state.session.judged)');
    if (!judged) { keyboardOk = false; break; }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(280);
  }
  const keyboardEnd = await cdp.eval('return location.hash');
  log('纯键盘通关（1/2/3/4 作答 + Enter 进入下一题）', '结束路由 ' + keyboardEnd, keyboardOk && keyboardEnd.indexOf('/result/') >= 0);
  await cdp.shot('13-keyboard-result');

  log('截图目录', SHOTS);
} catch (e) {
  log('端到端脚本异常', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e), false);
} finally {
  try { if (cdp) cdp.ws.close(); } catch { /* ignore */ }
}

fs.writeFileSync(path.join(DEV_DIR, 'out', 'e2e-steps.json'), JSON.stringify(steps, null, 2), 'utf8');
console.log('\n=== 端到端结果：' + (steps.length - failures) + '/' + steps.length + ' 通过，失败 ' + failures + ' ===');
process.exit(failures ? 1 : 0);
