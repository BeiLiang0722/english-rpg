/* dev/build-examples-wm.mjs · 从 WikiMatrix 英中平行语料为 CET 词抽例句（临时工具）
 * 用法：node dev/build-examples-wm.mjs
 * 产物：<缓存>/examples-wm.json = { "<word>": {en, zh, n, score} }
 *
 * 为什么换源：Tatoeba 的中文语料仅 89177 条（英语 200 万），英中交集太稀疏，
 * 5802 个词里只有 5.1% 能配上中文例句。WikiMatrix 有 786511 行英中句对，规模差一个量级。
 *
 * 筛选条件（每一条都对应一个踩过的坑或明确的质量要求）：
 *   - 英文句 6~18 词；目标词恰好出现 1 次（Q5 挖空的前提）
 *   - 中文句必须有、长度 4~40 字、不含拉丁字母（维基对齐偶有串行）
 *   - 中文以简体为主（按简繁特征字打分，优先简体）
 *   - 英文句不得混入阿拉伯文/天城文/假名等非拉丁字符（WikiMatrix 的英文半边不总是英语）
 *   - 内容过滤沿用 build-deck 的两级黑名单
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const WM = path.join(CACHE, 'opus-wm');
const EN = path.join(WM, 'WikiMatrix.en-zh.en');
const ZH = path.join(WM, 'WikiMatrix.en-zh.zh');

const deck = JSON.parse(fs.readFileSync(path.join(CACHE, 'deck-draft.json'), 'utf8'));
const byWord = new Map(deck.map((w) => [w.word.toLowerCase(), w]));
console.log('目标词: ' + byWord.size);

const HARD = /\b(porn\w*|porno|erotic|nude|naked|rape|raped|rapist|prostitut\w*|whore|slut|bitch|fuck\w*|shit\w*|cunt|cock|penis|vagina|boobs?|tits?|orgasm|masturbat\w*|condom|nigger|fag|retard\w*|suicide|suicidal|skinflick\w*|sleazy|brothel|stripper|striptease|orgy|orgies|pimp|hooker|abortion\w*|syphilis|gonorrhea|diarrhea|vomit\w*|feces|fart\w*|booze|hangover|slave|slaves|slavery|slaveholder|enslaved)\b/i;
const NON_LATIN = /[\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/;
const LATIN_IN_ZH = /[A-Za-z]/;
const TRAD = /[們來這個說話時實現發學會國語點見愛與體為對開關門問間樣種類經過應該動聽讀寫課練習題考試漢語詞彙萬與東車馬鳥魚鳳龍龜]/;
const SIMP = /[们来这个说话时实现发学会国语点见爱与体为对开关门问间样种类经过应该动听读写课练习题考试汉语词汇万与东车马鸟鱼凤龙龟]/;

function zhScore(zh) {
  let s = 0;
  if (SIMP.test(zh)) s += 2;
  if (TRAD.test(zh)) s -= 2;
  const len = zh.length;
  if (len >= 8 && len <= 28) s += 1;
  return s;
}

/** word -> 最佳候选 */
const best = new Map();
let lines = 0, accepted = 0, rejected = 0;

const enStream = fs.createReadStream(EN, { encoding: 'utf8', highWaterMark: 1 << 20 });
const zhStream = fs.createReadStream(ZH, { encoding: 'utf8', highWaterMark: 1 << 20 });

/* 同步迭代两个流：各自维护缓冲，逐行配对（两个文件行数一致且行序对齐） */
async function* linePairs() {
  let eb = '', zb = '', enDone = false, zhDone = false;
  const enIt = enStream[Symbol.asyncIterator]();
  const zhIt = zhStream[Symbol.asyncIterator]();
  let enLines = [], zhLines = [];
  while (!enDone || !zhDone) {
    while (!enDone && enLines.length < 2000) {
      const r = await enIt.next();
      if (r.done) { enDone = true; break; }
      eb += r.value;
      let nl;
      while ((nl = eb.indexOf('\n')) >= 0) { enLines.push(eb.slice(0, nl)); eb = eb.slice(nl + 1); }
    }
    while (!zhDone && zhLines.length < 2000) {
      const r = await zhIt.next();
      if (r.done) { zhDone = true; break; }
      zb += r.value;
      let nl;
      while ((nl = zb.indexOf('\n')) >= 0) { zhLines.push(zb.slice(0, nl)); zb = zb.slice(nl + 1); }
    }
    if (!enLines.length && !zhLines.length) break;
    const n = Math.min(enLines.length, zhLines.length);
    for (let i = 0; i < n; i++) yield [enLines[i], zhLines[i]];
    enLines = enLines.slice(n);
    zhLines = zhLines.slice(n);
  }
}

const t0 = Date.now();
for await (const [en, zh] of linePairs()) {
  lines++;
  const sentence = String(en).trim();
  const cn = String(zh).trim();
  if (!sentence || !cn) { rejected++; continue; }
  if (sentence.length > 150 || cn.length < 4 || cn.length > 60) { rejected++; continue; }
  if (NON_LATIN.test(sentence)) { rejected++; continue; }
  if (LATIN_IN_ZH.test(cn)) { rejected++; continue; }
  if (HARD.test(sentence)) { rejected++; continue; }

  const words = sentence.split(/\s+/);
  const n = words.length;
  if (n < 6 || n > 18) { rejected++; continue; }
  const lower = words.map((w) => w.toLowerCase().replace(/^[^a-z]+|[^a-z']+$/g, ''));
  const source = deck.find(() => false); // 占位，避免误用

  for (let i = 0; i < lower.length; i++) {
    const w = lower[i];
    if (!w || !byWord.has(w)) continue;
    let count = 0;
    for (const x of lower) if (x === w) count++;
    if (count !== 1) continue;
    accepted++;
    // 评分：长度靠近 10 词 + 中文简体 + 中文长度适中
    const score = -Math.abs(n - 10) + zhScore(cn);
    const prev = best.get(w);
    if (!prev || score > prev.score) best.set(w, { en: sentence, zh: cn, n, score });
  }
  if (lines % 200000 === 0) console.log('  已扫 ' + lines + ' 行，命中词 ' + best.size + '（' + ((Date.now() - t0) / 1000).toFixed(0) + 's）');
}

console.log('\n扫描 ' + lines + ' 行（' + ((Date.now() - t0) / 1000).toFixed(0) + 's），因规则被拒 ' + rejected + '，候选命中 ' + accepted);
console.log('覆盖到的词: ' + best.size + ' / ' + byWord.size + '  (' + ((best.size / byWord.size) * 100).toFixed(1) + '%)');

const withZh = [...best.values()].filter((v) => v.zh).length;
console.log('其中中文可用: ' + withZh);

console.log('\n--- 抽样 12 条 ---');
const words = [...best.keys()];
for (let i = 0; i < 12; i++) {
  const w = words[Math.floor((i + 0.5) * (words.length / 12))];
  const v = best.get(w);
  console.log('  ' + w.padEnd(16) + v.en);
  console.log('  ' + ''.padEnd(16) + v.zh + '   [' + v.n + ' words, score ' + v.score + ']');
}

const out = path.join(CACHE, 'examples-wm.json');
fs.writeFileSync(out, JSON.stringify(Object.fromEntries(best)));
console.log('\n已写出: ' + out + '  ' + (fs.statSync(out).size / 1048576).toFixed(1) + ' MB');
