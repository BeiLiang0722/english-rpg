/* dev/verify-crossday.mjs
 * 唯一职责：把本轮新增留存机制（每日任务 / 随机宝箱 / 错题本重练）的**跨天结算**做成一条
 * 端到端复核主线 —— 逐日注入本地日期，**每天结束时把存档写进 localStorage 再按生产读档路径读回**
 * （模拟"关掉浏览器明天再打开"），断言第二天读到的状态与结算结果都对。
 * 依赖：node:fs / node:path / node:vm（零第三方依赖，与其它 dev 脚本一致）。
 *
 * 与已有套件的分工（不重复它们的断言）：
 *   · dev/selfcheck.mjs    —— 单元级：每条机制的跨天边界各自断言；
 *   · dev/dom-e2e.mjs      —— DOM 级：营地渲染、开箱点击、刷新补结算；
 *   · dev/sim-economy.mjs  —— 30 天经济：账目恒等式与 A8 区间；
 *   · **本脚本** —— 补三者之间的缝：连续 4 个自然日 + 跨月的**存档往返 + 跨天续接**主线，
 *     只回答一个问题：「落进 localStorage 后，跨天还对不对」。
 *
 * 硬约束：只加载 app/src 下不碰 DOM 的模块；只调用生产函数（questionPool.buildRound /
 * game.applyAnswer / game.applyRoundEnd / game.rolloverDaily / quest.* / chest.* / save.* /
 * persist.saveNow / persist.loadSave），不复制业务逻辑。
 * 只用本地日期构造 Date（与 util.todayKey 同口径），不依赖测试机器的真实日期。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DEV_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(DEV_DIR, '..', 'app');

/* ---------------- 断言小工具 ---------------- */
const results = [];
function check(name, expected, actual, pass, note) {
  results.push({ name: name, expected: expected, actual: actual, pass: !!pass, note: note || '' });
}

/* ---------------- 沙箱：与 selfcheck.mjs 同手法 ---------------- */
function appScripts() {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const out = [];
  const re = /<script\s+src="([^"]+)"\s*>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].replace(/\\/g, '/'));
  return out;
}
const FILES = appScripts().filter((rel) => rel.indexOf('src/ui/') !== 0 && rel !== 'src/main.js');

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

function boot() {
  const localStore = createStore();
  const sandbox = {
    console, JSON, Math, Date, Number, String, Boolean, Array, Object, Set, Map, WeakMap, RegExp, Error, Promise, Symbol,
    parseInt, parseFloat, isNaN, isFinite, setTimeout, clearTimeout,
    performance: { now: () => Date.now() }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.localStorage = localStore;
  sandbox.location = { hash: '#/home', href: 'file:///app/index.html#/home', replace() {} };
  let n = 0;
  sandbox.crypto = { randomUUID: () => 'xd-' + (++n) };
  vm.createContext(sandbox);
  for (const rel of FILES) {
    vm.runInContext(fs.readFileSync(path.join(APP, rel), 'utf8'), sandbox, { filename: rel });
  }
  const WQ = sandbox.WQ;
  WQ.state.settings = WQ.save.defaultSettings();
  /* 把垫片存储挂到 WQ 上，便于脚本直接核对"主键里到底有什么" */
  WQ.__store = localStore;
  return WQ;
}

/* ---------------- 时间与作答（口径照 sim-economy.mjs） ---------------- */
const day = (n, month) => new Date(2026, (month == null ? 2 : month), n, 20, 0, 0);

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
  return 'zzzzzz';   /* 拼写题：必然判错 */
}

/**
 * 打完一局：逐题走生产 `applyAnswer` + `flow.answerCurrent` 的等价后处理
 * （明细累加 / 题型聚合 / 逐题日志 / 侦查之眼递减），再走生产 `applyRoundEnd`。
 * 不使用 `flow.answerCurrent`（它广播并依赖 DOM 时钟），但行为逐段对齐。
 */
