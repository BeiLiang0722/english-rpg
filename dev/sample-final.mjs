/* dev/sample-final.mjs · 成品词库抽样（临时工具） */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const deck = JSON.parse(fs.readFileSync(path.join(CACHE, 'deck-final.json'), 'utf8'));

console.log('总词数: ' + deck.length);
const bySrc = {};
deck.forEach((w) => { const k = w.example_src || '(无)'; bySrc[k] = (bySrc[k] || 0) + 1; });
console.log('例句来源分布: ' + JSON.stringify(bySrc));
console.log('');

const show = (w) => {
  console.log('  ' + w.id + '  ' + w.word.padEnd(15) + (w.pos || '—').padEnd(6) + (w.phonetic || '—').padEnd(19)
    + '[' + w.meaning_cn + ']');
  console.log('        EN: ' + (w.example || '（无）'));
  if (w.example_cn) console.log('        ZH: ' + w.example_cn);
  console.log('        来源: ' + (w.example_src || '—') + (w.collins ? '   collins=' + w.collins : '') + '  frq=' + (w.frq === 999999 ? '—' : w.frq));
};

/* 1. 最高频 8 词 */
console.log('========== 最高频 8 词 ==========');
[...deck].sort((a, b) => a.frq - b.frq).slice(0, 8).forEach(show);

/* 2. 各来源抽样 */
console.log('\n========== 按来源抽样 ==========');
for (const src of ['tatoeba-pair', 'tatoeba-links', 'wikimatrix', 'tatoeba-en-only']) {
  const list = deck.filter((w) => w.example_src === src && w.example);
  console.log('\n--- ' + src + '（' + list.length + ' 条）---');
  for (let i = 0; i < 3 && i < list.length; i++) show(list[Math.floor((i + 0.5) * (list.length / 3))]);
}

/* 3. 总览 */
console.log('\n========== 总览 ==========');
const pct = (n) => n + '  (' + ((n / deck.length) * 100).toFixed(1) + '%)';
console.log('  有音标      : ' + pct(deck.filter((w) => w.phonetic).length));
console.log('  有词性      : ' + pct(deck.filter((w) => w.pos).length));
console.log('  有中文释义  : ' + pct(deck.filter((w) => w.meaning_cn).length));
console.log('  有英文释义  : ' + pct(deck.filter((w) => w.meaning_en).length));
console.log('  有英文例句  : ' + pct(deck.filter((w) => w.example).length));
console.log('  有中文例句  : ' + pct(deck.filter((w) => w.example_cn).length));
console.log('  字段一览    : ' + Object.keys(deck[0]).join(', '));
