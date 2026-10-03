/* dev/sim-economy.mjs · A8「30 天经济模拟」验收脚本（开发期工具，非运行时依赖）
 * 依赖：node:fs / node:vm / node:path / node:url（零 npm、零新依赖、零子进程）
 * 用法：node dev/sim-economy.mjs [选项]
 *
 * 目的：补上 docs/01 §9 A8 与 docs/03 §5.5 要求、但 v0.1 一直缺失的 `simulate(30,1,0.75)`
 *       （docs/06-验收报告 §4-D11：「金币经济的不通胀/不买空限购结论零证据」）。
 *
 * 做法（与 dev/selfcheck.mjs 完全相同的沙箱/加载手法）：
 *   把 app 的 IIFE 模块按 app/index.html 的 <script> 顺序丢进 node:vm 沙箱（排除 src/ui/** 与
 *   src/main.js —— 它们需要真实 DOM），给一个最小 window + localStorage，然后**只调用生产代码**：
 *     buildRound → applyAnswer → applyRoundEnd →（每天）rolloverDaily →（每日任务）quest.settle
 *     →（宝箱）chest.open →（商店）shop.buy
 *   逐日推进模拟日期。会话对象的字段与后处理逐行镜像 src/game/flow.js:26-231（沙箱里不加载 UI，
 *   因此把 flow 的开局/判定后处理写成等价代码；文件内用 `flow.js:NN` 标注对应位置）。
 *   任何随机都来自 WQ.util.rng(seed)（三条独立流：出题 / 命中判定 / 宝箱档位），因此整轮可复现。
 *
 * ============================ A8 口径定义（docs 只给了区间，没给定义） ============================
 * 【稳态月收入 steadyState】30 天窗口内「每日可重复」的金币收入合计，按 docs/03 §5.5 表格
 *   自己的枚举：**答对金币（2/题）+ 结算奖励（10/局）+ 每日首局（15/天）**。
 *   —— 这正是 docs/01 附录 B2 推导 1110 用的同一口径，所以可以直接对着 [700,1150] 比较。
 *   完美局金币（20）、升级奖励（30/级）、徽章奖励、v0.2 的每日任务/宝箱奖励**不计入稳态**；
 *   它们另立一列（「首月累计」）或参考行（「含完美局」），因为 docs 的 B2 推导明确说
 *   「完美局 +20：75% 命中率下拿不到，故稳态不计」（这句其实不准，见下面的 NOTE）。
 * 【首月累计收入 firstMonthCumulative】= 30 天**全部来源**的金币进账 = 余额 + 支出
 *   （余额只被商店扣减，因此这个恒等式可以当对账用）= 本体（含完美局）+ 升级 + 徽章 + 每日任务 + 宝箱。
 *   docs 的推导是 1110 + 570（升级）+ 125~400（徽章）= 1780~2080，故与 [1500,2200] 比较。
 * 【首月可购件数】= 按本文件的购买策略**实际成功购买**的件数（策略见下），要求 ≥15。
 *   另打印「按首月收入 ÷ 均价 52.5 估算的理论可购件数」作参考。
 * 【100% 命中率重跑】把同一 seed 的命中判定流换成恒真（题目序列不变），比较稳态月收入 ≤1150。
 *
 * ============================ 玩家模型（每一项都是文件顶部常量 + CLI 可覆盖） ============================
 *  · 每天 1 局（--rounds=1）、每局 8 题（用 WQ.balance.round.questionCount）、命中率 75%（--acc）
 *  · 每题独立按命中率判定（种子流 rndAnswers），答错时提交一个必然错的答案
 *  · 每局用 WQ.balance.hp.max 颗心；血量归零即结束本局（与 flow.isRoundOver 一致）
 *  · **不使用**每局 1 次免费重试（--retry=off）：重试需要 flow.retryCurrent 的会话回滚，模型保持保守
 *  · 每天 20:00 打这一局（--hour=20）：因此 B8 早起鸟（<07:00）/ B9 夜猫子（>23:00）不会解锁
 *  · TTS 视为可用（--tts=on，真实浏览器有 speechSynthesis），于是 Q4 参与题型分布
 *  · 每天结束时若碎片够就开箱（--chest=on，免费），走生产函数 WQ.chest.open
 *  · 购买策略 --buy=rational（见 applyBuyPolicy）：回补卡「断了才补」；护心符「有余钱或上局被打空」；
 *    替身稻草人「上局被打空且余钱充足」；侦查之眼「余钱 ≥150」。--buy=off 关闭全部购买。
 *  · 模拟起始日 2026-03-02、30 天全部落在 3 月内 —— 避开跨月重置（streak.js 的 repairCards/freezeCards）
 *    带来的额外变量；跨月路径不属 A8 范围（docs/06 D19 未裁决）。
 *
 * ============================ v0.2 全口径 / v0.1 口径 两组结论（--scope=both|full|legacy） ============================
 * app 已在 v0.2 里加入「每日任务 + 随机宝箱」（src/game/quest.js、chest.js），它们挂在
 * rolloverDaily / applyRoundEnd 上，属于当前真实生产路径，因此**默认口径（full）如实计入**。
 * 为了还能对照 docs 的 v0.1 数值，脚本会在同一进程里再跑一遍 `--legacy` 口径：把 v0.2 新增收益
 * （任务/全清奖励、宝箱档位奖励、v0.2 三枚新徽章奖励）在沙箱里置 0 后重跑 —— 只改沙箱里的 config
 * 副本，不动 app/**，也不改任何生产数值（docs/03 §5.5 明令禁止自行调数值）。
 *
 * NOTE（负数/正偏差来源，报告里会打印）：docs 的 B2 说「75% 命中率下拿不到完美局」，实际 8 题全对
 *   的概率是 0.75^8 ≈ 10%，30 天期望 ~3 次 → 稳态若含完美局会多 ~60/月；另一头，75% 命中率下
 *   3 心被打空的概率约 32%（本局提前结束、少答几题），会让「答对金币」低于 docs 假设的 6 题/局。
 *   两条一增一减，实测值与 docs 的 1110 会有几十枚的偏差，属建模事实而非脚本错误。
 *
 * NOTE2（本脚本实测到、但**不修**的 app 缺陷）：**金币被重复入账**。生产代码里
 *   · game/achievements.js:102 已经 `save.profile.coins += coinReward`（徽章）；
 *   · game/level.js:53 已经 `profile.coins += B.coins.levelUp`（升级）；
 *   · game/quest.js:181 已经 `save.profile.coins += coins`（每日任务）；
 *   而 game/balance.js:439 又 `save.profile.coins += earnedCoins`，其中 earnedCoins 含全额
 *   badgeCoins + levelUpCoins + questCoins —— 于是这三类奖励各发两次。
 *   另有 balance.js:415-419 的 questUnlocked 去重失效（getAllProgress 返回的对象没有 id 字段，
 *   `x.id` 恒为 undefined），使「当天首次解锁徽章」那一局的 badgeCoins 再翻倍。
 *   本脚本只如实统计：`额外` 列 = 实测进账 − 生产明细记账，正是这部分多给的金币；
 *   A8-2 用**实测**（余额 + 支出）判定，因此这条缺陷会直接体现在断言结果里。
 *
 * NOTE3（本脚本实测到、但**不修**的 app 缺陷）：**每日任务进度口径断了**。
 *   src/game/flow.js 逐题调 `WQ.quest.progress(save, { answered, correct, wrong, isNewWord, wordId })`（扁平字段），
 *   而 quest.js:238-243 读的是 `o.delta.answered/correct/wrong` 与 `o.newWords` —— 两边字段名不一致，
 *   于是「今日累计作答 8 题」「答对 6 题」「碰 6 个新词」永远不完成；
 *   而 balance.js:385-393 调 `quest.advance` 时又只传 rounds/maxCombo/isPerfect/reclaimed，
 *   不再传 answered/correct/wrong（v0.1 的 v0.2 草案里是传的）。
 *   结果：每日任务实测只有 ~15 金币/天（约 450/月），远低于 config 设计值 55/天（1650/月）。
 *   本脚本按**生产现状**复现（传扁平字段），不做"修正后"重算，差额在报告里说明。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DEV_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(DEV_DIR, '..', 'app');

/* ======================================================================
 * 一、模型常量（全部可被 CLI 覆盖，默认值就是 A8 的 simulate(30,1,0.75)）
 * ==================================================================== */