function playRound(WQ, now, seq, mode) {
  const save = WQ.state.save;
  const round = WQ.questionPool.buildRound({
    save: save, words: WQ.WORDS, source: 'normal', now: now,
    rnd: WQ.util.rng(seq * 977 + 13), ttsAvailable: true
  });
  const s = {
    roundId: 'xd-r' + seq,
    source: 'normal', aborted: false, reclaim: false,
    questions: round.questions, totalQuestions: round.totalQuestions, index: 0,
    hpMax: WQ.balance.hp.max, hpLeft: WQ.balance.hp.max, combo: 0, maxCombo: 0,
    correct: 0, wrong: 0, skipped: 0, xpGained: 0, coinsGained: 0, comboTiersHit: [],
    retryUsed: false, strawDoubleAvailable: false, scoutEyeRemaining: 0, scoutEyeUsed: 0,
    isFirstRoundToday: !save.daily.todayFirstRoundDone,
    startedAt: now.toISOString(), startedDate: WQ.util.todayKey(now),
    pendingWrongIds: [], lastSnapshot: null, progressMap: Object.create(null),
    byTypeLog: {}, breakdown: [], log: [], judged: false, lastResult: null, lastAnswer: null
  };
  WQ.state.session = s;

  const answerRnd = WQ.util.rng(seq * 31 + 7);
  while (s.hpLeft > 0 && s.index < s.totalQuestions) {
    const i = s.index;
    const q = s.questions[i];
    const wantCorrect = mode === 'all' ? true : (mode === 'none' ? false : answerRnd() < 0.5);
    const answer = wantCorrect ? correctAnswerOf(q) : wrongAnswerOf(q);

    const res = WQ.game.applyAnswer({ session: s, question: q, answer: answer, save: save, now: now });

    /* flow.js:164-167 侦查之眼（未购买时额度为 0，此处不改变数值口径） */
    if (s.scoutEyeRemaining > 0 && (q.type === 'Q1' || q.type === 'Q2' || q.type === 'Q4')) {
      s.scoutEyeRemaining -= 1;
      s.scoutEyeUsed += 1;
    }
    /* flow.js:170-176 本局明细累加 */
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
    /* flow.js:187-206 逐题日志 */
    s.log.push({
      wordId: q.wordId, type: q.type, correct: !!res.correct, skipped: false,
      answer: answer, ms: 6000, at: now.toISOString()
    });
    s.judged = true;
    s.lastResult = res;
    s.lastAnswer = answer;
    s.index = i + 1;
  }

  const out = WQ.game.applyRoundEnd(save, s, now);
  WQ.state.session = null;
  return { session: s, rec: out.roundRecord, res: out };
}

/* ==================================================================== */

console.log('=== 单词猎手 · 跨天结算与存档往返复核（dev/verify-crossday.mjs）===');
console.log('只回答一个问题：新增留存机制落进 localStorage 后，跨天还对不对');
console.log('手法：逐日注入本地日期 + 每天把存档写盘再按生产读档路径读回（模拟关掉浏览器明天再打开）');
console.log('--------------------------------------------------------------------------------');

const WQ = boot();
const SAVE_KEY = WQ.persist.K_SAVE;
let save = WQ.save.fillDefaults(WQ.save.defaultSave(day(2)));
WQ.state.save = save;

/** 写盘 → 读回（生产路径），返回读回的存档 */
function persistAndReload(label) {
  WQ.persist.saveNow(WQ.state.save);
  /* 沙箱里 window 就是 sandbox 本身（WQ = window.WQ），主键从 persist 导出的常量取 */
  const text = WQ.__store.getItem(SAVE_KEY);
  check('存档往返 · ' + label + '：saveNow 写入的主键非空且可 JSON.parse',
    '非空且可解析', text == null ? 'null' : (text.length + ' 字节'),
    !!text && (function () { try { JSON.parse(text); return true; } catch (e) { return false; } })());
  /* loadSave() 返回包装对象 {save, restored, repaired, rejected, sourceVersion}，不是裸存档 */
  const res = WQ.persist.loadSave();
  const loaded = res.save;
  check('存档往返 · ' + label + '：读档未被判为高版本拒绝、未被判为损坏',
    'rejected=false / 存档对象存在', 'rejected=' + res.rejected + ' / save=' + (!!loaded),
    res.rejected === false && !!loaded);
  WQ.state.save = loaded;
  save = loaded;   /* 模块级绑定同步更新：后续整条跨天链条都用读回来的这一份 */
  return loaded;
}

