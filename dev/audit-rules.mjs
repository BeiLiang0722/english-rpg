/* dev/audit-rules.mjs · 按 dev/check-words.mjs 的规则体检 deck-draft（临时工具）
 * 用法：node dev/audit-rules.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const deck = JSON.parse(fs.readFileSync(path.join(CACHE, 'deck-draft.json'), 'utf8'));
const POS_WHITELIST = new Set(['v.', 'n.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'num.', '']);

const fails = { wordForm: [], wordShort: [], posBad: [], meaningLong: [], meaningStop: [], exampleHits: [], exampleDup: [], phoneticWeak: [] };
const seenExample = new Map();

for (const w of deck) {
  const tag = w.id + ' ' + w.word;
  if (!/^[a-z]+$/.test(w.word)) fails.wordForm.push(tag + ' → ' + w.word);
  if (w.word.length < 3) fails.wordShort.push(tag + ' → ' + w.word);
  if (!POS_WHITELIST.has(w.pos || '')) fails.posBad.push(tag + ' → ' + (w.pos || '(空)'));
  if ((w.meaning_cn || '').length > 20) fails.meaningLong.push(tag + ' → ' + w.meaning_cn);
  if (/同上|参见/.test(w.meaning_cn || '') || /^(使|见)/.test(w.meaning_cn || '')) fails.meaningStop.push(tag + ' → ' + w.meaning_cn);
  if (w.example) {
    const re = new RegExp('\\b' + w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    const hits = (w.example.match(re) || []).length;
    if (hits !== 1) fails.exampleHits.push(tag + ' → 出现 ' + hits + ' 次: ' + w.example);
    const key = w.example.toLowerCase();
    if (seenExample.has(key)) fails.exampleDup.push(tag + ' 与 ' + seenExample.get(key) + ' 重复');
    else seenExample.set(key, tag);
  }
  if (w.phonetic && !/[ˈˌəɪʊæɒɔɜʌθðʃʒŋ]/.test(w.phonetic)) fails.phoneticWeak.push(tag + ' → ' + w.phonetic);
}

console.log('词库总量: ' + deck.length + '\n');
const show = (name, arr, limit = 6) => {
  console.log('  ' + name.padEnd(28) + arr.length);
  arr.slice(0, limit).forEach((x) => console.log('      ' + x));
  if (arr.length > limit) console.log('      …还有 ' + (arr.length - limit) + ' 条');
};
console.log('=== 按 check-words.mjs 的规则计数 ===');
show('词形不合法(非纯小写字母)', fails.wordForm);
show('词长 < 3', fails.wordShort);
show('词性不在白名单', fails.posBad);
show('释义 > 20 字', fails.meaningLong);
show('释义含空释义词/以使见开头', fails.meaningStop);
show('例句中目标词非恰好 1 次', fails.exampleHits);
show('例句完全重复', fails.exampleDup);
show('音标缺重音/元音符号', fails.phoneticWeak, 4);

/* 干扰项可生成性（脚本原有断言的标准） */
const canBuild = (type, w, all) => {
  const key = type === 'Q1' ? (x) => String(x.meaning_cn).trim()[0] : (x) => String(x.word).trim()[0].toLowerCase();
  const samePos = all.filter((x) => x.id !== w.id && x.pos && x.pos === w.pos && key(x) !== key(w));
  if (samePos.length >= 3) return true;
  return all.filter((x) => x.id !== w.id && key(x) !== key(w)).length >= 3;
};
const q1 = deck.filter((w) => canBuild('Q1', w, deck)).length;
const q2 = deck.filter((w) => canBuild('Q2', w, deck)).length;
console.log('\n=== 干扰项可生成性 ===');
console.log('  Q1: ' + q1 + ' / ' + deck.length + '  (' + ((q1 / deck.length) * 100).toFixed(1) + '%) 要求 ≥95%');
console.log('  Q2: ' + q2 + ' / ' + deck.length + '  (' + ((q2 / deck.length) * 100).toFixed(1) + '%) 要求 ≥95%');
console.log('  Q1 不可生成的词: ' + deck.filter((w) => !canBuild('Q1', w, deck)).map((w) => w.word).slice(0, 12).join(', '));

/* 释义首字分布（Q1 干扰项的硬规则依据） */
const fc = {};
deck.forEach((w) => { const c = (w.meaning_cn || ' ')[0]; fc[c] = (fc[c] || 0) + 1; });
console.log('\n=== 释义首字（Q1 干扰项要求首字不同）===');
console.log('  不同首字 ' + Object.keys(fc).length + ' 种；最高频: '
  + Object.entries(fc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + '×' + v).join('  '));
