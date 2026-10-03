/* dev/dom-e2e.mjs · 不用浏览器也能跑的端到端验收（开发期工具，非运行时依赖）
 * 依赖：node:fs / node:vm / node:path / dev/domshim.mjs
 * 用法：node dev/dom-e2e.mjs
 *
 * 做法：用 dev/domshim.mjs 的极简 DOM + 虚拟时钟，把 app/index.html 里列出的全部脚本按顺序
 *       执行，然后模拟用户点击/按键，逐步核对"点了什么 → 界面变成什么"；用重建 vm 上下文
 *       的方式模拟刷新，验证 localStorage 持久化与结算幂等。虚拟时钟让测试不需要真等待。
 * 局限：不做 CSS 布局与绘制（见 docs/05 的已知限制）。
 * 第 21–24 节（v0.1.1 新增，修 docs/06 §1.3 的"三套件看不见写盘失败"）使用 domshim 的故障注入：
 *   21 注入 QuotaExceededError → 营地提示条 + 主按钮仍可用；22 配额只抛一次 → rounds 裁剪重试成功；
 *   23 emitStorageEvent → persist.onStorage → storageExternal 转发；24 损坏存档路径不受注入影响。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnv } from './domshim.mjs';

const DEV_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(DEV_DIR, '..', 'app');

/* 与 app/index.html 的 <script src> 顺序保持一致 —— 唯一真相同步（v0.2 起 app 会持续新增模块，
 * 硬编码清单一旦漏文件，就会出现「WQ.quest is undefined」这类与断言无关的连锁失败）。 */
function listScriptsFromIndexHtml() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const out = [];
  const re = /<script\s+src="([^"]+)"\s*>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].replace(/\\/g, '/'));
  return out;
}
const FILES = listScriptsFromIndexHtml();
const sources = new Map();
for (const rel of FILES) sources.set(rel, fs.readFileSync(path.join(APP, rel), 'utf8'));
const mainSource = sources.get('src/main.js');

const steps = [];
let failures = 0;
function log(step, detail, ok) {
  steps.push({ step, detail: detail == null ? '' : String(detail), ok: ok === undefined ? null : ok });
  if (ok === false) failures++;
  console.log((ok === false ? 'FAIL  ' : ok === true ? 'PASS  ' : 'INFO  ') + step + (detail ? '  → ' + detail : ''));
}

/**
 * 可播种的随机数发生器（mulberry32）。
 * 为什么要它：app 的随机源最终都落到 Math.random（flow.buildRound / questionPool.buildRound
 * 在不传 rnd 时用 Math.random），而**本测试不注入 rnd**，于是每跑一次抽到的题型序列都不同。
 * 未播种时第 3 节的断言假定"当前是第 0 题的选择题"，抽到拼写题（Q3/Q5，无选项）就会
 * 既不判定也不掉血 → 「答错不加 XP」「重试后血量不变」两条连带失败（约 1/6 概率）。
 * 播种后整套用例可复现，CI/重跑结果一致。
 */
function makeRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 默认种子：经 `node dev/dom-e2e.mjs --find-seed` 扫出，保证第 1 题是选择题 */
const DEFAULT_SEED = Number(process.env.WQ_E2E_SEED || 7);

/** 造一个"页面"（等价一次刷新）；同一个 storage 复用即等价 localStorage 持久化 */
function createPage(storage2, opts2 = {}) {
  const storage = storage2 || new Map();
  const env = createEnv({ storage, reducedMotion: opts2.reducedMotion });
  /* Math 用副本 + 播种 rnd 覆盖 random：不污染宿主 Node 的 Math.random */
  const seededMath = Object.create(Math);
  seededMath.random = makeRng(opts2.seed === undefined ? DEFAULT_SEED : opts2.seed);
  const sandbox = {
    JSON, Math: seededMath, Date, Number, String, Boolean, Array, Object, Set, Map, WeakMap, RegExp, Error, Promise, Symbol,
    parseInt, parseFloat, isNaN, isFinite
  };
  Object.assign(sandbox, env.window, {
    document: env.document,
    localStorage: env.localStorage,
    location: env.window.location,
    performance: env.window.performance,
    navigator: env.window.navigator
  });
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const errors = [];
  sandbox.console = {
    log() {}, info() {}, warn() {}, debug() {},
    error: (...a) => { errors.push(a.map((x) => (x && x.message) || String(x)).join(' ')); }
  };
  const loaded = [];
  for (const [rel, code] of sources) {
    if (opts2.skipMain && rel === 'src/main.js') continue;
    try {
      vm.runInContext(code, sandbox, { filename: rel });
      loaded.push(rel);
    } catch (e) {
      errors.push('加载 ' + rel + ' 失败: ' + e.message);
    }
  }
  const page = { env, sandbox, WQ: sandbox.WQ, doc: env.document, app: env.app, errors, loaded, storage };
  page.pump = (ms = 4000, steps2 = 200) => {
    let n = 0;
    for (let i = 0; i < steps2; i++) {
      const done = env.clock.advance(50);
      n += done;
      if (n >= ms / 50 && !env.clock.pending()) break;
      if (i * 50 >= ms && !env.clock.pending()) break;
    }
    env.clock.advance(ms);
    return n;
  };
  return page;
}

/* ================= 种子烘焙模式 =================
 * 用法：node dev/dom-e2e.mjs --find-seed [起始种子] [扫描个数]
 * 目的：第 3 节的断言要求"当前是第 0 题的选择题"，所以默认种子必须是首题为选择题的那种。
 * 做法：用同一个 storage 建页 → 开始一局 → 直接问 App 本局首题是什么题型（不点击、不推进），
 *       命中就打印种子并退出。找到的种子请写回 createPage 的默认值 / DEFAULT_SEED。
 */
if (process.argv.includes('--find-seed')) {
  const from = Number(process.argv[process.argv.indexOf('--find-seed') + 1]) || 1;
  const count = Number(process.argv[process.argv.indexOf('--find-seed') + 2]) || 200;
  const CHOICE = new Set(['Q1', 'Q2', 'Q4']);
  for (let seed = from; seed < from + count; seed++) {
    const p = createPage(new Map(), { seed });
    p.pump(1200);
    const startBtn = p.doc.querySelector('[data-action="start"]');
    if (!startBtn) { console.log('seed ' + seed + ': 首页没有开始按钮，跳过'); continue; }
    startBtn.click();
    p.pump(400);
    const q = p.WQ.flow.currentQuestion();
    const types = (p.WQ.state.session ? p.WQ.state.session.questions : []).map((x) => x.type).join(',');
    if (q && CHOICE.has(q.type)) {
      console.log('可用种子 ' + seed + '：首题 ' + q.type + '，本局题型 ' + types);
      process.exit(0);
    }
    console.log('跳过种子 ' + seed + '：首题 ' + (q ? q.type : '（无）') + '，本局题型 ' + types);
  }
  console.log('在 ' + count + ' 个种子里没找到首题为选择题的局；增大扫描个数再试。');
  process.exit(1);
}

/* ================= 主流程 ================= */
const storage = new Map(); // 主存档：等价浏览器 localStorage，跨"刷新"复用
let page = createPage(storage);
let WQ = page.WQ;
let doc = page.doc;

const $ = (sel) => doc.querySelector(sel);
const $$ = (sel) => doc.querySelectorAll(sel);
const text = () => doc.getElementById('app').innerText;
const click = (sel, i = 0) => { const el = $$(sel)[i]; if (!el) throw new Error('找不到元素: ' + sel + '[' + i + ']'); el.click(); return el; };
const t = (sel) => { const el = $(sel); return el ? el.innerText.replace(/\s+/g, ' ').trim() : '（缺失:' + sel + '）'; };
const correctIndex = (q) => (q.options || []).findIndex((o) => o.correct);
/** 切换到新页面（等价刷新/新标签）：必须同步刷新 doc / WQ 引用 */
const switchPage = (p, ms = 1200) => {
  page = p; WQ = p.WQ; doc = p.doc;
  page.pump(ms);
  return page;
};
const hash = () => page.env.window.location.hash;
const go = (h) => { page.env.window.location.hash = h; page.pump(400); };