/* ---- 第 1 天（3/2）：空白档 → 跨天 → 进营地 → 打一局全对 ---- */
WQ.game.rolloverDaily(save, day(2));
WQ.quest.enterDay(save, day(2));

const day1Quests = WQ.quest.pickDailyQuests(day(2)).slice();
check('D1 跨天：开局必出 3 条任务（2 常驻 + 1 轮换）',
  '3 条且含 questLogin/questAnswer', day1Quests.join(','),
  day1Quests.length === 3 && day1Quests.indexOf('questLogin') >= 0 && day1Quests.indexOf('questAnswer') >= 0);
check('D1 跨天：同一天重复取清单结果一致（确定性轮换，不用 Math.random）',
  true, String(JSON.stringify(day1Quests) === JSON.stringify(WQ.quest.pickDailyQuests(day(2)))),
  JSON.stringify(day1Quests) === JSON.stringify(WQ.quest.pickDailyQuests(day(2))));

const r1 = playRound(WQ, day(2), 1, 'all');
check('D1 结算：一局全对后 questAnswer 进度达 8/8 并自动发奖',
  'done=true', String(!!save.daily.questDone.questAnswer), !!save.daily.questDone.questAnswer);
const questGainDay1 = (r1.rec.breakdown || []).filter((b) => b.key === 'quest').reduce((a, b) => a + b.value, 0);
check('D1 账目：每日任务金币经 RoundRecord 的 quest 明细行入账（> 0）',
  '> 0', String(questGainDay1), questGainDay1 > 0);
check('D1 结算：宝箱碎片随今日连续答对产出（封顶 3 枚/天）',
  '3', String(save.daily.chestShards), Number(save.daily.chestShards) === 3,
  'chestShardsToday=' + save.daily.chestShardsToday);

const open1 = WQ.chest.open(save, day(2));
check('D1 宝箱：3 枚碎片可开 1 箱并写 chestOpenDate',
  'ok=true / openedToday=true', 'ok=' + open1.ok + ' / ' + WQ.chest.openedToday(save, day(2)),
  open1.ok && WQ.chest.openedToday(save, day(2)));
const open1b = WQ.chest.open(save, day(2));
check('D1 宝箱：同一天第二次开箱被拒绝（幂等键 chestOpenDate）',
  'openedToday', String(open1b.reason), open1b.ok === false && open1b.reason === 'openedToday');

const coinsAfterDay1 = Number(save.profile.coins);
save = persistAndReload('D1');
check('D1 往返后：任务状态 / 宝箱 / 金币全部保留',
  'questAnswer done / chestOpenDate=2026-03-02 / coins 不变',
  'done=' + !!save.daily.questDone.questAnswer + ' / open=' + save.daily.chestOpenDate + ' / coins=' + save.profile.coins,
  !!save.daily.questDone.questAnswer && save.daily.chestOpenDate === '2026-03-02'
    && Number(save.profile.coins) === coinsAfterDay1);

/* ---- 第 2 天（3/3）：跨天 → 清单重置、进度归零、碎片携带 ---- */
WQ.game.rolloverDaily(save, day(3));
check('D2 跨天：任务清单重建（questDate 更新）',
  '2026-03-03', String(save.daily.questDate), save.daily.questDate === '2026-03-03');
check('D2 跨天：昨日任务进度与完成状态清空',
  'progress=0 / done=false',
  'progress=' + save.daily.questProgress.questAnswer + ' / done=' + !!save.daily.questDone.questAnswer,
  !save.daily.questDone.questAnswer && Number(save.daily.questProgress.questAnswer || 0) === 0);
