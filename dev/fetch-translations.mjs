/* dev/fetch-translations.mjs · 为 deck-draft 里的英语例句抓取 Tatoeba 中文翻译
 * 用法：
 *   node dev/fetch-translations.mjs            # 增量抓取（已缓存的 id 跳过）
 *   node dev/fetch-translations.mjs --limit 200  # 只处理前 N 个（试跑用）
 * 产物：<缓存目录>/sentences-cmn.json = { "<id>": {cn, note} }
 *
 * 说明：
 *   - Tatoeba 一个英语句子可能对应多条中文（简繁并存），这里优先取简体
 *   - 每 100 条落一次盘；中断后重跑会自动跳过已抓的
 *   - 单请求 ~1s，5763 条约 10~15 分钟
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const DRAFT = path.join(CACHE, 'deck-draft.json');
const OUT = path.join(CACHE, 'sentences-cmn.json');
const HEAD = { 'user-agent': 'dsh-english-rpg/0.3 (personal study project)', accept: 'application/json' };

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

if (!fs.existsSync(DRAFT)) { console.error('缺少 ' + DRAFT +'，先跑 node dev/build-deck.mjs --match'); process.exit(1); }
const deck = JSON.parse(fs.readFileSync(DRAFT, 'utf8'));

/** 需要翻译的英语句子 id 集合 */
const ids = [...new Set(deck.filter((w) => w.example_id).map((w) => String(w.example_id)))];
console.log('需要翻译的句子: ' + ids.length + ' 条（覆盖 ' + deck.filter((w) => w.example_id).length + ' 个词）');

const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const todo = ids.filter((id) => !(id in cache));
console.log('已缓存 ' + Object.keys(cache).length + ' 条，待抓 ' + todo.length + ' 条' + (LIMIT !== Infinity ? '（本次上限 ' + LIMIT + '）' : ''));

/** 判断简体优先：含简体特征字则更可能是简体 */
const TRAD_ONLY = /[們來這個說話時實現發學會國語點見愛與體為對開關門問間樣種類經過應該動聽讀寫課練習題考試漢語詞彙]/;
const SIMP_ONLY = /[们来这个说话时实现发学会国语点见爱与体为对开关门问间样种类经过应该动听读写课练习题考试汉语词汇]/;
function scoreCn(text) {
  let s = 0;
  if (SIMP_ONLY.test(text)) s += 2;
  if (TRAD_ONLY.test(text)) s -= 1;
  return s;
}
function pickCn(sentenceJson) {
  const found = [];
  (function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === 'object') {
      if (node.lang === 'cmn' && typeof node.text === 'string' && node.text) found.push({ id: node.id, text: node.text });
      Object.values(node).forEach(walk);
    }
  })(sentenceJson.translations);
  if (!found.length) return null;
  found.sort((a, b) => scoreCn(b.text) - scoreCn(a.text) || a.text.length - b.text.length);
  return found[0].text;
}

let done = 0, ok = 0, miss = 0, fail = 0;
const t0 = Date.now();
const targets = todo.slice(0, LIMIT === Infinity ? todo.length : LIMIT);

for (const id of targets) {
  let attempt = 0;
  while (attempt < 3) {
    try {
      const r = await fetch('https://tatoeba.org/en/api_v0/sentence/' + id, { headers: HEAD });
      if (r.status === 429) { await new Promise((res) => setTimeout(res, 3000)); attempt++; continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const cn = pickCn(j);
      if (cn) { cache[id] = { cn, note: 'tatoeba' }; ok++; } else { cache[id] = { cn: '', note: 'no-cmn' }; miss++; }
      break;
    } catch (e) {
      attempt++;
      if (attempt >= 3) { fail++; console.log('  失败 id=' + id + ' -> ' + e.message); }
      else await new Promise((res) => setTimeout(res, 800));
    }
  }
  done++;
  if (done % 100 === 0) {
    fs.writeFileSync(OUT, JSON.stringify(cache));
    const el = (Date.now() - t0) / 1000;
    const rate = done / el;
    const left = (targets.length - done) / (rate || 1);
    console.log('  ' + done + '/' + targets.length + '  命中 ' + ok + ' 无中文 ' + miss + ' 失败 ' + fail
      + '  用时 ' + el.toFixed(0) + 's  预计剩余 ' + left.toFixed(0) + 's');
  }
  await new Promise((res) => setTimeout(res, 300));
}

fs.writeFileSync(OUT, JSON.stringify(cache));
console.log('\n完成：处理 ' + done + ' 条，命中中文 ' + ok + '，无中文 ' + miss + '，失败 ' + fail);
console.log('缓存: ' + OUT + '  ' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
const cov = Object.values(cache).filter((v) => v.cn).length;
console.log('累计有中文的句子: ' + cov + ' / ' + ids.length + '  (' + ((cov / ids.length) * 100).toFixed(1) + '%)');
