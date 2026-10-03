/* dev/sample-deck.mjs · 词库抽样报告（临时工具，给人看的）
 * 用法：node dev/sample-deck.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const deck = JSON.parse(fs.readFileSync(path.join(CACHE, 'deck-draft.json'), 'utf8'));

const byFrq = [...deck].sort((a, b) => a.frq - b.frq);
const N = byFrq.length;

function show(w, idx) {
  const tags = (w.tags || []).join('/');
  const extras = [w.collins ? 'collins=' + w.collins : '', tags].filter(Boolean).join(' ');
  console.log('  [' + String(idx).padStart(4) + '] ' + w.word.padEnd(16) + (w.pos || '(无词性)').padEnd(7)
    + 'frq=' + String(w.frq === 999999 ? '—' : w.frq).padStart(6) + '  ' + extras);
  console.log('        音标 ' + (w.phonetic || '（缺）'));
  console.log('        中文 ' + w.meaning_cn);
  console.log('        英文 ' + (w.meaning_en ? w.meaning_en.slice(0, 80) : '（缺）'));
  console.log('        例句 ' + (w.example || '（无例句）'));
}

console.log('词库总量: ' + N + ' 条\n');

/* 1. 最高频 12 词（最先出现在 App 里的那批） */
console.log('========== 1. 最高频 12 词（新用户最先遇到） ==========');
byFrq.slice(0, 12).forEach((w, i) => show(w, i + 1));

/* 2. 分位抽样：5 个位置各 3 条 */
console.log('\n========== 2. 词频分位抽样（每条 3 个） ==========');
const spots = [[0.10, '10%'], [0.30, '30%'], [0.50, '50%'], [0.70, '70%'], [0.90, '90%']];
for (const [q, label] of spots) {
  const base = Math.floor(q * N);
  console.log('\n--- ' + label + ' 分位（第 ' + base + ' 名附近）---');
  for (let i = 0; i < 3; i++) show(byFrq[base + i], base + i + 1);
}

/* 3. 边界情况 */
console.log('\n========== 3. 值得人工核对的边界情况 ==========');

const multiSense = deck.filter((w) => w.meaning_cn.includes('；'));
console.log('\n--- 多义项词（' + multiSense.length + ' 个，占 ' + ((multiSense.length / N) * 100).toFixed(0) + '%）：抽 5 ---');
multiSense.slice(0, 5).forEach((w) => show(w, byFrq.indexOf(w) + 1));

const noEx = deck.filter((w) => !w.example);
console.log('\n--- 无例句词（' + noEx.length + ' 个）：抽 8 ---');
noEx.slice(0, 8).forEach((w) => show(w, byFrq.indexOf(w) + 1));

const noPhon = deck.filter((w) => !w.phonetic);
console.log('\n--- 缺音标词（' + noPhon.length + ' 个）：抽 5 ---');
noPhon.slice(0, 5).forEach((w) => console.log('  ' + w.word.padEnd(16) + (w.pos || '').padEnd(7) + w.meaning_cn));

const noPos = deck.filter((w) => !w.pos);
console.log('\n--- 缺词性词（' + noPos.length + ' 个）：全部 ---');
noPos.forEach((w) => console.log('  ' + w.word.padEnd(16) + w.meaning_cn + '   | ' + (w.example || '')));

/* 4. 单字释义（干扰项最容易撞首字的那批） */
const single = deck.filter((w) => w.meaning_cn.length === 1);
console.log('\n--- 单字释义词（' + single.length + ' 个）：全部 ---');
console.log('  ' + single.map((w) => w.word + '=' + w.meaning_cn).join('  '));

/* 5. 总览统计 */
console.log('\n========== 4. 总览 ==========');
const stat = (label, n) => console.log('  ' + label.padEnd(22) + n + '  (' + ((n / N) * 100).toFixed(1) + '%)');
stat('有音标', deck.filter((w) => w.phonetic).length);
stat('有中文释义', deck.filter((w) => w.meaning_cn).length);
stat('有英文释义', deck.filter((w) => w.meaning_en).length);
stat('有例句', deck.filter((w) => w.example).length);
stat('有多义项', multiSense.length);
const posDist = {};
deck.forEach((w) => { posDist[w.pos || '(空)'] = (posDist[w.pos || '(空)'] || 0) + 1; });
console.log('  词性分布: ' + Object.entries(posDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '×' + v).join('  '));
const tagDist = {};
deck.forEach((w) => (w.tags || []).forEach((t) => { tagDist[t] = (tagDist[t] || 0) + 1; }));
console.log('  标签分布: ' + Object.entries(tagDist).map(([k, v]) => k + '×' + v).join('  '));
console.log('  释义长度: ' + (() => {
  const d = {};
  deck.forEach((w) => { const n = w.meaning_cn.length; d[n] = (d[n] || 0) + 1; });
  return Object.keys(d).map(Number).sort((a, b) => a - b).map((k) => k + '字×' + d[k]).join('  ');
})());