check('D2 跨天：未开箱的碎片最多带 1 枚到次日',
  'chestShards ≤ 1', String(save.daily.chestShards), Number(save.daily.chestShards) <= 1);
check('D2 跨天：今日计数器归零（countersDate 更新）',
  '2026-03-03 / answered=0', save.daily.countersDate + ' / ' + save.daily.counters.answered,
  save.daily.countersDate === '2026-03-03' && Number(save.daily.counters.answered) === 0);

/* 「今日登场」必须真的进过营地才算 —— 纯结算路径不白送 */
check('D2 跨天：「今日登场」在真正进营地前不得算完成',
  'done=false', String(!!save.daily.questDone.questLogin), !save.daily.questDone.questLogin);
WQ.quest.enterDay(save, day(3));
check('D2 进营地后：「今日登场」完成（enterDay 幂等，重复调用不再返回奖励）',
  'done=true', String(!!save.daily.questDone.questLogin), !!save.daily.questDone.questLogin);
const again = WQ.quest.enterDay(save, day(3));
check('D2 幂等：同一天重复 enterDay 不重复发奖',
  'coins=0 / xp=0', 'coins=' + again.coinGain + ' / xp=' + again.xpGain,
  Number(again.coinGain) === 0 && Number(again.xpGain) === 0);

playRound(WQ, day(3), 2, 'mixed');   /* 一半对一半错 → 制造错词 */
save = persistAndReload('D2');
check('D2 往返后：跨天边界键全部落盘',
  'questDate=2026-03-03 / countersDate=2026-03-03',
  save.daily.questDate + ' / ' + save.daily.countersDate,
  save.daily.questDate === '2026-03-03' && save.daily.countersDate === '2026-03-03');
const wrongIds = Object.keys(save.progress || {}).filter((id) => Number(save.progress[id].wrongCount) > 0);
check('D2 结算：答错的词进了错题本（wrongCount > 0）', '≥ 1 个', String(wrongIds.length), wrongIds.length >= 1);

/* ---- 第 3 天（3/4）：错题本重练 ---- */
WQ.game.rolloverDaily(save, day(4));
WQ.quest.enterDay(save, day(4));
const coldWord = wrongIds[0];
if (coldWord) {
  const p = save.progress[coldWord];
  const st = WQ.save.reclaimState(p, day(4));
  check('D3 错题本：冷却状态可判定且幂等（错 N 次 → N 天后可重练）',
    'can 为布尔 / days 有限 / 两次调用一致',
    'can=' + st.can + ' / days=' + st.days + ' / 一致=' + (JSON.stringify(st) === JSON.stringify(WQ.save.reclaimState(p, day(4)))),
    typeof st.can === 'boolean' && Number.isFinite(Number(st.days))
      && JSON.stringify(st) === JSON.stringify(WQ.save.reclaimState(p, day(4))));
  const narrow = WQ.questionPool.buildRound({
    save: save, words: WQ.WORDS, source: 'wrongBook', wordIds: [coldWord],
    now: day(4), rnd: WQ.util.rng(4242), ttsAvailable: true
  });
  const allSame = narrow.questions.every((q) => String(q.wordId) === String(coldWord));
  check('D3 错题本：重练局只出指定的那个词（wordIds 收窄生效）',
    'true', String(allSame), allSame, '题目数=' + narrow.totalQuestions);
} else {
  check('D3 错题本：重练局只出指定的那个词', '有错词可测', '无错词', false, 'D2 没有产生错词，无法验证重练');
}

/* ---- 跨月（4/2）：不崩、且按实现清零回补卡（D19 待上游裁决，这里只记录事实） ----
   注意顺序：rolloverMonth 先把冰冻卡充到配置值，同一次 rolloverStreak 若跨了很多天会**立刻消耗**它们
   （gap=30 → 单月最多保护 4 天）。所以「重置为 2」必须在**没有断签**的情形下验证，
   否则量到的是"已消耗"的值而不是"已重置"的值。 */
