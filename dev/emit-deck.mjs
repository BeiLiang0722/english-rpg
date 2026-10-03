/* dev/emit-deck.mjs · 把 deck-final.json 产出为 App 的词库文件
 * 用法：node dev/emit-deck.mjs
 * 产出：
 *   app/data/words.json      —— 源数据（人工核对 + 校验脚本用）
 *   app/src/data/words.js    —— 运行时（<script> 直接加载，file:// 无需 fetch）
 *
 * 字段口径照 docs/03-PRD §3.2，并保留扩容新增的三个字段：
 *   example_cn    中文例句（可空）
 *   example_src   例句来源：tatoeba-pair / tatoeba-links / tatoeba-api / wikimatrix / tatoeba-en-only
 *   frq / collins / tags  ECDICT 的词频、柯林斯星级、四六级标签（用于选词与展示）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const SRC = path.join(CACHE, 'deck-final.json');
const OUT_JSON = path.join(ROOT, 'app', 'data', 'words.json');
const OUT_JS = path.join(ROOT, 'app', 'src', 'data', 'words.js');

const deck = JSON.parse(fs.readFileSync(SRC, 'utf8'));
console.log('源词数: ' + deck.length);

/* 输出字段顺序固定，便于 diff 与人工核对 */
const FIELDS = ['id', 'word', 'phonetic', 'pos', 'meaning_cn', 'meaning_en', 'example', 'example_cn', 'example_src', 'collins', 'frq', 'tags'];
const out = deck.map((w) => {
  const o = {};
  for (const f of FIELDS) {
    if (f === 'example_src') { if (w.example) o[f] = w.example_src || ''; continue; }
    if (w[f] !== undefined) o[f] = w[f];
  }
  return o;
});

fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 1) + '\n', 'utf8');
console.log('已写出 ' + OUT_JSON + '  ' + (fs.statSync(OUT_JSON).size / 1048576).toFixed(2) + ' MB');

/* 生成运行时形态：与 check-words.mjs --write 的格式保持一致（IIFE + WQ.WORDS） */
const body = JSON.stringify(out, null, 2).split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');
const js = [
  '/* src/data/words.js · 运行时词库（页面用 <script> 直接加载，file:// 下不需要 fetch）',
  ' * 数据来源（v0.3 扩容后）：',
  ' *   词表 / 中文释义 / 词频 / 四六级标签 —— ECDICT (skywind3000/ECDICT)，MIT',
  ' *   音标 —— open-dict-data/ipa-dict 的 en_US（标准 IPA，带重音标记），MIT',
  ' *   例句与中文翻译 —— Tatoeba (tatoeba.org)，CC BY 2.0 FR，需署名；',
  ' *                    少量由 WikiMatrix (OPUS) 补充，该源为自动对齐，可能存在错配（见字段 example_src）',
  ' * 字段口径：docs/03-PRD §3.2；不预存 distractors（干扰项运行时生成，见 docs/04 §7.4）。',
  ' * 唯一性：app/data/words.json 是同一份数据的 JSON 副本，仅供人工核对与 dev/check-words.mjs 校验，页面不加载。',
  ' * 生成方式：由 dev/emit-deck.mjs（或 dev/check-words.mjs --write）输出，请勿手工编辑（会与 words.json 漂移）。',
  ' */',
  '(function (WQ) {',
  "  'use strict';",
  '  WQ.WORDS = ' + body + ';',
  '})(window.WQ = window.WQ || {});',
  ''
].join('\n');
fs.writeFileSync(OUT_JS, js, 'utf8');
console.log('已写出 ' + OUT_JS + '  ' + (fs.statSync(OUT_JS).size / 1048576).toFixed(2) + ' MB');

const withEx = out.filter((w) => w.example).length;
const withCn = out.filter((w) => w.example_cn).length;
console.log('\n产出摘要：');
console.log('  词数        : ' + out.length);
console.log('  有例句      : ' + withEx + '  (' + ((withEx / out.length) * 100).toFixed(1) + '%)');
console.log('  有中文例句  : ' + withCn + '  (' + ((withCn / out.length) * 100).toFixed(1) + '%)');
const srcDist = {};
out.forEach((w) => { const k = w.example_src || '(无例句)'; srcDist[k] = (srcDist[k] || 0) + 1; });
console.log('  例句来源    : ' + JSON.stringify(srcDist));