const MODEL = {
  days: 30,               // --days=30
  roundsPerDay: 1,        // --rounds=1
  accuracy: 0.75,         // --acc=0.75   （A8 默认参数：命中率 75%）
  seed: 20261003,         // --seed=20261003
  startDate: '2026-03-02',// --start=YYYY-MM-DD（30 天全部落在同一个月，避开跨月重置）
  hour: 20,               // --hour=20   （每局结束的本地时刻）
  studyMsPerQuestion: 6000, // --ms=6000 （只影响 stats.studyMs / byType.totalMs，不影响收入）
  ttsAvailable: true,     // --tts=on|off
  buyPolicy: 'rational',  // --buy=rational|off
  openChest: true,        // --chest=on|off
  useFreeRetry: false,    // --retry=off（固定：见文件头「玩家模型」）
  questionCount: null,    // null = 用 WQ.balance.round.questionCount（8）
  scope: 'both'           // --scope=both|full|legacy
};

/** docs/01 §9 A8 + docs/03 §5.5 的四条区间（**不得为了让结果好看而修改**） */
const A8 = {
  steadyMonthly: [700, 1150],
  firstMonthCumulative: [1500, 2200],
  firstMonthItemsMin: 15,
  fullAccuracySteadyMax: 1150
};

/* ======================================================================
 * 二、CLI
 * ==================================================================== */
const argv = process.argv.slice(2);

function argValue(name) {
  const hit = argv.filter((a) => a === '--' + name || a.indexOf('--' + name + '=') === 0)[0];
  if (hit === undefined) return undefined;
  const i = hit.indexOf('=');
  return i < 0 ? '' : hit.slice(i + 1);
}
function argFlag(name, def) {
  const raw = argValue(name);
  if (raw === undefined) return def;
  if (raw === '' || raw === 'on' || raw === 'true' || raw === '1') return true;
  if (raw === 'off' || raw === 'false' || raw === '0') return false;
  return def;
}
function argNum(name, def) {
  const raw = argValue(name);
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log([
    '用法：node dev/sim-economy.mjs [选项]',
    '  --days=30          模拟天数（默认 30）',
    '  --rounds=1         每天局数（默认 1）',
    '  --acc=0.75         每题命中率（默认 0.75；A8 的默认参数）',
    '  --seed=20261003    全部随机流的种子（默认 20261003）',
    '  --start=2026-03-02 模拟起始自然日（默认 2026-03-02，30 天落在同一个月内）',
    '  --hour=20          每局结束的本地时刻（默认 20:00，避开早起/熬夜徽章）',
    '  --tts=on|off       是否认为 TTS 可用（默认 on）',
    '  --buy=rational|off 购买策略（默认 rational，见文件头）',
    '  --chest=on|off     每天碎片够时是否开箱（默认 on）',
    '  --scope=both|full|legacy  跑哪套口径（默认 both：v0.2 全口径 + v0.1 对照口径）'
  ].join('\n'));
  process.exit(0);
}

