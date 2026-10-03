/* dev/audit-wm-align.mjs · 估计 WikiMatrix 的对齐错误率（临时工具）
 * 用法：node dev/audit-wm-align.mjs
 * 思路：英文句里的阿拉伯数字应在中文句里原样出现（数字不翻译）。
 *       两者都有数字但不一致 → 几乎可以断定这对是错配的。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const wm = JSON.parse(fs.readFileSync(path.join(CACHE, 'examples-wm.json'), 'utf8'));

const entries = Object.entries(wm);
console.log('WikiMatrix 候选总数: ' + entries.length);

let bothNum = 0, mismatch = 0, numInEn = 0, numInZh = 0;
const mismatchSamples = [];

for (const [w, v] of entries) {
  const enNums = (v.en.match(/\d+(?:[.,]\d+)?/g) || []);
  const zhNums = (v.zh.match(/\d+(?:[.,]\d+)?/g) || []);
  if (enNums.length) numInEn++;
  if (zhNums.length) numInZh++;
  if (!enNums.length) continue;
  bothNum++;
  const setZh = new Set(zhNums);
  const ok = enNums.some((n) => setZh.has(n));
  if (!ok) {
    mismatch++;
    if (mismatchSamples.length < 12) mismatchSamples.push({ w, en: v.en, zh: v.zh, enNums, zhNums });
  }
}

console.log('\n=== 数字一致性检验 ===');
console.log('  英文句含数字: ' + numInEn);
console.log('  中文句含数字: ' + numInZh);
console.log('  两边都有数字: ' + bothNum);
console.log('  数字对不上的: ' + mismatch + '  (' + (bothNum ? ((mismatch / bothNum) * 100).toFixed(1) : '0') + '%)  ← 对齐错误率的保守估计');
console.log('\n--- 对不上的样例（基本可确认是错配）---');
for (const s of mismatchSamples) {
  console.log('  [' + s.w + ']');
  console.log('    EN: ' + s.en + '   (数字 ' + s.enNums.join(',') + ')');
  console.log('    ZH: ' + s.zh + '   (数字 ' + (s.zhNums.join(',') || '无') + ')');
}

/* 另一个信号：英文句末有奇怪的标点残留（维基对齐常把引号/括号错位） */
let oddPunct = 0;
for (const [, v] of entries) {
  if (/["'）)】\]]\s*[.)]*$/.test(v.en) && !/^["'（(【\[]/.test(v.en)) oddPunct++;
}
console.log('\n英文句尾有悬空引号/括号的: ' + oddPunct + '  (' + ((oddPunct / entries.length) * 100).toFixed(1) + '%)');
