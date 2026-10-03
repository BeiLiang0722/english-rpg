/* dev/list-leaks.mjs · 列出内容过滤的漏网例句（临时工具） */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const deck = JSON.parse(fs.readFileSync(path.join(CACHE, 'deck-draft.json'), 'utf8'));

/* 只列"真脏"与"露骨暴力"，且必须用词边界——否则 shellfish 里的 hell、Hellebrandt 都会误报。
 * 这里刻意不列 hell/stupid/damn：它们本身就是 CET 单词，屏蔽它们等于让这些词没有例句。 */
const EXTRA = /\b(skinflick\w*|sleazy|brothel|nude|erotic|stripper|striptease|orgy|orgies|pimp|hooker|abortion\w*|condom|syphilis|gonorrhea|diarrhea|vomit\w*|feces|fart\w*|booze|hangover|idiot|moron|bastard|rape\w*|nigger)\b/i;

const bad = deck.filter((w) => w.example && EXTRA.test(w.example));
console.log('主例句漏网 ' + bad.length + ' 条：');
for (const w of bad) {
  console.log('  ' + w.word.padEnd(14) + '[' + w.pos + ' ' + w.meaning_cn + ']');
  console.log('      ' + w.example);
}

const altBad = deck.filter((w) => (w.alts || []).some((a) => EXTRA.test(a.sentence)));
console.log('\n备选池含漏网句的词 ' + altBad.length + ' 个，样例：');
for (const w of altBad.slice(0, 8)) {
  const a = w.alts.find((x) => EXTRA.test(x.sentence));
  console.log('  ' + w.word.padEnd(14) + a.sentence);
}