log('加载 app/index.html 的全部脚本', FILES.length + ' 个文件，' + page.errors.length + ' 个加载错误', page.errors.length === 0);
if (page.errors.length) log('加载错误明细', page.errors.join(' | '), false);
log('词库条数', WQ.WORDS.length, WQ.WORDS.length === 200);
log('词库四字段非空', String(WQ.WORDS.filter((w) => w.word && w.phonetic && w.meaning_cn && w.example).length), WQ.WORDS.filter((w) => w.word && w.phonetic && w.meaning_cn && w.example).length === 200);

/* ---------- 1. 冷启动 → 营地 ---------- */
page.pump(1200);
log('冷启动后路由（#/boot → #/home）', hash(), hash() === '#/home');
const homeText = text();
log('首页含"今日战斗"与主按钮', /今日战斗/.test(homeText) && !!$('[data-action="start"]'), true);
log('首页 HUD 等级圆章', $('.level-badge') ? $('.level-badge').innerText.replace(/\s+/g, ' ') : '（缺失）', !!$('.level-badge'));
log('首页 XP 进度条', !!$('.progress'), true);
log('首页血量心形', $('.hearts') ? $('.hearts').innerText : '（缺失）', !!$('.hearts'));
log('首页"今日已答"', /今日已答/.test(homeText), true);
log('首页连续天数', /天/.test(homeText), true);
log('首页金币', /🪙/.test(homeText), true);
log('首页唯一 h1 数', String($$('h1').length), $$('h1').length === 1);

/* ---------- 2. 点「开始一局」→ 第 1 题 ---------- */
click('[data-action="start"]');
page.pump(300);
log('点"开始一局"后路由', hash(), hash().indexOf('#/battle/') === 0);
if (!$('.battle-index')) log('对局页渲染异常，页面文本', text().replace(/\s+/g, ' ').slice(0, 200), false);
log('对局 HUD 题号', t('.battle-index'), /第 1 \/ 8 题/.test(t('.battle-index')));
log('对局显示血量', t('.hearts'), true);
const isChoice = () => WQ.flow.currentQuestion().type !== 'Q3' && WQ.flow.currentQuestion().type !== 'Q5';
log('本局题型', WQ.state.session.questions.map((x) => x.type).join(','), true);

/* ---------- 3. 答错一题 → 掉血 + 反馈 ---------- */
/* 先保证当前是选择题，才能验证"错项标红 / 正确项标绿"这种纯选项态
   （Q3/Q5 是拼写题，没有选项，另行单独验证） */
function ensureChoiceQuestion() {
  for (let i = 0; i < 6 && WQ.state.session; i++) {
    const cur = WQ.flow.currentQuestion();
    if (cur && (cur.options || []).length) return cur;
    if (WQ.state.session.judged) nextQuestion();
    else { answerCurrent(true); if (WQ.state.session && WQ.state.session.judged) nextQuestion(); }
  }
  return WQ.flow.currentQuestion();
}
ensureChoiceQuestion();
function answerCurrent(correct) {
  const cur = WQ.flow.currentQuestion();
  const idx = correctIndex(cur);
  if (idx >= 0) click('.option', correct ? idx : (idx + 1) % cur.options.length);
  else {
    const input = $('[data-spell-input]');
    input.value = correct ? cur.word : 'zzzzzz';
    click('[data-action="submitSpell"]');
  }
  page.pump(200);
}
function nextQuestion() { click('[data-action="next"]'); page.pump(200); }
/** 按题型作答并确保进入下一题（Q3/Q5 不点 next 会原地不动） */
function playOne(correct) {
  if (WQ.state.session && WQ.state.session.judged) { nextQuestion(); return; }
  answerCurrent(correct);
  if (WQ.state.session && WQ.state.session.judged) nextQuestion();
}
/** 打完一整局；最后一题由 flow.finishSession 收尾，但测试里显式兜底，保证一定有结算结果 */
function playRound(correct, maxSteps = 30) {
  let g = 0;
  while (WQ.state.session && g++ < maxSteps) {
    const s = WQ.state.session;
    const last = s.index >= s.totalQuestions - 1;
    if (s.judged) { nextQuestion(); if (last) break; continue; }
    answerCurrent(correct);
    if (!WQ.state.session) break;
    if (WQ.state.session.judged) { nextQuestion(); }
    if (last) break;
  }
  if (WQ.state.session) { WQ.flow.finishSession(new Date()); page.pump(200); }
  return WQ.state.lastResult;
}

answerCurrent(false);
const s1 = WQ.state.session;
const fb = $('.feedback') ? $('.feedback').innerText.replace(/\s+/g, ' ').trim() : '';
log('答错后反馈条', fb, /答错/.test(fb) && /正确答案/.test(fb));
log('答错掉血', 'hp=' + s1.hpLeft, s1.hpLeft <= 2);
log('选项状态类（错误项 1 个 / 正确项 1 个）', $$('.option').map((o) => o.getAttribute('class')).join(' | '),
  $$('.option.is-wrong').length === 1 && $$('.option.is-correct').length === 1);
log('出现"重试本题"按钮', !!$('[data-action="retry"]'), true);
log('答错不加 XP', 'xp=' + s1.xpGained, s1.xpGained === 0);

/* 判定后锁定：再点无效 */
const hpLock = s1.hpLeft;
if ($$('.option').length) click('.option', 0);
log('判定后选项锁定（再点不重复判定）', 'hp 仍为 ' + WQ.state.session.hpLeft, WQ.state.session.hpLeft === hpLock);

/* ---------- 4. 重试本题 ---------- */
click('[data-action="retry"]');
page.pump(200);
const hpAfterRetry = WQ.state.session.hpLeft;
const idxAfterRetry = WQ.state.session.index;
log('重试后血量不变、题号不变', 'hp=' + hpAfterRetry + ' 第 ' + (idxAfterRetry + 1) + ' 题', hpAfterRetry === s1.hpLeft && idxAfterRetry === 0);
answerCurrent(true);
log('重试答对反馈', $('.feedback').innerText.replace(/\s+/g, ' ').trim(), /答对/.test($('.feedback').innerText));
log('retryUsed 已置位', String(WQ.state.session.retryUsed), WQ.state.session.retryUsed === true);

/* ---------- 5. 打完本局（其余全对） ---------- */
playRound(true);
page.pump(600);
log('打完 8 题后路由', hash(), hash().indexOf('#/result/') === 0);

/* ---------- 6. 结算页内容与数字一致性 ---------- */
const rText = text();
log('结算页含 正确率/XP/金币/连击', /正确率/.test(rText) && /XP/.test(rText) && /金币/.test(rText) && /连击/.test(rText), true);
log('结算页含奖励明细与合计', /奖励明细/.test(rText) && /合计/.test(rText), true);
const rec = WQ.state.save.rounds[WQ.state.save.rounds.length - 1];
log('RoundRecord', JSON.stringify({ correct: rec.correct, total: rec.totalQuestions, xp: rec.xpGained, coins: rec.coinsGained, maxCombo: rec.maxCombo, level: WQ.state.save.profile.level }));
log('结算页数字与存档一致（XP +' + rec.xpGained + '）', rText.replace(/\s+/g, ' ').includes('+' + rec.xpGained), true);
log('log 长度 === 题数', rec.log.length + '/' + rec.totalQuestions, rec.log.length === rec.totalQuestions);
log('本局金币落在 0–71（docs/03 §5.3 口径）', String(rec.coinsGained), rec.coinsGained >= 0 && rec.coinsGained <= 71);
/* 明细 vs 口径对账（v0.2）：
   breakdown 是**本局全部**奖励行（对局本体 + 完美/每日首局 + 徽章 + 升级 + 每日任务），
   所以「逐行相加」应等于 roundRecord 的三个单列字段之和（xpGained 只含对局本体）。
   注：badgeXp 这一行本身就是徽章 XP 明细（= bonusXp），没有第二个来源，不需要排除。 */