MODEL.days = Math.max(1, Math.floor(argNum('days', MODEL.days)));
MODEL.roundsPerDay = Math.max(1, Math.floor(argNum('rounds', MODEL.roundsPerDay)));
MODEL.accuracy = Math.min(1, Math.max(0, argNum('acc', MODEL.accuracy)));
MODEL.seed = Math.floor(argNum('seed', MODEL.seed));
MODEL.startDate = argValue('start') || MODEL.startDate;
MODEL.hour = Math.min(23, Math.max(0, Math.floor(argNum('hour', MODEL.hour))));
MODEL.studyMsPerQuestion = Math.max(0, Math.floor(argNum('ms', MODEL.studyMsPerQuestion)));
MODEL.ttsAvailable = argFlag('tts', MODEL.ttsAvailable);
MODEL.buyPolicy = argValue('buy') || MODEL.buyPolicy;
MODEL.openChest = argFlag('chest', MODEL.openChest);
MODEL.scope = argValue('scope') || MODEL.scope;

/* ======================================================================
 * 三、沙箱与模块加载（手法照抄 dev/selfcheck.mjs：最小 window + node:vm）
 * ==================================================================== */
/** 从 app/index.html 取 <script src> 顺序 —— 与运行时唯一的真相同步（docs/06 D11 的工具链要求） */
function appScripts() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const out = [];
  const re = /<script\s+src="([^"]+)"\s*>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].replace(/\\/g, '/'));
  return out;
}

/** 只加载"不碰 DOM"的模块：按 index.html 顺序，去掉 src/ui/** 与 src/main.js */
const ALL_SCRIPTS = appScripts();
const FILES = ALL_SCRIPTS.filter((rel) => rel.indexOf('src/ui/') !== 0 && rel !== 'src/main.js');

function createStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; }
  };
}

