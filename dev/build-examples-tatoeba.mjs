/* dev/build-examples-tatoeba.mjs · 用「Tatoeba 可靠英中句对」（215321 对）为 CET 词抽例句
 * 用法：node dev/build-examples-tatoeba.mjs
 * 前置：dev/merge-deck.mjs --links（产出 pairs-en-cmn.json）
 * 产物：<缓存>/examples-tatoeba.json = { "<word>": {en, zh, id, n} }
 *
 * 为什么：Tatoeba 的英中配对是人工维护的，翻译可靠性远高于自动对齐的 WikiMatrix。
 * 之前只对"我挑中的 5714 条候选英语句"查中文，命中 293；
 * 现在反过来——把全部 215321 对可靠句对拿来匹配 CET 词，覆盖面大得多。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const PAIRS = path.join(CACHE, 'pairs-en-cmn.json');
const ENG_TSV = path.join(CACHE, 'eng-eng_sentences.tsv');

const deck = JSON.parse(fs.readFileSync(path.join(CACHE, 'deck-draft.json'), 'utf8'));
const byWord = new Map(deck.map((w) => [w.word.toLowerCase(), w]));

const pairs = JSON.parse(fs.readFileSync(PAIRS, 'utf8'));
console.log('目标词 ' + byWord.size + '；可靠英中句对 ' + Object.keys(pairs).length);

const HARD = /\b(porn\w*|porno|erotic|nude|naked|rape|raped|rapist|prostitut\w*|whore|slut|bitch|fuck\w*|shit\w*|cunt|cock|penis|vagina|boobs?|tits?|orgasm|masturbat\w*|condom|nigger|fag|retard\w*|suicide|suicidal|skinflick\w*|sleazy|brothel|stripper|striptease|orgy|orgies|pimp|hooker|abortion\w*|syphilis|gonorrhea|diarrhea|vomit\w*|feces|fart\w*|booze|hangover)\b/i;
const CJK_IN_EN = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0900-\u097f]/;
const LATIN_IN_ZH = /[A-Za-z]/;
const TRAD = /[們來這個說話時實現發學會國語點見愛與體為對開關門問間樣種類經過應該動聽讀寫課練習題考試漢語詞彙萬與東車馬鳥魚鳳龍龜]/;
const SIMP = /[们来这个说话时实现发学会国语点见爱与体为对开关门问间样种类经过应该动听读写课练习题考试汉语词汇万与东车马鸟鱼凤龙龟]/;
function zhScore(zh) {
  let s = 0;
  if (SIMP.test(zh)) s += 2;
  if (TRAD.test(zh)) s -= 2;
  if (zh.length >= 6 && zh.length <= 30) s += 1;
  return s;
}

/* 第一步：把 215321 对里"我关心的那些英语句 id"挑出来，只读这些行 */
const wanted = new Map();  // enId -> zh
for (const [id, zh] of Object.entries(pairs)) {
  if (zh && !LATIN_IN_ZH.test(zh)) wanted.set(id, zh);
}
console.log('中文可用的配对: ' + wanted.size);

const best = new Map();   // word -> {en, zh, id, n, score}
let lines = 0, scanned = 0, accepted = 0;

/* 第二步：扫英语句表，只处理 id 在 wanted 里的行 */
const stream = fs.createReadStream(ENG_TSV, { encoding: 'utf8', highWaterMark: 1 << 20 });
let buf = '';
const t0 = Date.now();
for await (const chunk of stream) {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line) continue;
    lines++;
    const c1 = line.indexOf('\t');
    if (c1 < 0) continue;
    const id = line.slice(0, c1);
    if (!wanted.has(id)) continue;
    const c2 = line.indexOf('\t', c1 + 1);
    if (c2 < 0) continue;
    const sentence = line.slice(c2 + 1).trim();
    const zh = wanted.get(id);
    if (!sentence || sentence.length > 150) continue;
    if (CJK_IN_EN.test(sentence)) continue;
    if (HARD.test(sentence)) continue;
    scanned++;

    const words = sentence.split(/\s+/);
    const n = words.length;
    if (n < 5 || n > 18) continue;
    const lower = words.map((w) => w.toLowerCase().replace(/^[^a-z]+|[^a-z']+$/g, ''));
    for (let i = 0; i < lower.length; i++) {
      const w = lower[i];
      if (!w || !byWord.has(w)) continue;
      let count = 0;
      for (const x of lower) if (x === w) count++;
      if (count !== 1) continue;
      accepted++;
      const score = -Math.abs(n - 10) + zhScore(zh);
      const prev = best.get(w);
      if (!prev || score > prev.score) best.set(w, { en: sentence, zh, id, n, score });
    }
  }
}

console.log('\n扫 ' + lines + ' 行（' + ((Date.now() - t0) / 1000).toFixed(0) + 's），其中可靠句对命中的 ' + scanned + '，候选 ' + accepted);
console.log('覆盖到的 CET 词: ' + best.size + ' / ' + byWord.size + '  (' + ((best.size / byWord.size) * 100).toFixed(1) + '%)');

console.log('\n--- 抽样 14 条 ---');
const keys = [...best.keys()];
for (let i = 0; i < 14; i++) {
  const w = keys[Math.floor((i + 0.5) * (keys.length / 14))];
  const v = best.get(w);
  console.log('  ' + w.padEnd(15) + v.en);
  console.log('  ' + ''.padEnd(15) + v.zh + '   [' + v.n + 'w]');
}

const out = path.join(CACHE, 'examples-tatoeba.json');
fs.writeFileSync(out, JSON.stringify(Object.fromEntries(best)));
console.log('\n已写出: ' + out + '  ' + (fs.statSync(out).size / 1048576).toFixed(1) + ' MB');