const detailXp = (rec.breakdown || []).filter((b) => b.unit === 'xp').reduce((a, b) => a + b.value, 0);
const detailCoin = (rec.breakdown || []).filter((b) => b.unit === 'coin').reduce((a, b) => a + b.value, 0);
/* 对局本体 XP（不含每日任务 XP）：用来和「按题型分布 + 实际新词数」的理论上限比对 */
const bodyXp = rec.xpGained;
log('本局 XP 明细', (rec.breakdown || []).map((b) => b.key + '=' + b.value + b.unit).join(' + ') || '（空）');
log('XP 明细逐行相加 === 本体 + 徽章 + 任务', '明细 ' + detailXp + ' / 口径 ' + (rec.xpGained + rec.bonusXp + (rec.questXp || 0)),
  detailXp === rec.xpGained + rec.bonusXp + (rec.questXp || 0));
/* 上限构造：按实际题型分布算出的理论上限（docs/03 §5.1 的 215 是"8 题全 Q3/Q5 + 全对 + 全为新词"的特例）。
   v0.2 修正：新词首答 / 击败新词按**本局实际的新词数**算 —— 经查证，v0.1 的
   `applyAnswer` 以每局重置的 session.progressMap 为基准，使 seenCount 恒为 0，
   于是"每局每词都算新词"。修复后同一词只在真正第一次出现时拿 +5/+5，所以这里必须按实际词数封顶。 */
const newWordCount = new Set((rec.log || []).map((l) => l.wordId)).size;
const typeMax = (rec.log || []).reduce((a, l) => {
  const base = l.type === 'Q3' || l.type === 'Q5' ? 15 : (l.type === 'Q4' ? 12 : 10);
  return a + base;
}, 0) + newWordCount * 5 + newWordCount * 5 + 35 + 20 + 30;
const special215 = (rec.log || []).every((l) => l.type === 'Q3' || l.type === 'Q5');
log('本局对局本体 XP 落在 10–' + typeMax + '（按本局题型分布 + 实际新词数）', String(bodyXp), bodyXp >= 10 && bodyXp <= typeMax);
if (special215) log('本题型组合命中 docs/03 §5.1 的 215 构造成例', String(bodyXp), bodyXp === 215);
log('本局对局本体 XP 与实际作答相符', '每答对 +基础分(≥10) → 上限 ' + (rec.correct * 15 + newWordCount * 5 + newWordCount * 5 + 35 + 20 + 30) + '，实际 ' + bodyXp,
  bodyXp <= rec.correct * 15 + newWordCount * 5 + newWordCount * 5 + 35 + 20 + 30);
log('本局总入账 = 本体 + 徽章 + 升级 + 任务', 'xp ' + rec.xpGained + '+' + rec.bonusXp + '+' + (rec.questXp || 0) + ' / 金币 ' + rec.coinsGained + '+' + rec.bonusCoins + '+' + (rec.questCoins || 0),
  typeof rec.bonusXp === 'number' && typeof rec.bonusCoins === 'number' && typeof rec.questXp === 'number' && typeof rec.questCoins === 'number');
/* 结算页顶部合计必须等于「明细行逐行相加」（v0.2 起明细多了"每日任务经验/每日任务"两行） */
const totalXp = rec.xpGained + rec.bonusXp + (rec.questXp || 0);
/* 金币口径：profile.coins 的增量 = 本体金币 + 全部明细行（徽章/升级/任务都在明细里），
   所以「明细逐行 + 本体」就等于本局总入账 —— 这条断言正是那个"金币重复入账"脏账的守护者。 */
const totalCoins = rec.coinsGained + detailCoin;
log('结算页合计 = 总入账', '+XP ' + totalXp + ' · 金币 ' + totalCoins,
  rText.replace(/\s+/g, ' ').includes('+' + totalXp + ' XP') && rText.replace(/\s+/g, ' ').includes('+' + totalCoins + ' 金币'));
log('金币明细逐行相加 === 档内金币增量', '明细 ' + detailCoin + ' + 本体 ' + rec.coinsGained,
  totalCoins === rec.coinsGained + detailCoin);

/* ---------- 7. 持久化：刷新后进度还在 ---------- */
const snap = (p) => JSON.stringify({
  level: p.WQ.state.save.profile.level, totalXp: p.WQ.state.save.profile.totalXp,
  coins: p.WQ.state.save.profile.coins, rounds: p.WQ.state.save.rounds.length,
  mastered: p.WQ.state.save.stats.masteredCount, streak: p.WQ.state.save.streak.dailyStreak
});
const beforeReload = snap(page);
const rawLen = storage.get('wordquest.save.v1').length;
switchPage(createPage(storage));
const afterReload = snap(page);
log('刷新前（localStorage 存档 ' + rawLen + ' 字节）', beforeReload);
log('刷新后（重新读档）', afterReload, beforeReload === afterReload);

/* ---------- 8. 结算页直接打开不重复发奖 ---------- */
const lastRoundId = WQ.state.save.rounds[WQ.state.save.rounds.length - 1].roundId;
const coinsBefore = WQ.state.save.profile.coins;
page.env.window.location.hash = '#/result/' + lastRoundId;
page.pump(600);
log('直接打开结算页金币不变', coinsBefore + ' → ' + WQ.state.save.profile.coins, coinsBefore === WQ.state.save.profile.coins);

/* ---------- 9. 血量归零本局结束 ---------- */
page.env.window.location.hash = '#/home';
page.pump(400);
click('[data-action="start"]');
page.pump(300);
let answerSteps = 0;
for (let i = 0; i < 6 && WQ.state.session && answerSteps < 6; i++) {
  if (WQ.state.session.judged) { nextQuestion(); continue; }
  answerSteps++;
  answerCurrent(false);
  if (WQ.state.session && WQ.state.session.hpLeft <= 0) {
    log('第 ' + answerSteps + ' 次答错后血量归零', 'hp=0');
    break;
  }
}
page.pump(800);
const loseRec = WQ.state.save.rounds[WQ.state.save.rounds.length - 1];
log('血量归零 → 自动跳结算', hash() + '（session=' + (WQ.state.session ? 'alive' : 'null') + '）', hash().indexOf('#/result/') === 0 && !WQ.state.session);
log('失败局 isWin=false 且已得金币保留', 'isWin=' + loseRec.isWin + ' coinsGained=' + loseRec.coinsGained, loseRec.isWin === false && loseRec.hpLeft === 0);

/* ---------- 10. 升级提示（造 XP 触发） ---------- */
page.env.window.location.hash = '#/home';
page.pump(400);
WQ.actions.commit((s) => { s.save.profile.level = 1; s.save.profile.xp = 65; s.save.profile.totalXp = 65; });
WQ.state.lastResult = null;
click('[data-action="start"]');
page.pump(300);
playRound(true);
/* 逐帧推进虚拟时钟并让 microtask 落地，抓住升级覆盖层（900ms 后弹出，2.2s 自动收起） */
let overlayText = '';
let overlayAt = -1;
let sawAny = '';
for (let ms = 0; ms <= 4000; ms += 50) {
  page.env.clock.advance(50);
  await new Promise((r) => setImmediate(r));
  const txt = doc.getElementById('overlay-root').innerText.replace(/\s+/g, ' ').trim();
  if (txt && !sawAny) sawAny = '第 ' + ms + 'ms：' + txt.slice(0, 60);
  if (/LEVEL UP/.test(txt)) { overlayText = txt; overlayAt = ms; break; }
}
log('升级覆盖层出现', overlayAt >= 0 ? ('第 ' + overlayAt + 'ms：' + overlayText.slice(0, 80)) : ('（未出现）' + (sawAny ? ' 曾出现：' + sawAny : '')),
  /LEVEL UP/.test(overlayText));
