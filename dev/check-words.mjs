/* dev/check-words.mjs · 词库校验（开发期工具，非运行时依赖）
 * 依赖：node:fs / node:path
 * 用法：
 *   node dev/check-words.mjs            # 校验 app/data/words.json（默认，日常用这条）
 *   node dev/check-words.mjs --write    # 校验通过后由 app/data/words.json 重新生成 app/src/data/words.js
 *
 * 校验项照 docs/04 §7.5：
 *   数量 / 四字段非空 / 唯一性 / 例句含词且恰好 1 次 / 例句不重复 / 释义可用性 /
 *   音标格式 / 词性白名单 / 词性分布 / 干扰项可生成性（Q1、Q2 各 ≥95%）/ 长度与形态
 *
 * 分工：app/data/words.json 是"人工核对 + 机器校验"的源；app/src/data/words.js 是页面运行时加载的形态。
 *       两份数据必须一致，--write 负责同步（改词只改 JSON，然后重跑 --write）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DEV_DIR, '..');
const JSON_FILE = path.join(ROOT, 'app', 'data', 'words.json');
const JS_FILE = path.join(ROOT, 'app', 'src', 'data', 'words.js');

/* v0.3 扩容后的口径：词库来自 ECDICT 的 CET-4/6 全量词表（5802 词）。
 * 下面 4 处规则相对 v0.1（人工录入 200 词）做了放宽，每处都写明理由：
 *   1) 数量：不再要求恰好某个值，改为"不少于 MIN_COUNT"（扩容后是 5802，将来还会变）
 *   2) 词形：允许连字符复合词（by-product / father-in-law 是正当英语词形）
 *   3) 词长：允许 2 字母词（ad / ax / ox 都是正经 CET 词）
 *   4) 释义「使/见」开头：该规则本意是防人工录入偷懒；ECDICT 的「使膨胀 / 使暴露」是正当写法，
 *      改为只拦真正的空释义（见/同上/参见）
 */
const MIN_COUNT = 5800;
const POS_WHITELIST = new Set(['v.', 'n.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.', 'num.', '']);

const write = process.argv.includes('--write');

/* ---------- 读取并逐条校验 ---------- */
const raw = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
const errors = [];
const warnings = [];

if (!Array.isArray(raw)) {
  console.error('app/data/words.json 不是数组');
  process.exit(1);
}

const seenWord = new Map();
const seenExample = new Map();
const seenId = new Map();
const words = [];