/** 载入一次沙箱（每个口径一份全新沙箱，模块级状态互不串台） */
function createSimSandbox(legacy) {
  const localStorage = createStore();
  let uuidSeq = 0;
  const sandbox = {
    console,
    JSON, Math, Date, Number, String, Boolean, Array, Object, Set, Map, WeakMap, RegExp, Error, Promise, Symbol,
    parseInt, parseFloat, isNaN, isFinite,
    setTimeout, clearTimeout,
    performance: { now: () => Date.now() }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.localStorage = localStorage;
  sandbox.location = { hash: '#/home', href: 'file:///app/index.html#/home', replace() {} };
  /* 确定性 uid：让日志/roundId 在两次运行间完全一致（income 只走生产数值） */
  sandbox.crypto = { randomUUID: () => 'sim-' + (++uuidSeq) };
  vm.createContext(sandbox);

  const loaded = [];
  for (const rel of FILES) {
    const code = fs.readFileSync(path.join(APP, rel), 'utf8');
    try {
      vm.runInContext(code, sandbox, { filename: rel });
      loaded.push(rel);
    } catch (e) {
      console.error('加载失败: ' + rel + ' → ' + (e && e.message));
      process.exit(2);
    }
  }
  const WQ = sandbox.WQ;
  if (!WQ || !WQ.game || !WQ.questionPool || !WQ.save) {
    console.error('沙箱初始化失败：WQ.game / WQ.questionPool / WQ.save 缺失（app 模块清单变了？）');
    process.exit(2);
  }
  /* 先记下"设计值"，再做 legacy 归零 —— 两组口径都要能打印原设计上限 */
  const questDesignDaily = designedQuestDaily(WQ);
  const neutralized = legacy ? neutralizeV02Retention(WQ) : [];
  return { WQ, loaded, questDesignDaily, neutralized };
}

/**
 * v0.1 对照口径：把 v0.2 新增的"留存收益"在沙箱 config 副本里置 0（不动 app/**）。
 * 覆盖：每日任务单条奖励 + 全清加成、宝箱三档奖励、**v0.1 之外的徽章奖励**（白名单 = docs/03 §5.7 的 B1–B11）。
 * 用白名单而不是"写死三个新 id"，是因为 v0.2 会持续新增徽章/收益源，写死会悄悄漏掉。
 */
const V01_BADGE_IDS = [
  'firstBlood', 'hundredWords', 'unstoppable', 'sharpshooter', 'veteranHunter', 'hunterLeader',
  'bigSpender', 'earlyBird', 'nightOwl', 'maxHunter', 'firstClear'
];

function neutralizeV02Retention(WQ) {
  const B = WQ.balance;
  if (B.daily) {
    (B.daily.quests || []).forEach((q) => { q.coins = 0; q.xp = 0; });
    B.daily.firstClearBonusCoins = 0;
    B.daily.firstClearBonusXp = 0;
  }
  if (B.chest) (B.chest.tiers || []).forEach((t) => { t.coins = 0; t.xp = 0; });
  const neutralized = [];
  (WQ.achievements || []).forEach((a) => {
    if (V01_BADGE_IDS.indexOf(a.id) < 0 && ((a.coinReward || 0) || (a.xpReward || 0))) {
      a.coinReward = 0;
      a.xpReward = 0;
      neutralized.push(a.id);
    }
  });
  return neutralized;
}

/* ======================================================================
 * 四、模拟（逐日推进 + 只走生产代码）
 * ==================================================================== */
function parseStart(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return { y: 2026, m: 3, d: 2 };
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}
function dateOn(base, offsetDays, hour) {
  return new Date(base.y, base.m - 1, base.d + offsetDays, hour, 0, 0);
}
function localDay(d) {
  const p = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 会话骨架：字段与 flow.createSession（flow.js:54-106）逐项对应；hpMax 已含护心符 */
function makeSession(WQ, save, round, now, seq, studyMs) {
  const B = WQ.balance;
  const hpBonus = Math.max(0, Number(save.profile.nextRoundHpBonus) || 0);
  const hpMax = B.hp.max + hpBonus;
  const session = {
    roundId: 'sim-r' + seq,
    source: 'normal',
    aborted: false,
    questions: round.questions,
    totalQuestions: round.totalQuestions,
    index: 0,
    hpMax: hpMax,
    hpLeft: hpMax,
    combo: 0,
    maxCombo: 0,
    correct: 0,
    wrong: 0,
    skipped: 0,
    xpGained: 0,
    coinsGained: 0,
    comboTiersHit: [],
    retryUsed: false,
    strawDoubleAvailable: !!(save.profile.pendingStrawDouble || save.pendingStrawDouble),
    scoutEyeRemaining: Math.max(0, Number(save.profile.pendingScoutEye) || Number(save.pendingScoutEye) || 0),
    scoutEyeUsed: 0,
    isFirstRoundToday: !save.daily.todayFirstRoundDone,
    startedAt: new Date(now.getTime() - studyMs * Math.max(1, round.totalQuestions)).toISOString(),
    startedDate: localDay(now),
    pendingWrongIds: [],
    lastSnapshot: null,
    progressMap: Object.create(null),
    byTypeLog: emptyByType(WQ),
    breakdown: [],
    log: [],
    judged: false,
    lastResult: null,
    lastAnswer: null
  };
  /* 购买的道具在开局消耗（flow.js:89-91） */
  if (hpBonus) save.profile.nextRoundHpBonus = 0;
  if (session.strawDoubleAvailable) save.profile.pendingStrawDouble = false;
  if (session.scoutEyeRemaining) save.profile.pendingScoutEye = 0;
  return session;
}

function emptyByType(WQ) {
  const out = {};
  WQ.questionTypeOrder.forEach((t) => { out[t] = { questions: 0, correct: 0, totalMs: 0 }; });
  return out;
}

function correctAnswerOf(q) {
  if (q.type === 'Q1' || q.type === 'Q2' || q.type === 'Q4') {
    const i = (q.options || []).findIndex((o) => o.correct);
    return String(i >= 0 ? i : 0);
  }
  return String(q.word);
}
function wrongAnswerOf(q) {
  if (q.type === 'Q1' || q.type === 'Q2' || q.type === 'Q4') {
    const opts = q.options || [];
    const i = opts.findIndex((o) => o.correct);
    return String((i + 1) % Math.max(1, opts.length));
  }
  return 'zzzzzz'; // 拼写题：必然判错
}

/**
 * 打完一局：逐题 applyAnswer + flow.js:154-231 的等价后处理。
 * 不使用 flow.answerCurrent（它写 localStorage / 广播 / 依赖 DOM 时钟），但行为逐段对齐。
 */
function playSession(WQ, save, s, now, cfg, rndAnswers) {
  const ms = cfg.studyMsPerQuestion;
  while (s.hpLeft > 0 && s.index < s.totalQuestions) {
    const i = s.index;
    const q = s.questions[i];
    const wantCorrect = rndAnswers() < cfg.accuracy;
    const answer = wantCorrect ? correctAnswerOf(q) : wrongAnswerOf(q);

    const res = WQ.game.applyAnswer({ session: s, question: q, answer: answer, save: save, now: now });

    /* flow.js:164-167 侦查之眼（本模型不购买时定额为 0；买时同样只递减，不影响数值） */
    if (s.scoutEyeRemaining > 0 && (q.type === 'Q1' || q.type === 'Q2' || q.type === 'Q4')) {
      s.scoutEyeRemaining -= 1;
      s.scoutEyeUsed += 1;
    }
    /* flow.js:170-176 明细累加 */
    if (res.breakdown && res.breakdown.length) {
      res.breakdown.forEach((b) => {
        const found = s.breakdown.filter((x) => x.key === b.key)[0];
        if (found) found.value += b.value;
        else s.breakdown.push({ key: b.key, label: b.label, value: b.value, unit: b.unit });
      });
    }
    /* flow.js:179-184 题型聚合 */
    const bucket = s.byTypeLog[q.type] || (s.byTypeLog[q.type] = { questions: 0, correct: 0, totalMs: 0 });
    bucket.questions += 1;
    if (res.correct) bucket.correct += 1;
    bucket.totalMs += ms;
    /* flow.js:187-206 逐题日志 */
    const entry = {
      wordId: q.wordId, type: q.type, correct: !!res.correct, approximate: !!res.approximate,
      skipped: false, retried: false, answer: String(answer), correctAnswer: q.correctAnswer,
      ms: ms, xpGained: res.xpGained, hpAfter: s.hpLeft, comboAfter: s.combo
    };
    s.log[i] = entry;
    s.judged = true;
    s.lastResult = res;
    s.lastAnswer = entry.answer;
    /* flow.js:236-253 的等价后处理结束。
       注意：v0.2 起每日任务进度**不再逐题推进**（flow.js:249 明确），而是在结算时由
       quest.advance 从 stats.daily 重建，因此这里不再调 quest.progress —— 与生产保持一致。 */
    /* flow.js:209-215 替身稻草人：本局首次血量归零时以 1 心复活 */
    if (s.hpLeft <= 0 && s.strawDoubleAvailable) {
      s.strawDoubleAvailable = false;
      s.strawDoubleUsed = true;
      s.hpLeft = 1;
      res.revived = true;
    }
    s.index = i + 1;
  }
  return s;
}

/** 把一条 RoundRecord 的金币拆成 A8 关心的桶（按 breakdown 的 coin 行 + 答对金币） */
function coinBuckets(WQ, rec) {
  const B = WQ.balance;
  const out = { perCorrect: (Number(rec.correct) || 0) * B.coins.perCorrect, roundEnd: 0, dailyFirst: 0, perfect: 0, badge: 0, levelUp: 0, quest: 0, other: 0 };
  (rec.breakdown || []).forEach((b) => {
    if (b.unit !== 'coin') return;
    if (b.key === 'roundEnd') out.roundEnd += b.value;
    else if (b.key === 'dailyFirstCoin') out.dailyFirst += b.value;
    else if (b.key === 'perfectCoin') out.perfect += b.value;
    else if (b.key === 'badge') out.badge += b.value;
    else if (b.key.indexOf('levelUp') === 0) out.levelUp += b.value;   // levelUp / levelUp2 / levelUp3（v0.2 分三段滚升级）
    else if (b.key === 'quest') out.quest += b.value;
    else out.other += b.value;
  });
  return out;
}

/** 购买策略（文件头有完整说明；--buy=off 时整段跳过）
 * @returns {number} 当天花掉的金币（= 成功购买件的价格之和） */
function applyBuyPolicy(WQ, save, now, policyState, totals) {
  if (MODEL.buyPolicy === 'off') return 0;
  const S = WQ.balance.shop;
  const coins = () => Number(save.profile.coins) || 0;
  let spentToday = 0;

  const tryBuy = (itemId) => {
    const res = WQ.shop.buy(save, itemId, now);
    if (res && res.ok) {
      spentToday += Number(S[itemId].price) || 0;
      totals.spent += Number(S[itemId].price) || 0;
      totals.bought += 1;
      totals.byItem[itemId] = (totals.byItem[itemId] || 0) + 1;
      if (res.unlocked && res.unlocked.length) {
        /* B7「挥金如土」这类"购买后"徽章：金币由 game/achievements.js 直接进 profile.coins */
        totals.badge += res.unlocked.reduce((a, b) => a + (Number(b.coinReward) || 0), 0);
      }
    }
    return res;
  };

  /* 0) 回补卡：只有真断签可接时才买（日常连打不会触发） */
  if (WQ.streak.canRepair(save) && coins() >= S.repairCard.price) tryBuy('repairCard');
  /* 1) 护心符：余钱够两件（留一件的底）或上一局被打空 */
  if (coins() >= S.heartGuard.price * 2 || (policyState.lastRoundHpZero && coins() >= S.heartGuard.price)) tryBuy('heartGuard');
  /* 2) 替身稻草人：上一局被打空 且 余钱 ≥ 两件价 */
  if (policyState.lastRoundHpZero && coins() >= S.strawDouble.price * 2) tryBuy('strawDouble');
  /* 3) 侦查之眼：最便宜的一件（v0.1/v0.2 中它对局内无可见效果，见 docs/06 D4 —— 因此它是纯金币出口） */
  if (coins() >= S.heartGuard.price * 2.5) tryBuy('scoutEye');
  return spentToday;
}

/** 跑一套口径，返回 {rows, totals, summary, acc100} */
function simulate(cfg) {
  const legacy = cfg.legacy === true;
  const { WQ, loaded, questDesignDaily, neutralized } = createSimSandbox(legacy);
  const B = WQ.balance;
  const U = WQ.util;
  const base = parseStart(cfg.startDate);
  const qCount = cfg.questionCount || Math.max(1, Math.floor(Number(B.round.questionCount) || 8));

  const save = WQ.save.fillDefaults(WQ.save.defaultSave(dateOn(base, 0, cfg.hour)));
  WQ.state.save = save;
  WQ.state.settings = WQ.save.defaultSettings();

  const rndQuestions = U.rng(cfg.seed);        // 出题流（题型 / 选项 / 顺序）
  const rndAnswers = U.rng(cfg.seed + 101);    // 命中判定流
  const rndChest = U.rng(cfg.seed + 202);      // 宝箱档位流
  if (WQ.chest && WQ.chest.setRandom) WQ.chest.setRandom(rndChest);

  const totals = {
    perCorrect: 0, roundEnd: 0, dailyFirst: 0, perfect: 0, badge: 0, levelUp: 0, quest: 0, other: 0,
    chest: 0, spent: 0, bought: 0, byItem: {},
    /* extra：生产明细没有记账、但 profile.coins 实际多进账的部分（v0.1/v0.2 的重复计币缺陷，
       见文件头 NOTE2）。对账恒等式：明细合计 + extra === 余额 + 支出。 */
    extra: 0,
    xp: 0, levelUps: 0, perfectRounds: 0, rounds: 0, questions: 0, correct: 0, aborted: 0
  };
  const rows = [];
  const policyState = { lastRoundHpZero: false };
  let seq = 0;
  let mismatchRounds = 0;

  for (let d = 0; d < cfg.days; d++) {
    const dayDate = dateOn(base, d, cfg.hour);
    const row = {
      day: d + 1, date: localDay(dayDate),
      perCorrect: 0, roundEnd: 0, dailyFirst: 0, perfect: 0, badge: 0, levelUp: 0, quest: 0, other: 0,
      chest: 0, extra: 0, spent: 0, balance: 0, level: 1, streak: 0, correct: 0, wrong: 0, xp: 0
    };

    /* ---- 1. 跨天结算（生产路径）：每日标志 / 限购 / 跨月 / streak / 每日任务 settle / 宝箱碎片 ---- */
    const coinsBeforeRollover = Number(save.profile.coins) || 0;
    WQ.game.rolloverDaily(save, dayDate);
    const rolloverGain = (Number(save.profile.coins) || 0) - coinsBeforeRollover; // settle 当场发的任务/全清金币
    row.quest += rolloverGain;
    totals.quest += rolloverGain;

    /* ---- 2. 购买策略（生产路径 WQ.shop.buy）---- */
    const badgeBeforeBuy = totals.badge;
    row.spent += applyBuyPolicy(WQ, save, dayDate, policyState, totals);
    row.badge += totals.badge - badgeBeforeBuy;

    /* ---- 3. 本日的局（一局默认）---- */
    for (let r = 0; r < cfg.roundsPerDay; r++) {
      const coinsBeforePreRound = Number(save.profile.coins) || 0;
      /* flow.js:41-42：开局前再做一次跨天结算 + 记「今日登场」 */
      WQ.game.rolloverDaily(save, dayDate);
      if (WQ.quest) { WQ.quest.enterDay(save, dayDate); WQ.quest.resetPending(); }
      const preRoundGain = (Number(save.profile.coins) || 0) - coinsBeforePreRound;
      if (preRoundGain) { row.quest += preRoundGain; totals.quest += preRoundGain; }

      const coinsBeforeRound = Number(save.profile.coins) || 0;
      const round = WQ.questionPool.buildRound({
        save: save, words: WQ.WORDS, source: 'normal', now: dayDate,
        rnd: rndQuestions, ttsAvailable: cfg.ttsAvailable, limit: qCount
      });
      const s = makeSession(WQ, save, round, dayDate, ++seq, cfg.studyMsPerQuestion);
      playSession(WQ, save, s, dayDate, cfg, rndAnswers);
      const res = WQ.game.applyRoundEnd(save, s, dayDate);
      const rec = res.roundRecord;
      if (!rec) { console.error('applyRoundEnd 没有返回 RoundRecord（roundId=' + s.roundId + '）'); process.exit(2); }

      const bucket = coinBuckets(WQ, rec);
      row.perCorrect += bucket.perCorrect;
      row.roundEnd += bucket.roundEnd;
      row.dailyFirst += bucket.dailyFirst;
      row.perfect += bucket.perfect;
      row.badge += bucket.badge;
      row.levelUp += bucket.levelUp;
      row.quest += bucket.quest;
      row.other += bucket.other;
      row.correct += Number(rec.correct) || 0;
      row.wrong += Number(rec.wrong) || 0;
      row.xp += Number(rec.xpGained) || 0;

      totals.perCorrect += bucket.perCorrect;
      totals.roundEnd += bucket.roundEnd;
      totals.dailyFirst += bucket.dailyFirst;
      totals.perfect += bucket.perfect;
      totals.badge += bucket.badge;
      totals.levelUp += bucket.levelUp;
      totals.quest += bucket.quest;
      totals.other += bucket.other;
      totals.xp += (Number(rec.xpGained) || 0) + (Number(rec.bonusXp) || 0) + (Number(rec.questXp) || 0);
      totals.levelUps += (res.levelUps || []).length;
      totals.rounds += 1;
      totals.questions += Number(rec.totalQuestions) || 0;
      totals.correct += Number(rec.correct) || 0;
      if (rec.isPerfect) totals.perfectRounds += 1;
      if (res.aborted) totals.aborted += 1;
      if (Number(rec.hpLeft) <= 0) policyState.lastRoundHpZero = true; else policyState.lastRoundHpZero = false;

      /* 对账（每局）：金币实际增量 === 各来源之和；不相等说明有来源没被 A8 口径覆盖 */
      /* 对账（每局）：金币实际增量 vs 生产明细记账。
         extra = 实测 − 明细：v0.1/v0.2 的重复计币缺陷会让它为正（见文件头 NOTE2），
         明细里已含徽章/升级/任务行，因此 extra 就是"多出来的那一份"。 */
      const delta = (Number(save.profile.coins) || 0) - coinsBeforeRound;
      const recorded = bucket.perCorrect + bucket.roundEnd + bucket.dailyFirst + bucket.perfect
        + bucket.badge + bucket.levelUp + bucket.quest + bucket.other;
      const extra = delta - recorded;
      row.extra += extra;
      totals.extra += extra;
      if (extra !== 0) mismatchRounds++;
    }

    /* ---- 4. 开箱（生产路径 WQ.chest.open；免费，碎片够就开）---- */
    if (cfg.openChest && WQ.chest && WQ.chest.canOpen(save, dayDate)) {
      const open = WQ.chest.open(save, dayDate);
      if (open && open.ok) {
        row.chest += Number(open.coins) || 0;
        totals.chest += Number(open.coins) || 0;
      }
    }

    row.balance = Number(save.profile.coins) || 0;
    row.level = Number(save.profile.level) || 1;
    row.streak = Number(save.streak.dailyStreak) || 0;
    rows.push(row);
  }

  /* ---- 汇总 ---- */
  const steadyDocs = totals.perCorrect + totals.roundEnd + totals.dailyFirst;
  const steadyInclPerfect = steadyDocs + totals.perfect;
  const totalIncome = (Number(save.profile.coins) || 0) + totals.spent;
  const bucketsSum = totals.perCorrect + totals.roundEnd + totals.dailyFirst + totals.perfect + totals.badge + totals.levelUp + totals.quest + totals.chest + totals.other;
  const summary = {
    legacy: legacy,
    loaded: loaded.length,
    days: cfg.days,
    rounds: totals.rounds,
    steadyDocs: steadyDocs,
    steadyInclPerfect: steadyInclPerfect,
    totalIncome: totalIncome,
    finalCoins: Number(save.profile.coins) || 0,
    bucketsSum: bucketsSum,
    extra: totals.extra,
    mismatchRounds: mismatchRounds,
    /* 对账恒等式：生产明细合计 + 明细外的重复入账 === 实测总收入（余额 + 支出） */
    bucketsBalanced: bucketsSum + totals.extra === totalIncome,
    bought: totals.bought,
    spent: totals.spent,
    byItem: totals.byItem,
    chest: totals.chest,
    questDesignDaily: questDesignDaily,
    neutralized: neutralized,
    level: Number(save.profile.level) || 1,
    levelUps: totals.levelUps,
    badges: Object.keys(save.achievements || {}).filter((k) => save.achievements[k] && save.achievements[k].unlocked).length,
    badgeIds: Object.keys(save.achievements || {}).filter((k) => save.achievements[k] && save.achievements[k].unlocked),
    badgeCoins: totals.badge,
    perfectRounds: totals.perfectRounds,
    questions: totals.questions,
    correct: totals.correct,
    streak: Number(save.streak.dailyStreak) || 0,
    xp: Number(save.profile.totalXp) || 0,
    statsCoinsSpent: Number(save.stats.coinsSpent) || 0,
    buckets: totals
  };
  return { rows, summary, save, WQ };
}

/* ======================================================================
 * 五、断言与输出
 * ==================================================================== */
const results = [];   // { scope, name, expected, actual, pass, note }
function check(scope, name, expected, actual, pass, note) {
  results.push({ scope: scope, name: name, expected: expected, actual: actual, pass: !!pass, note: note || '' });
}

/** config 里"每日任务全清"的设计上限（金币/天）：常驻 2 条 + 最大一条轮换 + 全清加成 */
function designedQuestDaily(WQ) {
  const c = (WQ.balance && WQ.balance.daily) || {};
  const quests = c.quests || [];
  const always = c.alwaysIds || [];
  const byId = (id) => quests.filter((q) => q.id === id)[0];
  const fixed = always.map(byId).filter(Boolean).reduce((a, q) => a + (Number(q.coins) || 0), 0);
  const rotating = quests.filter((q) => always.indexOf(q.id) < 0).map((q) => Number(q.coins) || 0);
  const maxRotating = rotating.length ? Math.max.apply(null, rotating) : 0;
  return fixed + maxRotating + (Number(c.firstClearBonusCoins) || 0);
}

function runScope(scopeName, legacy) {  const cfg = Object.assign({}, MODEL, { legacy: legacy });
  const main = simulate(cfg);
  const acc100 = simulate(Object.assign({}, cfg, { accuracy: 1 }));
  const m = main.summary;
  const h = acc100.summary;

  console.log('\n================================================================================');
  console.log('口径：' + scopeName);
  console.log('参数：' + MODEL.days + ' 天 · 每天 ' + MODEL.roundsPerDay + ' 局 · 每局 '
    + (MODEL.questionCount || '(WQ.balance.round.questionCount)') + ' 题 · 命中率 '
    + Math.round(MODEL.accuracy * 100) + '% · 种子 ' + MODEL.seed + ' · 起始 ' + MODEL.startDate
    + ' ' + MODEL.hour + ':00 · TTS ' + (MODEL.ttsAvailable ? '可用' : '不可用')
    + ' · 购买 ' + MODEL.buyPolicy + ' · 开箱 ' + (MODEL.openChest ? '开' : '关'));
  console.log('模块：' + main.summary.loaded + ' 个（按 app/index.html 顺序，排除 src/ui/** 与 src/main.js）'
    + (legacy ? '；legacy 已把 v0.2 留存收益置 0（徽章白名单外的 ' + (main.summary.neutralized || []).length + ' 枚：'
      + ((main.summary.neutralized || []).join(',') || '无') + '）' : ''));
  console.log('随机流：出题 rng(seed) / 命中 rng(seed+101) / 宝箱档位 rng(seed+202)');
  console.log('--------------------------------------------------------------------------------');
  console.log(' # 日期        对  错   本体 完美 任务 宝箱 徽章 升级 额外 |  支出    余额  级  连');
  main.rows.forEach((r) => {
    console.log([
      String(r.day).padStart(2),
      r.date,
      String(r.correct).padStart(2),
      String(r.wrong).padStart(3),
      String(r.perCorrect + r.roundEnd + r.dailyFirst).padStart(5),
      String(r.perfect).padStart(4),
      String(r.quest).padStart(4),
      String(r.chest).padStart(4),
      String(r.badge).padStart(4),
      String(r.levelUp).padStart(4),
      String(r.extra).padStart(4),
      '|', String(r.spent).padStart(4),
      String(r.balance).padStart(6),
      String(r.level).padStart(3),
      String(r.streak).padStart(3)
    ].join(' '));
  });
  console.log('--------------------------------------------------------------------------------');
  console.log('收入分解（金币，按生产明细记账）  答对 ' + m.buckets.perCorrect + ' + 结算 ' + m.buckets.roundEnd
    + ' + 每日首局 ' + m.buckets.dailyFirst + ' + 完美局 ' + m.buckets.perfect
    + ' + 每日任务 ' + m.buckets.quest + ' + 宝箱 ' + m.chest + ' + 徽章 ' + m.badgeCoins
    + ' + 升级 ' + m.buckets.levelUp + (m.buckets.other ? ' + 其它 ' + m.buckets.other : ''));
  console.log('明细外的重复入账（实测 − 明细）= ' + m.extra + '（发生在 ' + m.mismatchRounds + '/' + m.rounds + ' 局）');
  console.log('对账：明细合计 ' + m.bucketsSum + ' + 重复入账 ' + m.extra + ' = ' + (m.bucketsSum + m.extra)
    + ' === 余额 ' + m.finalCoins + ' + 支出 ' + m.spent + ' = ' + m.totalIncome
    + '  → ' + (m.bucketsBalanced ? '一致' : '不一致！'));
  console.log('支出对账：购买合计 ' + m.spent + ' === 存档 stats.coinsSpent ' + m.statsCoinsSpent
    + '  → ' + (m.spent === m.statsCoinsSpent ? '一致' : '不一致！'));
  console.log('稳态月收入（文档口径：答对+结算+每日首局）= ' + m.steadyDocs
    + '   [参考] 含完美局 = ' + m.steadyInclPerfect + '（距 1150 上限 ' + (A8.steadyMonthly[1] - m.steadyInclPerfect) + '）');
  console.log('首月累计收入（实测：余额 + 支出，全部来源）= ' + m.totalIncome
    + '   [参考] 只算明细口径 = ' + m.bucketsSum);
  console.log('每日任务（明细入账）' + m.buckets.quest + ' / ' + MODEL.days + ' 天；config 设计上限 '
    + m.questDesignDaily + '/天（见文件头 NOTE3：进度字段不匹配，实测远低于设计值）');
  console.log('首月购买 ' + m.bought + ' 件 / 支出 ' + m.spent + ' 金币' + '（' + Object.keys(m.byItem).map((k) => k + '×' + m.byItem[k]).join(' ') + '）'
    + ' · 理论可购件数（收入 ÷ 均价 52.5）≈ ' + Math.floor(m.totalIncome / 52.5));
  console.log('成长：等级 ' + m.level + '（升级 ' + m.levelUps + ' 次）· 累计 XP ' + m.xp + ' · 答对 ' + m.correct + '/' + m.questions
    + ' 题 · 满分局 ' + m.perfectRounds + ' · 徽章 ' + m.badges + '（' + (m.badgeIds || []).join(',') + '）· 连击 ' + m.streak + ' 天');
  console.log('100% 命中率重跑：稳态月收入 = ' + h.steadyDocs + '（含完美局 ' + h.steadyInclPerfect + '）');

  /* ---- 四条 A8 断言 ---- */
  const band = A8.steadyMonthly;
  check(scopeName, 'A8-1 稳态月收入 ∈ [' + band[0] + ',' + band[1] + ']',
    band[0] + '–' + band[1], String(m.steadyDocs),
    m.steadyDocs >= band[0] && m.steadyDocs <= band[1],
    m.steadyDocs > band[1]
      ? '超出上限 ' + (m.steadyDocs - band[1]) + '：每日性收入 = 答对金币 + 10 结算 + 15 每日首局；docs 的 1110 假设 6 题答对/局'
      : (m.steadyDocs < band[0] ? '低于下限 ' + (band[0] - m.steadyDocs) : ''));

  const band2 = A8.firstMonthCumulative;
  check(scopeName, 'A8-2 首月累计收入 ∈ [' + band2[0] + ',' + band2[1] + ']',
    band2[0] + '–' + band2[1], String(m.totalIncome),
    m.totalIncome >= band2[0] && m.totalIncome <= band2[1],
    m.totalIncome > band2[1]
      ? '超出上限 ' + (m.totalIncome - band2[1]) + '。算术：① 明细口径 ' + m.bucketsSum
        + '（本体 ' + m.steadyInclPerfect + ' + 升级 ' + m.buckets.levelUp + ' + 徽章 ' + m.badgeCoins
        + ' + 任务 ' + m.buckets.quest + ' + 宝箱 ' + m.chest + '）；'
        + '② 明细外的重复入账 ' + m.extra + '（徽章/升级/任务被 balance.js:439 与各自的发奖点各加一次，见文件头 NOTE2）；'
        + '③ 合计 ' + m.totalIncome + '。' + (legacy ? '本口径已把 v0.2 留存收益置 0，超限完全来自重复入账。' : '本口径含 v0.2 每日任务/宝箱。')
      : '');

  check(scopeName, 'A8-3 首月可购物品 ≥ ' + A8.firstMonthItemsMin + ' 件',
    '≥' + A8.firstMonthItemsMin, String(m.bought), m.bought >= A8.firstMonthItemsMin, '');

  check(scopeName, 'A8-4 100% 命中率稳态月收入 ≤ ' + A8.fullAccuracySteadyMax,
    '≤' + A8.fullAccuracySteadyMax, String(h.steadyDocs),
    h.steadyDocs <= A8.fullAccuracySteadyMax,
    h.steadyDocs > A8.fullAccuracySteadyMax
      ? '超出 ' + (h.steadyDocs - A8.fullAccuracySteadyMax) + '：docs 自身口径 8×2 + 10 + 15 = 41/天 → 1230/月；'
        + '若含完美局 +20/天 = 61/天 → 1830/月（B2 说"75% 拿不到完美局"不成立，P(8/8)=0.75^8≈10%）'
      : '');

  return { main: m, acc100: h };
}

/* ======================================================================
 * 六、主流程
 * ==================================================================== */
console.log('=== 单词猎手 A8 · 30 天经济模拟（dev/sim-economy.mjs）===');
console.log('模块清单来源：app/index.html 的 <script src> 顺序（共 ' + ALL_SCRIPTS.length + ' 个，加载其中 ' + FILES.length + ' 个）');
if (FILES.length === 0) { console.error('没有解析到任何脚本，检查 app/index.html'); process.exit(2); }

const scopes = MODEL.scope === 'both' ? [['v0.2 全口径（当前生产路径，含每日任务/宝箱）', false], ['v0.1 对照口径（--legacy：v0.2 留存收益置 0）', true]]
  : MODEL.scope === 'legacy' ? [['v0.1 对照口径（--legacy：v0.2 留存收益置 0）', true]]
    : [['v0.2 全口径（当前生产路径，含每日任务/宝箱）', false]];

const scopeSummaries = {};
for (const [name, legacy] of scopes) scopeSummaries[name] = runScope(name, legacy);

console.log('\n================================================================================');
console.log('A8 断言汇总');
console.log('--------------------------------------------------------------------------------');
let failed = 0;
scopes.forEach(([name]) => {
  const list = results.filter((r) => r.scope === name);
  const bad = list.filter((r) => !r.pass).length;
  console.log('[' + name + '] ' + (list.length - bad) + '/' + list.length + ' 通过，失败 ' + bad);
  list.forEach((r) => {
    if (!r.pass) failed++;
    console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  | 期望 ' + r.expected + ' | 实际 ' + r.actual
      + (r.note ? '\n        → ' + r.note : ''));
  });
});
console.log('--------------------------------------------------------------------------------');
console.log('结论：' + (failed === 0 ? '全部 ' + results.length + ' 条断言通过' : failed + '/' + results.length + ' 条断言不通过（见上面的期望/实际与差额说明）'));
console.log('重申：本脚本不修改 app/** 的任何数值；实测超出文档区间时只报告，不调参（docs/03 §5.5 明令禁止）。');
process.exit(failed === 0 ? 0 : 1);