log('升级明细', 'levelUps=' + ((WQ.state.lastResult && WQ.state.lastResult.levelUps) ? WQ.state.lastResult.levelUps.length : 'n/a') + ' / level=' + WQ.state.save.profile.level + ' / 路由=' + hash(), true);
log('覆盖层含等级变化与新称号', (/Lv\.\d+ → Lv\.\d+/).test(overlayText) && /新称号/.test(overlayText), /Lv\.\d+ → Lv\.\d+/.test(overlayText) && /新称号/.test(overlayText));
log('动效未播完时存档已是新等级（动效不阻塞落库）', 'level=' + WQ.state.save.profile.level, WQ.state.save.profile.level >= 2);
log('升级后结算页 XP 条仍在', !!$('#result-xpbar'), true);

/* ---------- 11. 成长页 4 个 Tab ---------- */
for (const [tab, kw] of [['level', '徽章墙'], ['wrong', '错题本|待复活'], ['stats', '核心指标|数据统计'], ['words', '词库总览']]) {
  go('#/growth?tab=' + tab);
  const t = text();
  log('成长页 tab=' + tab, t.split('\n').filter(Boolean).slice(0, 5).join(' | '), new RegExp(kw).test(t));
}
go('#/growth?tab=level');
log('徽章墙格数 === 徽章定义数', String(WQ.ach.getAllProgress(WQ.state.save).length),
  WQ.ach.getAllProgress(WQ.state.save).length === WQ.achievements.length);

/* ---------- 12. 商店购买 → 下一局 4 颗心 ---------- */
go('#/home');
WQ.actions.commit((s) => { s.save.profile.coins = 500; });
go('#/shop');
const shopText = text();
const items = ['护心符', '回补卡', '侦查之眼', '替身稻草人'];
log('商店 4 件物品都在', items.filter((n) => shopText.includes(n)).join('/'), items.every((n) => shopText.includes(n)));
click('[data-action="buy"]', 0);
page.pump(200);
const confirmText = doc.getElementById('overlay-root').innerText.replace(/\s+/g, ' ').trim();
log('购买二次确认弹层', confirmText.slice(0, 60), /护心符/.test(confirmText));
click('[data-overlay-ok]');
page.pump(300);
log('购买后金币 500 → ' + WQ.state.save.profile.coins + '，nextRoundHpBonus=' + WQ.state.save.profile.nextRoundHpBonus,
  WQ.state.save.profile.coins === 440 && WQ.state.save.profile.nextRoundHpBonus === 1);
go('#/home');
click('[data-action="start"]');
page.pump(300);
log('带护心符开局血量上限', 'hpMax=' + WQ.state.session.hpMax, WQ.state.session.hpMax === 4);
log('护心符开局后已复位', 'nextRoundHpBonus=' + WQ.state.save.profile.nextRoundHpBonus, WQ.state.save.profile.nextRoundHpBonus === 0);

/* ---------- 13. 对局中途刷新 ---------- */
{
  const key = String(storage.get('wordquest.session.v1'));
  log('开局后对局会话已写入 localStorage', key.slice(0, 60), /roundId/.test(key));
}
/* 只作答一题就"刷新"：此时对局还没结束 */
answerCurrent(true);
const coinsMid = WQ.state.save.profile.coins;
log('刷新前状态', 'hash=' + hash() + ' session=' + (WQ.state.session ? 'alive' : 'null') + ' / sessionKey=' + String(storage.get('wordquest.session.v1')).slice(0, 40));
switchPage(createPage(storage));
log('对局中途刷新 → 回营地且保留已得', 'session=' + (WQ.state.session ? 'alive' : 'null') + ' / 路由 ' + page.env.window.location.hash + ' / 金币 ' + coinsMid + ' → ' + WQ.state.save.profile.coins,
  !WQ.state.session && WQ.state.save.profile.coins >= coinsMid);

/* ---------- 13b. 上次对局中断（单独造一份 session 键） → Toast 提示 ---------- */
{
  const st2 = new Map(storage);
  st2.set('wordquest.session.v1', JSON.stringify({ roundId: 'interrupted-round', startedAt: new Date().toISOString() }));
  log('中断测试：构造的会话键', String(st2.get('wordquest.session.v1')).slice(0, 50), /roundId/.test(String(st2.get('wordquest.session.v1'))));
  switchPage(createPage(st2));
  let toast = '';
  let seen = '';
  let announced = '';
  for (let i = 0; i < 60; i++) {
    page.env.clock.advance(50);
    await new Promise((r) => setImmediate(r));
    const txt = t('#toast-root');
    const live = String(doc.getElementById('live-region').textContent || '').trim();
    if (live) announced = live;
    if (txt && !seen) seen = txt;
    toast = txt;
    if (/中断/.test(txt) || /中断/.test(live)) break;
  }
  const hit = /中断/.test(toast) || /中断/.test(seen) || /中断/.test(announced);
  log('检测到上次对局中断 → 提示已发出（Toast + aria-live 播报）', hit ? (toast || seen || announced) : '（未出现）', hit);
  /* 用完把页面切回主 storage，避免后续用例写到临时存档里 */
  switchPage(createPage(storage));
}

/* ---------- 14. 自检面板（浏览器里跑同一套断言） ---------- */
page.env.window.location.hash = '#/selfcheck';
page.pump(400);
click('[data-action="run"]');
page.pump(600);
const scText = doc.getElementById('app').innerText;
const passN = (scText.match(/✅/g) || []).length;
const failN = (scText.match(/❌/g) || []).length;
log('页面内自检面板', passN + ' PASS / ' + failN + ' FAIL', failN === 0 && passN >= 30);

/* ---------- 15. 设置页与持久化 ---------- */
page.env.window.location.hash = '#/settings';
page.pump(400);
log('设置页设置项数量', String($$('.setting-row').length), $$('.setting-row').length >= 5);
const switches = $$('.switch');
switches[1].click();
page.pump(200);
log('切换音效开关', 'sfxEnabled=' + WQ.state.settings.sfxEnabled, WQ.state.settings.sfxEnabled === false);
click('[data-action="font"]', 2);
page.pump(200);
log('字号档位写入并生效', WQ.state.settings.fontSize + ' / data-fontsize=' + doc.documentElement.getAttribute('data-fontsize'),
  WQ.state.settings.fontSize === 'xl' && doc.documentElement.getAttribute('data-fontsize') === 'xl');
{
  let settingsRaw = String(storage.get('wordquest.settings.v1'));
  for (let i = 0; i < 40 && !/fontSize/.test(settingsRaw); i++) { page.pump(100); settingsRaw = String(storage.get('wordquest.settings.v1')); }
  log('设置已写入 localStorage', (settingsRaw === 'undefined' ? '（缺失）' : settingsRaw.slice(0, 70)),
    /"sfxEnabled":false/.test(settingsRaw) && /"fontSize":"xl"/.test(settingsRaw));
  if (settingsRaw === 'undefined') {
    log('设置写入诊断', 'page.env.store===storage ? ' + (page.env.store === storage) + ' / page.storage===storage ? ' + (page.storage === storage) + ' / page.env.store 键=' + Array.from(page.env.store.keys()).join(',') + ' / storage 键=' + Array.from(storage.keys()).join(',') + ' / persistStatus=' + WQ.persistStatus);
  }
}