raw.forEach((e, idx) => {
  const tag = '#' + (idx + 1) + ' ' + (e && e.word ? e.word : '(无 word)');
  const id = String(e && e.id || '').trim();
  const word = String(e && e.word || '').trim().toLowerCase();
  const phonetic = String(e && e.phonetic || '').trim();
  const pos = String(e && e.pos || '').trim();
  const meaningCn = String(e && e.meaning_cn || '').trim();
  const example = String(e && e.example || '').trim();
  const exampleCn = String(e && e.example_cn || '').trim();

  if (!id) errors.push(`${tag} 缺 id`);
  if (!word) errors.push(`${tag} word 为空`);
  if (!meaningCn) errors.push(`${tag} meaning_cn 为空`);
  /* phonetic / example 自 v0.3 起允许个别缺失（权威语料里确实找不到合格例句，或被内容过滤挡掉），
     改为在末尾统计覆盖率并设门槛；这里只记提醒，便于人工回补。 */
  if (!phonetic) warnings.push(`${tag} phonetic 为空`);
  if (!example) warnings.push(`${tag} example 为空`);
  if (!exampleCn) warnings.push(`${tag} example_cn 为空（允许，但建议补）`);

  if (exampleCn && !example) errors.push(`${tag} 有中文例句却没有英文例句`);

  if (id) {
    if (seenId.has(id)) errors.push(`重复 id ${id}（${seenId.get(id)} 与 ${tag}）`);
    else seenId.set(id, tag);
  }
  if (word) {
    if (seenWord.has(word)) { errors.push(`重复单词 ${word}（${seenWord.get(word)} 与 ${tag}）`); return; }
    seenWord.set(word, tag);
  }

  /* 词形：允许小写字母与连字符（by-product / father-in-law 是正当词形） */
  if (word && !/^[a-z]+(-[a-z]+)*$/.test(word)) errors.push(`${tag} 词形不合法（要求小写字母，可含连字符）：${word}`);
  if (word && word.replace(/-/g, '').length < 2) errors.push(`${tag} 词长过短：${word}`);
  if (!POS_WHITELIST.has(pos)) errors.push(`${tag} 词性不在白名单：${pos}`);

  /* 音标（v0.3 起为 ipa-dict 的标准 IPA）：要求含重音或 IPA 元音符号之一；
     单音节词可以没有重音符，属正常，故只提醒不报错 */
  if (phonetic && !/[ˈˌəɪʊæɒɔɜʌθðʃʒŋɝɛɫ]/.test(phonetic)) warnings.push(`${tag} 音标可能缺少重音/元音符号：${phonetic}`);

  if (meaningCn.length > 20) errors.push(`${tag} 释义超过 20 字：${meaningCn}`);
  if (/同上|参见/.test(meaningCn) || /(^|[；;、,，\s])见([；;、,，\s]|$)/.test(meaningCn)) {
    errors.push(`${tag} 释义含空释义词：${meaningCn}`);
  }

  /* 例句必须整词匹配、恰好出现 1 次（Q5 挖空据此出题）。
     用词边界并排除连字符：否则 accident-prone 里的 accident、eagle-owl 里的 owl 会误判为命中。 */
  if (word && example) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![a-z-])' + esc + '(?![a-z-])', 'gi');
    const hits = (example.match(re) || []).length;
    if (hits !== 1) errors.push(`${tag} 例句中 ${word} 出现 ${hits} 次（要求恰好 1 次）：${example}`);
    const exKey = example.toLowerCase();
    if (seenExample.has(exKey)) errors.push(`${tag} 例句与 ${seenExample.get(exKey)} 完全重复`);
    seenExample.set(exKey, tag);
  }

  words.push({ id, word, phonetic, pos, meaning_cn: meaningCn, example, example_cn: exampleCn });
});

/* ---------- 干扰项可生成性普查（docs/04 §7.4） ---------- */
function canBuild(type, w, all) {
  const key = type === 'Q1'
    ? (x) => String(x.meaning_cn).trim()[0]
    : (x) => String(x.word).trim()[0].toLowerCase();
  const samePos = all.filter((x) => x.id !== w.id && x.pos && x.pos === w.pos && key(x) !== key(w));
  if (samePos.length >= 3) return true;
  return all.filter((x) => x.id !== w.id && key(x) !== key(w)).length >= 3;
}
const q1ok = words.filter((w) => canBuild('Q1', w, words)).length;
const q2ok = words.filter((w) => canBuild('Q2', w, words)).length;
const q1rate = words.length ? q1ok / words.length : 0;
const q2rate = words.length ? q2ok / words.length : 0;

/* ---------- 汇总 ---------- */
const posStats = {};
words.forEach((e) => { posStats[e.pos || '(空)'] = (posStats[e.pos || '(空)'] || 0) + 1; });
const nonEmpty = words.filter((e) => e.word && e.phonetic && e.meaning_cn && e.example).length;
/* 例句去重统计：必须排除空例句——把 29 条"无例句"的空串当成重复是统计错误 */
const withExampleList = words.filter((e) => e.example);
const dupExamples = withExampleList.length - new Set(withExampleList.map((e) => e.example.toLowerCase())).size;