const beforeMonth = {
  repairCards: Number(save.streak.repairCards) || 0,
  monthKey: save.streak.monthKey
};
/* 情形 A：跨月且没有断签（lastStudyDate 就是 4/1）→ 冰冻卡应重置为配置值 */
save.streak.lastStudyDate = '2026-04-01';
save.streak.dailyStreak = 3;
WQ.game.rolloverDaily(save, day(2, 3));
check('跨月（未断签）：monthKey 更新且冰冻卡重置为配置值',
  'monthKey=2026-04 / freezeCards=' + WQ.balance.streak.freezeCardsPerMonth,
  'monthKey=' + save.streak.monthKey + ' / freezeCards=' + save.streak.freezeCards,
  save.streak.monthKey === '2026-04'
    && Number(save.streak.freezeCards) === WQ.balance.streak.freezeCardsPerMonth,
  'freezeUsedThisMonth=' + save.streak.freezeUsedThisMonth
    + ' / monthlyProtectedDays=' + save.streak.monthlyProtectedDays);

/* 情形 B：跨月 + 断签 30 天 → 月度额度被消耗，但不得超过单月保护上限 */
save.streak.lastStudyDate = '2026-03-02';
save.streak.monthKey = '2026-03';
save.streak.freezeCards = WQ.balance.streak.freezeCardsPerMonth;
save.streak.freezeUsedThisMonth = 0;
save.streak.monthlyProtectedDays = 0;
WQ.game.rolloverDaily(save, day(2, 3));
check('跨月（断签 30 天）：保护天数不超过单月上限，且不抛异常',
  'protectedDays ≤ ' + WQ.balance.streak.monthlyProtectedMax,
  'protectedDays=' + save.streak.monthlyProtectedDays + ' / freezeCards=' + save.streak.freezeCards,
  Number(save.streak.monthlyProtectedDays) <= WQ.balance.streak.monthlyProtectedMax,
  '回补卡 跨月前=' + beforeMonth.repairCards + ' → 跨月后=' + (Number(save.streak.repairCards) || 0)
    + '（docs/06 D19 口径待上游裁决，本脚本只记录事实）');
save = persistAndReload('跨月后');

/* ---- 所有跨天状态都必须真的在主存档键里（不是内存态） ---- */
const finalText = WQ.__store.getItem(SAVE_KEY) || '';
const mustHave = ['questDate', 'questIds', 'questDone', 'questClaimed', 'chestShards', 'chestOpenDate', 'countersDate', 'monthKey'];
const missing = mustHave.filter((k) => finalText.indexOf('"' + k + '"') < 0);
check('落盘：跨天与留存机制的字段全部在主存档键里（不是内存态）',
  mustHave.join(' / '), missing.length ? ('缺 ' + missing.join(',')) : '全部命中', missing.length === 0);

/* ---- 加载速度：冷启动解析/执行耗时与主存档往返耗时（结构性证据） ---- */
const size = FILES.reduce((a, rel) => a + fs.statSync(path.join(APP, rel)).size, 0);
const bootT0 = process.hrtime.bigint();
const tWQ = boot();
tWQ.save.fillDefaults(tWQ.save.defaultSave(day(2)));
const bootMs = Number(process.hrtime.bigint() - bootT0) / 1e6;
check('加载速度：35+ 个脚本解析+执行+建默认档 < 600ms 启动预算（docs/02 P0）',
  '< ' + 600 + 'ms', bootMs.toFixed(1) + 'ms（脚本 ' + size + ' 字节 / ' + FILES.length + ' 个文件）',
  bootMs < 600, 'Node 侧实测，不含浏览器绘制');

/* ---------------- 汇总 ---------------- */
console.log('--------------------------------------------------------------------------------');
let failed = 0;
results.forEach((r) => {
  if (!r.pass) failed++;
  console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name
    + (r.pass ? '' : '  | 期望 ' + r.expected + ' | 实际 ' + r.actual));
  if (r.note) console.log('        · ' + r.note);
});
console.log('--------------------------------------------------------------------------------');
console.log('=== 结果: ' + (results.length - failed) + '/' + results.length + ' PASS ===');
process.exit(failed === 0 ? 0 : 1);