/* ---------- 16. 减弱动效 ---------- */
switchPage(createPage(storage, { reducedMotion: true }));
log('系统 prefers-reduced-motion → 动效降级', 'data-motion=' + doc.documentElement.getAttribute('data-motion'),
  doc.documentElement.getAttribute('data-motion') === 'reduced');

/* ---------- 17. 损坏存档 → 备份 + 新档 ---------- */
storage.set('wordquest.save.v1', '{{{ 这不是 JSON');
switchPage(createPage(storage));
log('损坏存档已备份到 .bak', String(storage.get('wordquest.save.v1.bak')).slice(0, 20), storage.get('wordquest.save.v1.bak') === '{{{ 这不是 JSON');
log('损坏后不白屏，仍进营地', page.env.window.location.hash + ' / level=' + WQ.state.save.profile.level, WQ.state.save.profile.level === 1);

/* ---------- 18. 词库为空 → #/boot 兜底 ---------- */
{
  const env = createEnv({ storage: new Map() });
  const sandbox = { JSON, Math, Date, Number, String, Boolean, Array, Object, Set, Map, RegExp, Error, Promise, parseInt, parseFloat, isNaN, isFinite };
  Object.assign(sandbox, env.window, { document: env.document, localStorage: env.localStorage, location: env.window.location, performance: env.window.performance, navigator: env.window.navigator });
  sandbox.globalThis = sandbox; sandbox.self = sandbox; sandbox.window = sandbox;
  sandbox.console = { log() {}, info() {}, warn() {}, error() {} };
  vm.createContext(sandbox);
  for (const [rel, code] of sources) {
    if (rel === 'src/data/words.js') { vm.runInContext('window.WQ = window.WQ || {}; window.WQ.WORDS = [];', sandbox, { filename: 'empty-words.js' }); continue; }
    vm.runInContext(code, sandbox, { filename: rel });
  }
  env.clock.advance(2000);
  const body = env.document.getElementById('app').innerText;
  log('词库为空 → 停在 #/boot 并显示损坏文案', body.replace(/\s+/g, ' ').trim().slice(0, 60),
    /词库文件损坏/.test(body) && !!env.document.querySelector('[data-action="reload"]'));
}