console.log('== 词库校验：' + path.relative(ROOT, JSON_FILE) + ' ==');
console.log('  数量: ' + words.length + '（要求 ≥' + MIN_COUNT + '）');
console.log('  词性分布: ' + JSON.stringify(posStats));
console.log('  唯一单词数: ' + new Set(words.map((e) => e.word)).size);
console.log('  唯一 id 数: ' + new Set(words.map((e) => e.id)).size);
/* v0.3 起改报"覆盖率"而不是"逐条必填"：词库来自权威源，个别词缺例句/音标是数据现实 */
const pctOf = (n) => (n / words.length * 100).toFixed(1) + '%';
const hasWord = words.filter((e) => e.word).length;
const hasPhon = words.filter((e) => e.phonetic).length;
const hasMean = words.filter((e) => e.meaning_cn).length;
const hasEx = words.filter((e) => e.example).length;
const hasExCn = words.filter((e) => e.example_cn).length;
const hasPos = words.filter((e) => e.pos).length;
console.log('  word     覆盖: ' + hasWord + '  ' + pctOf(hasWord));
console.log('  phonetic 覆盖: ' + hasPhon + '  ' + pctOf(hasPhon) + '（要求 ≥95%）');
console.log('  pos      覆盖: ' + hasPos + '  ' + pctOf(hasPos) + '（多词性的词按设计留空）');
console.log('  meaning_cn 覆盖: ' + hasMean + '  ' + pctOf(hasMean));
console.log('  example  覆盖: ' + hasEx + '  ' + pctOf(hasEx) + '（要求 ≥90%）');
console.log('  example_cn 覆盖: ' + hasExCn + '  ' + pctOf(hasExCn));
console.log('  重复例句数: ' + dupExamples);
console.log('  Q1 可生成率: ' + (q1rate * 100).toFixed(1) + '%（要求 ≥95%）');
console.log('  Q2 可生成率: ' + (q2rate * 100).toFixed(1) + '%（要求 ≥95%）');
if (warnings.length) {
  console.log('== 提醒 (' + warnings.length + ') ==');
  warnings.slice(0, 20).forEach((w) => console.log('  · ' + w));
  if (warnings.length > 20) console.log('  · …还有 ' + (warnings.length - 20) + ' 条');
}
if (errors.length) {
  console.log('== 错误 (' + errors.length + ') ==');
  errors.slice(0, 60).forEach((e) => console.log('  ✗ ' + e));
} else {
  console.log('== 错误 0 ==');
}

const blockers = [];
if (words.length < MIN_COUNT) blockers.push(`词条数 ${words.length} < ${MIN_COUNT}`);
if (errors.length) blockers.push(`存在 ${errors.length} 条字段错误`);
if (q1rate < 0.95) blockers.push('Q1 可生成率 < 95%');
if (q2rate < 0.95) blockers.push('Q2 可生成率 < 95%');
if (hasPhon / words.length < 0.95) blockers.push(`音标覆盖率 ${pctOf(hasPhon)} < 95%`);
if (hasEx / words.length < 0.90) blockers.push(`例句覆盖率 ${pctOf(hasEx)} < 90%`);
['v.', 'n.', 'adj.', 'adv.'].forEach((p) => {
  if ((posStats[p] || 0) < 12) blockers.push(`${p} 不足 12 词（当前 ${posStats[p] || 0}）`);
});
if (dupExamples > 0) blockers.push('存在完全重复的例句');

if (blockers.length) {
  console.log('== 结论: 未通过 ==');
  blockers.forEach((b) => console.log('  ✗ ' + b));
  process.exit(1);
}
console.log('== 结论: 通过 ==');

/* ---------- 同步生成 words.js ---------- */
if (write) {
  const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  const body = JSON.stringify(data, null, 2).split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');
  const js = [
    '/* src/data/words.js · 运行时词库（页面用 <script> 直接加载，file:// 下不需要 fetch）',
    ' * 数据来源：CET-4/CET-6 高频词人工录入（词形、音标、词性、中文释义、英文例句逐条核验）。',
    ' * 字段口径：docs/03-PRD §3.2；不预存 distractors（干扰项运行时生成，见 docs/04 §7.4）。',
    ' * 与 app/data/words.json 内容一致：改词只改 JSON，然后执行 node dev/check-words.mjs --write 同步。',
    ' */',
    '(function (WQ) {',
    "  'use strict';",
    '  WQ.WORDS = ' + body + ';',
    '})(window.WQ = window.WQ || {});',
    ''
  ].join('\n');
  fs.writeFileSync(JS_FILE, js, 'utf8');
  console.log('已同步: ' + path.relative(ROOT, JS_FILE));
}
