/* dev/audit-deck.mjs · 量化词库质量问题（临时工具）
 * 用法：node dev/audit-deck.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const deck = JSON.parse(fs.readFileSync(path.join(CACHE, 'deck-draft.json'), 'utf8'));
const N = deck.length;

/* ---- 1. 例句与释义的"词性一致性"：例句里的目标词是否以释义暗示的词性出现 ---- */
/* 粗判：若释义以名词义开头（如"州；状态"），而例句里目标词紧跟 to/does/did/will 等，很可能是动词用法 */
const looksNoun = (w) => /^(的|地|了)/.test('') || true; // 占位，真正的判断靠启发式
const verbCue = (sentence, word) => {
  const re = new RegExp('\\b(to|does|doesn\'t|did|didn\'t|will|would|can|could|must|should|please|don\'t)\\s+' + word + '\\b', 'i');
  return re.test(sentence);
};
const beforeWord = (sentence, word) => {
  const i = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return '';
  return sentence.slice(Math.max(0, i - 12), i).trim();
};

let verbCueCount = 0;
const verbCueSamples = [];
for (const w of deck) {
  if (!w.example) continue;
  if (verbCue(w.example, w.word)) {
    verbCueCount++;
    if (verbCueSamples.length < 10) verbCueSamples.push(w);
  }
}
console.log('=== 1. 例句用法与释义可能冲突 ===');
console.log('  例句中目标词前有 to/does/will 等动词线索: ' + verbCueCount + ' / ' + N
  + '  (' + ((verbCueCount / N) * 100).toFixed(1) + '%)');
console.log('  —— 这个比例里有一部分是正常的（如 "to state the facts" 也可能是名词用法旁证），需要的不是零容忍，而是抽查');
verbCueSamples.slice(0, 6).forEach((w) => {
  console.log('    ' + w.word.padEnd(13) + '[' + w.pos + ' ' + w.meaning_cn + ']');
  console.log('        ' + w.example);
});

/* ---- 2. 词性判定：第一条义项 vs 整体 ---- */
const POS_RE = [
  [/^(vt|vi|v|vbl)\./i, 'v.'],
  [/^(n|ns|npl)\./i, 'n.'],
  [/^(adj|a)\./i, 'adj.'],
  [/^(adv|ad)\./i, 'adv.']
];
console.log('\n=== 2. 词性来源可靠性 ===');
let singleSense = 0, multiPos = 0;
for (const w of deck) {
  // meaning_cn 是我们挑出来的；无法反推原始 translation，只能看 pos 与释义的形态匹配
  if (!w.pos) singleSense++;
}
console.log('  缺词性: ' + singleSense);
console.log('  提示：词性是从 translation 第一条义项前缀推的，而释义是取前两条义项拼接的；');
console.log('        当第一条是名词、第二条是形容词时（如 national），pos 与释义会不一致。');

/* ---- 3. 内容过滤漏网词 ---- */
const EXTRA_BAD = /(skinflick\w*|sleazy|brothel|nude|erotic|stripper|striptease|orgy|orgies|pimp|hooker|mistress|abortion|condom|syphilis|gonorrhea|diarrhea|vomit|vomit\w*|urine|feces|shit|fart\w*|booze|drunk\w*|hangover|bastard|damn|hell\b|idiot|moron|stupid|dumb|fat\s+(ass|pig)|ugly\s+(bitch|slut))/i;
const leaky = deck.filter((w) => w.example && EXTRA_BAD.test(w.example));
console.log('\n=== 3. 内容过滤漏网 ===');
console.log('  主例句命中扩展黑名单: ' + leaky.length + ' 条');
leaky.slice(0, 12).forEach((w) => console.log('    ' + w.word.padEnd(13) + w.example));

/* 备选池里的漏网（会被 merge 阶段挑出来） */
const leakyAlt = deck.filter((w) => (w.alts || []).some((a) => EXTRA_BAD.test(a.sentence)));
console.log('  备选池里含漏网句的词: ' + leakyAlt.length + ' —— merge 时可能被选中，必须在建库阶段就挡掉');

/* ---- 4. 音标形态 ---- */
console.log('\n=== 4. 音标形态 ===');
let ascii = 0, ipaOk = 0, hasStress = 0, hasLen = 0;
for (const w of deck) {
  const p = w.phonetic || '';
  if (!p) continue;
  if (/[ɑɔəɛɪʊʒθðŋʃ]/.test(p)) ipaOk++;
  if (/'|ˈ/.test(p)) hasStress++;
  if (/[ː:]/.test(p)) hasLen++;
  if (/^[a-z'.:,;ɑɔəɛɪʊʒθðŋʃæʌ]+$/i.test(p)) ascii++;
}
const withPhon = deck.filter((w) => w.phonetic).length;
console.log('  有音标: ' + withPhon + ' / ' + N);
console.log('  含 IPA 特有符号: ' + ipaOk);
console.log('  含重音标记(ˈ 或 \'): ' + hasStress + '  ← 这个是关键，缺了就读不出重音位置');
console.log('  含长音符: ' + hasLen);
const noStress = deck.filter((w) => w.phonetic && !/'|ˈ/.test(w.phonetic));
console.log('  缺重音标记的: ' + noStress.length + '  (' + ((noStress.length / withPhon) * 100).toFixed(1) + '%)');
console.log('  样例: ' + deck.filter((w) => w.phonetic).slice(0, 8).map((w) => w.word + '/' + w.phonetic).join('  '));

/* ---- 5. 释义首字与干扰项 ---- */
console.log('\n=== 5. 干扰项可生成性（同词性 + 首字不同 的候选是否足够） ===');
const byPos = {};
deck.forEach((w) => { const p = w.pos || '(空)'; (byPos[p] = byPos[p] || []).push(w); });
let thin = 0;
for (const [pos, list] of Object.entries(byPos)) {
  if (list.length < 12) console.log('    ' + pos + ' 仅 ' + list.length + ' 个词（文档要求 ≥12）');
}
const firstChar = {};
deck.forEach((w) => { const c = w.meaning_cn[0]; firstChar[c] = (firstChar[c] || 0) + 1; });
const sparse = Object.entries(firstChar).filter(([, v]) => v === 1).length;
console.log('  不同首字: ' + Object.keys(firstChar).length + ' 种；只出现 1 次的首字: ' + sparse);
console.log('  最高频首字: ' + Object.entries(firstChar).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + '×' + v).join('  '));