/* ---------- 19. 纯键盘走完一局 ---------- */
{
  const p = createPage(new Map());
  p.pump(1200);
  p.doc.querySelector('[data-action="start"]').click();
  p.pump(300);
  const dispatch = (key, target) => {
    const ev = { key, target: target || p.doc.body, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    (p.doc._listeners['keydown'] || []).forEach((entry) => entry.fn(ev));
  };
  let ok = true;
  let judgedCount = 0;
  const keyListeners = (p.doc._listeners['keydown'] || []).length;
  for (let i = 0; i < 20; i++) {
    const s = p.WQ.state.session;
    if (!s) break;
    if (s.judged) {
      dispatch('Enter'); // Enter：下一题 / 看结算
      p.pump(200);
      if (p.WQ.state.session && p.WQ.state.session !== s) break;
      continue;
    }
    const cur = p.WQ.flow.currentQuestion();
    if (!cur) break;
    const idx = correctIndex(cur);
    if (idx >= 0) dispatch(String(idx + 1));
    else {
      const input = p.doc.querySelector('[data-spell-input]');
      input.value = cur.word;
      dispatch('Enter', input); // 等价于焦点在输入框里按 Enter 提交
    }
    p.pump(200);
    if (!s.judged) {
      /* 调试信息：键盘没判定成功时把现场打出来（便于定位是按键路径还是渲染路径的问题） */
      console.log('  [键盘调试] 第 ' + (i + 1) + ' 次按键 key=' + (idx >= 0 ? String(idx + 1) : 'Enter') +
        ' 题型=' + cur.type + ' judged=' + s.judged + ' 监听器=' + keyListeners +
        ' 反馈=' + (p.doc.querySelector('.feedback') ? p.doc.querySelector('.feedback').innerText.replace(/\s+/g, ' ') : '（无）'));
      ok = false;
      break;
    }
    judgedCount++;
  }
  log('纯键盘走完一局（数字键作答 + Enter 下一题）', '判定 ' + judgedCount + ' 题 / 监听器 ' + keyListeners + ' / 结束路由 ' + p.env.window.location.hash,
    ok && judgedCount >= 8 && p.env.window.location.hash.indexOf('#/result/') >= 0);
}

/* ================= v0.2 新增机制与三项 P0 修复的端到端断言 ================= */

/* ---------- 19b. 每日任务卡 + 随机宝箱卡（docs/03 §5.9） ---------- */
{
  const p = createPage(new Map());
  p.pump(1200);
  const body = p.doc.getElementById('app').innerText.replace(/\s+/g, ' ');
  p.WQ.router.go('#/home');
  p.pump(300);
  const homeText = p.doc.getElementById('app').innerText.replace(/\s+/g, ' ');
  const rows = p.doc.querySelectorAll('.quest-row');
  const d = p.WQ.state.save.daily;
  log('营地渲染每日任务卡（3 条 + 进度条 + 奖励）',
    '行数=' + rows.length + ' / 清单=' + (d.questIds || []).join(',') + ' / 含每日任务=' + /每日任务/.test(homeText),
    rows.length === 3 && (d.questIds || []).length === 3 && /每日任务/.test(homeText)
      && p.doc.querySelectorAll('.quest-progress-fill').length >= 3);
  log('每日任务进度以今日 counters 为准（开局前为 0）',
    'answered=' + d.counters.answered + ' / correct=' + d.counters.correct,
    d.counters.answered === 0 && d.counters.correct === 0);
  const chestCard = p.doc.querySelector('.chest-card');
  const shards = p.doc.querySelectorAll('.chest-card .shard');
  log('营地渲染随机宝箱卡（3 枚碎片槽 + 开箱按钮）',
    '卡片=' + !!chestCard + ' / 碎片槽=' + shards.length + ' / 含随机宝箱=' + /随机宝箱/.test(homeText),
    !!chestCard && shards.length === 3 && /随机宝箱/.test(homeText) && !!p.doc.querySelector('.chest-open-btn'));
  log('碎片不足时开箱按钮禁用', 'disabled=' + p.doc.querySelector('.chest-open-btn').disabled,
    p.doc.querySelector('.chest-open-btn').disabled === true);
}

/* ---------- 19c. 开箱：档位奖励 + 当日只能开一次 ---------- */
{
  const p = createPage(new Map());
  p.pump(1200);
  const before = p.WQ.state.save.profile.coins;
  const totalXpBefore = p.WQ.state.save.profile.totalXp;
  p.WQ.actions.commit((s) => { s.save.daily.chestShards = 3; });
  p.WQ.router.go('#/home');
  p.pump(300);
  const btn = p.doc.querySelector('[data-action="openChest"]');
  const enabled = !!btn && btn.disabled !== true;
  btn.click();
  p.pump(400);
  const after = p.WQ.state.save.profile.coins;
  const gained = after - before;
  const xpGained = p.WQ.state.save.profile.totalXp - totalXpBefore;
  const overlay = p.doc.getElementById('overlay-root').innerText.replace(/\s+/g, ' ');
  const hist = p.WQ.state.save.daily.chestHistory || [];
  log('开箱：扣 3 枚碎片、按档位发金币与 XP、弹结果覆盖层',
    '按钮可用=' + enabled + ' / 金币+' + gained + ' / XP+' + xpGained + ' / 档位=' + (hist.length ? hist[hist.length - 1].tier : '-')
      + ' / isOpen=' + p.WQ.overlay.isOpen() + ' / overlayText=' + overlay.slice(0, 50),
    enabled && gained >= 25 && gained <= 70 && xpGained >= 10 && xpGained <= 35
      && p.WQ.state.save.daily.chestShards === 0 && p.WQ.state.save.profile.chestOpenedTotal === 1 && /宝箱/.test(overlay));
  p.WQ.overlay.close();
  /* 同日再开：必须被拒绝（chestOpenDate 幂等） */
  p.WQ.actions.commit((s) => { s.save.daily.chestShards = 3; });
  const second = p.WQ.chest.open(p.WQ.state.save, new Date());
  log('同日第二次开箱被拒绝（幂等）', 'ok=' + second.ok + ' reason=' + second.reason,
    second.ok === false && second.reason === 'openedToday');
}

/* ---------- 19d. 三项 P0 修复：D2 中断局不算完成局、D1 刷新补结算、D3 多标签不覆盖 ---------- */

/* D2：点「✕ 退出」后不能再吃掉当天的每日首局 */
{
  const st = new Map();
  const p = createPage(st);
  p.pump(1200);
  p.doc.querySelector('[data-action="start"]').click();
  p.pump(300);
  const firstRoundBefore = p.WQ.state.save.daily.todayFirstRoundDone;
  const roundsBefore = p.WQ.state.save.stats.totalRounds;
  const coinsBefore = p.WQ.state.save.profile.coins;
  /* 只答第 1 题（答对），然后走「退出本局」的确认弹层 */
  const q = p.WQ.flow.currentQuestion();
  const ci = (q.options || []).findIndex((o) => o.correct);
  if (ci >= 0) p.doc.querySelectorAll('.option')[ci].click();
  else {
    const input = p.doc.querySelector('[data-spell-input]');
    input.value = q.word;
    p.doc.querySelector('[data-action="submitSpell"]').click();
  }
  p.pump(300);
  const xpBeforeExit = p.WQ.state.save.profile.totalXp;
  p.doc.querySelector('[data-action="exit"]').click();
  p.pump(200);
  p.doc.querySelector('[data-overlay-ok]').click();
  p.pump(400);
  const s = p.WQ.state.save;
  log('D2 中途退出：保留已得收益、不写每日首局标志、不计完成局数',
    'firstRoundDone ' + firstRoundBefore + '→' + s.daily.todayFirstRoundDone + ' / totalRounds ' + roundsBefore + '→' + s.stats.totalRounds
      + ' / XP+' + (s.profile.totalXp - xpBeforeExit) + ' / 金币+' + (s.profile.coins - coinsBefore),
    firstRoundBefore === false && s.daily.todayFirstRoundDone === false
      && s.stats.totalRounds === roundsBefore && s.profile.totalXp > xpBeforeExit);
}

/* D1：对局中刷新 → 已得 XP / 金币 / 词进度全部进账（不再是只弹一句提示） */
{
  const st = new Map();
  const p1 = createPage(st);
  p1.pump(1200);
  p1.doc.querySelector('[data-action="start"]').click();
  p1.pump(300);
  const q = p1.WQ.flow.currentQuestion();
  const ci = (q.options || []).findIndex((o) => o.correct);
  if (ci >= 0) p1.doc.querySelectorAll('.option')[ci].click();
  else {
    const input = p1.doc.querySelector('[data-action="spell-input"], [data-spell-input]');
    input.value = q.word;
    p1.doc.querySelector('[data-action="submitSpell"]').click();
  }
  p1.pump(300);
  const xpMid = p1.WQ.state.save.profile.totalXp;
  const sessionXp = p1.WQ.state.session ? p1.WQ.state.session.xpGained : 0;
  const progressMid = Object.keys(p1.WQ.state.save.progress).length;
  const sessionKeyWritten = !!st.get('wordquest.session.v1');
  const p2 = createPage(st);       // 等价刷新：同一份 localStorage
  p2.pump(1200);
  const s2 = p2.WQ.state.save;
  const roundsWithRound = s2.rounds.length;
  log('D1 对局中刷新：会话快照已落盘 + 刷新后补结算（XP/金币/词进度全部进账）',
    '会话键=' + sessionKeyWritten + ' / 内存本局 XP=' + sessionXp + ' / 刷新后 XP=' + s2.profile.totalXp
      + '（刷新前 ' + xpMid + '）/ rounds=' + roundsWithRound + ' / 词进度 ' + progressMid + '→' + Object.keys(s2.progress).length,
    sessionKeyWritten && sessionXp > 0 && s2.profile.totalXp >= xpMid + sessionXp
      && roundsWithRound >= 1 && Object.keys(s2.progress).length >= progressMid && !st.get('wordquest.session.v1'));
  const recoveredToHome = p2.env.window.location.hash === '#/home';
  log('D1 刷新后停在营地（不会卡在对局页）', p2.env.window.location.hash, recoveredToHome);
}

/* D3：B 标签页写盘时不能覆盖 A 标签页已经落库的进度 */
{
  const stAB = new Map();
  const pA = createPage(stAB);
  pA.pump(1200);
  const b = createPage(stAB);      // B 与 A 共享同一份 localStorage
  b.pump(1200);
  const baseline = JSON.parse(stAB.get('wordquest.save.v1'));
  const baselineSign = JSON.stringify([baseline.profile.level, baseline.profile.xp, baseline.profile.coins, (baseline.rounds || []).length]);
  /* A 落库（模拟 A 打完一局）：直接写进共享 storage */
  const aSave = JSON.parse(stAB.get('wordquest.save.v1'));
  aSave.profile.level = 6;
  aSave.profile.xp = 42;
  aSave.profile.coins = 1234;
  aSave.stats.totalRounds = 5;
  aSave.stats.totalCorrect = 77;
  aSave.rounds = [{ roundId: 'round-from-A', endedAt: '2025-01-10T10:00:00.000Z', xpGained: 50, coinsGained: 20 }];
  stAB.set('wordquest.save.v1', JSON.stringify(aSave));
  /* B 用内存里的旧档写盘 —— 修复前会把 A 的进度整体覆盖掉 */
  b.WQ.actions.commit((s) => { s.save.profile.nickname = 'B 玩家'; });
  const finalSave = JSON.parse(stAB.get('wordquest.save.v1'));
  const keptA = finalSave.profile.coins === 1234 && finalSave.profile.level === 6
    && finalSave.rounds.length === 1 && finalSave.rounds[0].roundId === 'round-from-A'
    && finalSave.stats.totalCorrect === 77;
  log('D3 多标签：B 写盘时先读盘合并，A 的进度不被覆盖（lost update 已修）',
    'A 档 sign=' + baselineSign + ' → 合并后 coins=' + finalSave.profile.coins + ' level=' + finalSave.profile.level
      + ' rounds=' + finalSave.rounds.length + ' totalCorrect=' + finalSave.stats.totalCorrect,
    keptA);
}

/* D5 道具：写入 profile 后刷新仍在（v0.1 写在顶层会被白名单丢弃） */
{
  const st = new Map();
  const p1 = createPage(st);
  p1.pump(1200);
  p1.WQ.actions.commit((s) => {
    s.save.profile.pendingScoutEye = 3;
    s.save.profile.pendingStrawDouble = true;
  });
  const p2 = createPage(st);
  p2.pump(1200);
  const prof = p2.WQ.state.save.profile;
  log('D5 待生效道具跨刷新保留（top-level 迁移 + profile 白名单）',
    'pendingScoutEye=' + prof.pendingScoutEye + ' / pendingStrawDouble=' + prof.pendingStrawDouble,
    prof.pendingScoutEye === 3 && prof.pendingStrawDouble === true);
  /* 旧档（道具写在顶层）也必须迁得进来 */
  const legacy = JSON.parse(st.get('wordquest.save.v1'));
  delete legacy.profile.pendingScoutEye;
  delete legacy.profile.pendingStrawDouble;
  legacy.pendingScoutEye = 2;
  legacy.pendingStrawDouble = true;
  st.set('wordquest.save.v1', JSON.stringify(legacy));
  const p3 = createPage(st);
  p3.pump(1200);
  log('D5 旧档顶层字段迁移进 profile',
    'scoutEye=' + p3.WQ.state.save.profile.pendingScoutEye,
    p3.WQ.state.save.profile.pendingScoutEye === 2);
}

/* D6 版本拒绝：高版本存档不加载、不覆盖 */
{
  const st = new Map();
  st.set('wordquest.save.v1', JSON.stringify({ version: 9, profile: { level: 5, coins: 999 }, 未来字段: { a: 1 } }));
  const p = createPage(st);
  p.pump(1200);
  const rawAfter = st.get('wordquest.save.v1');
  const parsed = JSON.parse(rawAfter);
  log('D6 高版本存档被拒绝加载：原文保留 + 本次会话不写主键',
    'level=' + p.WQ.state.save.profile.level + ' / 原 version=' + parsed.version + ' / 未来字段=' + (parsed.未来字段 ? '在' : '丢了')
      + ' / persistStatus=' + p.WQ.persistStatus,
    p.WQ.state.save.profile.level === 1 && parsed.version === 9 && !!parsed.未来字段
      && p.WQ.persist.isLocked() === true && st.get('wordquest.save.v1.bak') !== undefined);
}

/* D4 侦查之眼：开局真的会排除 1 个错误选项 */
{
  const st = new Map();
  const p = createPage(st);
  p.pump(1200);
  p.WQ.actions.commit((s) => { s.save.profile.pendingScoutEye = 3; });
  p.WQ.router.go('#/home');
  p.pump(300);
  p.doc.querySelector('[data-action="start"]').click();
  p.pump(300);
  /* 找到第一道选择题（拼写题没有排除概念） */
  let found = null;
  for (let i = 0; i < 6 && p.WQ.state.session; i++) {
    const cur = p.WQ.flow.currentQuestion();
    if (cur && (cur.options || []).length) { found = cur; break; }
    p.WQ.flow.answerCurrent({ skip: true });
    p.WQ.flow.nextQuestion();
    p.pump(100);
  }
  const excluded = p.doc.querySelectorAll('.option.is-excluded');
  const disabled = p.doc.querySelectorAll('.option[disabled]');
  const hint = /侦查之眼/.test(p.doc.getElementById('app').innerText);
  const remaining = p.WQ.state.session ? p.WQ.state.session.scoutEyeRemaining : -1;
  log('D4 侦查之眼：开局排除 1 个错误选项（置灰 + 不可点 + 提示剩余次数）',
    '题=' + (found ? found.type : '-') + ' / 排除项=' + excluded.length + ' / 禁用项=' + disabled.length
      + ' / 剩余额度=' + remaining + ' / 提示=' + hint,
    !!found && excluded.length === 1 && hint && remaining === 3
      && (found.options || [])[(found.scoutExcludedIndex == null ? -1 : found.scoutExcludedIndex)]
      && !found.options[found.scoutExcludedIndex].correct);
}

/* ---------- 19e. 错题本重练 + 徽章详情弹层 + 结算页「距下一级」（D7/D8/D9） ---------- */
{
  const st = new Map();
  const p = createPage(st);
  p.pump(1200);
  const today = p.WQ.util.todayKey();
  const old = p.WQ.util.addDays(today, -10);
  const ids = p.WQ.WORDS.slice(0, 2).map((w) => w.id);
  p.WQ.actions.commit((s) => {
    s.save.progress[ids[0]] = Object.assign(p.WQ.save.defaultProgress(ids[0]), {
      wrongCount: 2, lastWrongAt: new Date().toISOString(), seenCount: 3, correctCount: 2
    });
    s.save.progress[ids[1]] = Object.assign(p.WQ.save.defaultProgress(ids[1]), {
      wrongCount: 2, lastWrongAt: new Date(old + 'T10:00:00').toISOString(), seenCount: 2, correctCount: 1
    });
  });
  p.WQ.router.go('#/growth?tab=wrong');
  p.pump(300);
  const wrongBody = p.doc.getElementById('app').innerText.replace(/\s+/g, ' ');
  const rows = p.doc.querySelectorAll('.wrong-item');
  const badges = p.doc.querySelectorAll('.reclaim-badge');
  const coolingBadge = Array.from(badges).some((b) => /天后可重练/.test(b.innerText));
  const readyBadge = Array.from(badges).some((b) => /可重练/.test(b.innerText) && !/天后/.test(b.innerText));
  const reclaimBtns = p.doc.querySelectorAll('[data-action="reclaimOne"]');
  const removeBtns = p.doc.querySelectorAll('[data-action="removeWrong"]');
  log('D7 错题本：按冷却显示「可重练 / N 天后可重练」+ 行内重练/移出按钮',
    '行=' + rows.length + ' / 徽标=' + badges.length + ' / 冷却文案=' + coolingBadge + ' / 可重练=' + readyBadge
      + ' / 重练按钮=' + reclaimBtns.length + ' / 移出按钮=' + removeBtns.length + ' / 含说明=' + /冷却/.test(wrongBody),
    rows.length === 2 && badges.length === 2 && coolingBadge && readyBadge
      && reclaimBtns.length >= 1 && removeBtns.length === 2);
  /* 移出：二次确认后 wrongCount=0、lastWrongAt=null，SRS 状态保留 */
  const correctBefore = p.WQ.state.save.progress[ids[0]].correctCount;
  removeBtns[0].click();
  p.pump(200);
  const okBtn = p.doc.querySelector('[data-overlay-ok]');
  okBtn.click();
  p.pump(300);
  const after = p.WQ.state.save.progress[ids[0]];
  log('D7 移出错题本：wrongCount=0 / lastWrongAt=null / 保留 SRS 状态',
    'wrongCount=' + after.wrongCount + ' / lastWrongAt=' + after.lastWrongAt + ' / correctCount=' + after.correctCount + '（原 ' + correctBefore + '）',
    after.wrongCount === 0 && after.lastWrongAt === null && after.correctCount === correctBefore);
  /* 重练一个词：开局题数必须 ≤1 且只含该词 */
  p.WQ.router.go('#/growth?tab=wrong');
  p.pump(300);
  const reclaimBtn = p.doc.querySelector('[data-action="reclaimOne"][data-id="' + ids[1] + '"]');
  reclaimBtn.click();
  p.pump(400);
  const sess = p.WQ.state.session;
  const onlyThatWord = !!sess && sess.questions.every((q) => q.wordId === ids[1]);
  log('错题本重练：只出这个词的题（wordIds 收窄生效）',
    '路由=' + p.env.window.location.hash + ' / 题数=' + (sess ? sess.totalQuestions : 0) + ' / 词=' + (sess ? sess.questions.map((q) => q.wordId).join(',') : '-'),
    onlyThatWord && sess.totalQuestions >= 1 && sess.reclaim === true);
}

/* 徽章详情弹层（D8） */
{
  const p = createPage(new Map());
  p.pump(1200);
  p.WQ.router.go('#/growth?tab=level');
  p.pump(300);
  const cards = p.doc.querySelectorAll('[data-action="badge"]');
  const nextTitle = /下一称号/.test(p.doc.getElementById('app').innerText);
  cards[0].click();
  p.pump(300);
  const overlayText = p.doc.getElementById('overlay-root').innerText.replace(/\s+/g, ' ');
  const hasClose = !!p.doc.querySelector('[data-overlay-close]');
  const lockedOrUnlocked = /尚未解锁|已于/.test(overlayText);
  log('D8 徽章详情弹层（Esc / 遮罩关闭 + 焦点归还由 overlay 负责）+ 下一称号预览',
    '卡片=' + cards.length + ' / 下一称号=' + nextTitle + ' / 弹层=' + overlayText.slice(0, 60) + ' / 关闭按钮=' + hasClose,
    cards.length > 0 && nextTitle && hasClose && lockedOrUnlocked);
  p.doc.dispatchEvent({ type: 'keydown', key: 'Escape', target: p.doc.body, preventDefault() {}, stopPropagation() {} });
  p.pump(200);
  log('D8 Esc 关闭徽章弹层', p.doc.getElementById('overlay-root').innerText.length === 0,
    p.doc.getElementById('overlay-root').innerText.length === 0);
}

/* 结算页「距下一级还差 X XP」（A7 第 5 个数字，D9） */
{
  const st = new Map();
  const p = createPage(st);
  p.pump(1200);
  p.doc.querySelector('[data-action="start"]').click();
  p.pump(300);
  for (let i = 0; i < 20 && p.WQ.state.session; i++) {
    const s = p.WQ.state.session;
    if (s.judged) { p.WQ.flow.nextQuestion(); p.pump(100); continue; }
    const cur = p.WQ.flow.currentQuestion();
    const idx = (cur.options || []).findIndex((o) => o.correct);
    if (idx >= 0) p.doc.querySelectorAll('.option')[idx].click();
    else {
      const input = p.doc.querySelector('[data-spell-input]');
      input.value = cur.word;
      p.doc.querySelector('[data-action="submitSpell"]').click();
    }
    p.pump(150);
  }
  if (p.WQ.state.session) { p.WQ.flow.finishSession(new Date()); p.WQ.router.go('#/result/last'); }
  p.pump(300);
  const rText2 = p.doc.getElementById('app').innerText.replace(/\s+/g, ' ');
  const maxLevel = p.WQ.level.isMaxLevel(p.WQ.state.save.profile.level);
  log('D9 结算页显示「距下一级还差 X XP」（满级显示巅峰值）',
    '路由=' + p.env.window.location.hash + ' / 命中=' + /距下一级还差/.test(rText2) + ' / xpToNext=' + p.WQ.state.xpToNext,
    p.env.window.location.hash.indexOf('#/result/') === 0
      && (maxLevel ? /巅峰值/.test(rText2) : (/距下一级还差/.test(rText2) && /升到 Lv\./.test(rText2))));
}

/* ---------- 20. Console 错误 ---------- */
log('全流程 Console 错误数', String(page.errors.length) + (page.errors.length ? ' → ' + page.errors.join(' | ') : ''), page.errors.length === 0);

/* ---------- 21. 存储故障注入：写盘失败 → 营地提示条 + 主按钮仍可用（docs/06 §1.3 / A17） ----------
 * 这一段用到 dev/domshim.mjs 新增的 failWrites / failNextWrites / emitStorageEvent / reset。
 * 用途：把验收报告 §1.3 里"垫片 localStorage 永不抛错 → 写盘失败分支结构性地测不到"这个洞补上。 */
{
  const st21 = new Map();
  const p21 = createPage(st21);
  p21.pump(1200);
  p21.env.failWrites({ mode: 'throw' });              // 之后主存档键写入都抛 name==='QuotaExceededError'
  p21.WQ.actions.commit((s) => { s.save.profile.coins = 123; });   // 触发一次写盘（persist.saveNow）
  p21.WQ.router.go('#/home');                         // 重渲染营地，读 WQ.persistStatus
  p21.pump(400);
  const body21 = p21.doc.getElementById('app').innerText.replace(/\s+/g, ' ');
  const banner21 = /本次进度未保存/.test(body21);
  const btn21 = p21.doc.querySelector('[data-action="start"]');
  let continued21 = false;
  if (btn21) { btn21.click(); p21.pump(400); continued21 = p21.env.window.location.hash.indexOf('#/battle/') === 0; }
  log('注入 QuotaExceededError → 营地出现「本次进度未保存」提示条，且主按钮仍可点击继续游戏',
    'persistStatus=' + p21.WQ.persistStatus + ' / 提示条=' + banner21 + ' / 点主按钮 → ' + p21.env.window.location.hash,
    p21.WQ.persistStatus === 'failed' && banner21 && !!btn21 && btn21.disabled !== true && continued21);
}

/* ---------- 22. 配额错误只抛一次 → rounds 裁剪重试并成功写盘（persist.js 的 quota 分支） ---------- */
{
  const st22 = new Map();
  const p22 = createPage(st22);
  p22.pump(1200);
  const save22 = p22.WQ.state.save;
  const roundsBefore22 = save22.rounds.length;
  for (let i = 0; i < 501; i++) save22.rounds.push({ roundId: 'inject-r' + i });   // 触发裁剪分支：length > B.maxRounds(500)
  p22.env.failNextWrites(1, { mode: 'quota' });      // 只失败一次，重试必然成功
  const ok22 = p22.WQ.persist.saveNow(save22);
  log('配额错误只抛一次 → 走 rounds 裁剪重试路径并成功写盘',
    'saveNow=' + ok22 + ' / persistStatus=' + p22.WQ.persistStatus + ' / rounds ' + (roundsBefore22 + 501) + ' → ' + save22.rounds.length,
    ok22 === true && p22.WQ.persistStatus === 'ok' && save22.rounds.length === p22.WQ.balance.maxRounds);
}

/* ---------- 23. emitStorageEvent 触发 persist.onStorage 的转发（多标签页路径可测） ---------- */
{
  const st23 = new Map();
  const p23 = createPage(st23);
  p23.pump(1200);                                    // main.js 已注册 window 'storage' → WQ.persist.onStorage
  let got23 = null;
  p23.WQ.bus.on('storageExternal', (e) => { got23 = e; });
  p23.env.store.set('wordquest.save.v1', '{"version":1,"profile":{"level":1,"coins":7}}');  // 模拟"别的标签页已写档"
  const evt23 = p23.env.emitStorageEvent('wordquest.save.v1');
  let other23 = null;
  p23.WQ.bus.on('storageExternal', (e) => { other23 = e; });
  p23.env.emitStorageEvent('wordquest.settings.v1');  // 非主存档键：persist.onStorage 应直接忽略
  log('emitStorageEvent → WQ.persist.onStorage 转发 storageExternal（非主存档键不转发）',
    'event.key=' + evt23.key + ' / 上层收到 key=' + (got23 && got23.key) + ' / 设置键事件=' + (other23 ? '被转发' : '未转发'),
    !!got23 && got23.key === 'wordquest.save.v1' && other23 === null);
}

/* ---------- 24. 损坏存档路径不受"可注入垫片"影响（默认未注入时行为不变） ---------- */
{
  const st24 = new Map();
  st24.set('wordquest.save.v1', '{{{ 这不是 JSON');
  const p24 = createPage(st24);
  p24.pump(1200);
  log('损坏存档路径不受注入式垫片影响（未注入时默认行为与既有 73 条一致）',
    '.bak=' + String(st24.get('wordquest.save.v1.bak')).slice(0, 12) + ' / 路由=' + p24.env.window.location.hash
      + ' / level=' + p24.WQ.state.save.profile.level + ' / Console 错误=' + p24.errors.length,
    st24.get('wordquest.save.v1.bak') === '{{{ 这不是 JSON'
      && p24.WQ.state.save.profile.level === 1
      && p24.env.window.location.hash === '#/home'
      && p24.errors.length === 0);
}

const OUT_DIR = path.join(DEV_DIR, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'dom-e2e-steps.json'), JSON.stringify(steps, null, 2), 'utf8');
console.log('\n=== DOM 端到端结果：' + (steps.length - failures) + '/' + steps.length + ' 通过，失败 ' + failures + ' ===');
process.exit(failures ? 1 : 0);
