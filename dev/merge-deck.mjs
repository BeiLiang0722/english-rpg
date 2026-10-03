/* dev/merge-deck.mjs · 把「CET 词表 + 英语例句 + 中文翻译」合成最终词库
 * 用法：
 *   node dev/merge-deck.mjs --links      # 从 links.tar.bz2 + cmn_sentences 建英中句对映射（慢，几百 MB）
 *   node dev/merge-deck.mjs --apply      # 用已有映射 + sentences-cmn.json 合成 deck-final.json
 *   node dev/merge-deck.mjs --report     # 只看覆盖率，不写文件
 *
 * 前置：
 *   - <缓存>/deck-draft.json        （dev/build-deck.mjs --match）
 *   - <缓存>/links-links.tar.bz2    （dev/fetch-corpus.mjs links）
 *   - <缓存>/cmn-cmn_sentences.tsv.bz2（dev/fetch-corpus.mjs cmn）
 *   - <缓存>/sentences-cmn.json     （dev/fetch-translations.mjs，API 兜底，可缺）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const DRAFT = path.join(CACHE, 'deck-draft.json');
const PAIRS = path.join(CACHE, 'pairs-en-cmn.json');
const CMN_SENTENCES = path.join(CACHE, 'cmn-sentences.json');
const API_CN = path.join(CACHE, 'sentences-cmn.json');
const WM_EX = path.join(CACHE, 'examples-wm.json');
const TAT_EX = path.join(CACHE, 'examples-tatoeba.json');
const SEVEN_ZIP = 'C:\\Users\\bu\\scoop\\shims\\7z.exe';

const mode = process.argv.includes('--links') ? 'links'
  : process.argv.includes('--apply') ? 'apply'
  : 'report';

function loadJson(f, fallback = null) {
  if (!fs.existsSync(f)) return fallback;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
}

if (!fs.existsSync(DRAFT)) { console.error('缺少 ' + DRAFT); process.exit(1); }
const deck = JSON.parse(fs.readFileSync(DRAFT, 'utf8'));
const needIds = new Set(deck.filter((w) => w.example_id).map((w) => String(w.example_id)));
console.log('草稿词数 ' + deck.length + '，其中需要中文的英语句 ' + needIds.size + ' 条');

/* ---------------- links 模式：解压并用流式扫描建映射 ---------------- */
if (mode === 'links') {
  const bz2 = fs.readdirSync(CACHE).find((f) => /^links-.*\.tar\.bz2$/.test(f));
  if (!bz2) { console.error('缓存里没有 links-*.tar.bz2，先跑 node dev/fetch-corpus.mjs links'); process.exit(1); }
  const full = path.join(CACHE, bz2);
  console.log('解压 ' + bz2 + '  ' + (fs.statSync(full).size / 1048576).toFixed(1) + ' MB');
  /* links.tar.bz2 是双层容器：先 bz2 → links.tar，再 tar → links.csv。
     7z 一次只解一层，所以这里显式解两层（踩过一次：只解开第一层就去找 csv，找不到）。 */
  execFileSync(SEVEN_ZIP, ['x', full, '-o' + CACHE, '-y'], { stdio: 'inherit' });
  const tarFile = fs.readdirSync(CACHE).find((f) => /^links.*\.tar$/i.test(f));
  if (tarFile) {
    console.log('解第二层 ' + tarFile + '  ' + (fs.statSync(path.join(CACHE, tarFile)).size / 1048576).toFixed(1) + ' MB');
    execFileSync(SEVEN_ZIP, ['x', path.join(CACHE, tarFile), '-o' + CACHE, '-y'], { stdio: 'inherit' });
  }

  const linksFile = fs.readdirSync(CACHE).find((f) => /^links.*\.(csv|tsv)$/i.test(f));
  if (!linksFile) { console.error('解压后没找到 links*.csv/tsv，目录内容：' + fs.readdirSync(CACHE).join(', ')); process.exit(1); }
  console.log('links 文件: ' + linksFile + '  ' + (fs.statSync(path.join(CACHE, linksFile)).size / 1048576).toFixed(1) + ' MB');

  // 先建"中文句 id -> 文本"，再用 links 把英语 id 映射到中文 id
  const cmnBz2 = fs.readdirSync(CACHE).find((f) => /^cmn-.*\.bz2$/.test(f));
  if (!cmnBz2) { console.error('缓存里没有 cmn-*.bz2，先跑 node dev/fetch-corpus.mjs cmn'); process.exit(1); }
  console.log('解压中文句子 ' + cmnBz2);
  execFileSync(SEVEN_ZIP, ['x', path.join(CACHE, cmnBz2), '-o' + CACHE, '-y'], { stdio: 'inherit' });
  const cmnTsv = fs.readdirSync(CACHE).find((f) => /^cmn-.*\.tsv$/.test(f));
  console.log('中文句子文件: ' + cmnTsv);

  /* 关键：先把中文句 id 与文本全部读进来。
     Tatoeba 的 links 是**全语种互译对**，"英语句 ↔ 中文句"只占极小一部分；
     若把目标英语句的所有邻居都当中文，会得到一堆根本不存在于中文表中的 id
     （踩过的坑：18680 个"中文 id"最后只取出 309 条文本）。 */
  const cmnText = new Map();   // id -> 文本
  const cmnIds = new Set();
  let cbuf = '';
  const rs2 = fs.createReadStream(path.join(CACHE, cmnTsv), { encoding: 'utf8', highWaterMark: 1 << 20 });
  for await (const chunk of rs2) {
    cbuf += chunk;
    let nl;
    while ((nl = cbuf.indexOf('\n')) >= 0) {
      const line = cbuf.slice(0, nl).replace(/\r$/, '');
      cbuf = cbuf.slice(nl + 1);
      if (!line) continue;
      const c1 = line.indexOf('\t');
      if (c1 < 0) continue;
      const c2 = line.indexOf('\t', c1 + 1);
      if (c2 < 0) continue;
      const id = line.slice(0, c1);
      cmnIds.add(id);
      cmnText.set(id, line.slice(c2 + 1).trim());
    }
  }
  console.log('中文句总数: ' + cmnIds.size);

  /* 扫 links：把所有"英语句 ↔ 中文句"配对都建出来，而不是只查我挑中的那几句。
     为什么：之前只对 5714 条候选英语句查中文，命中 293；
     但 Tatoeba 有 8.9 万条中文句，对应的英语句数量远大于此 —— 反着捞能拿到多得多的可靠中文例句。 */
  const enToCmn = new Map();  // en_id -> cmn_id
  const linkedEnIds = new Set();
  let buf = '';
  let n = 0;
  const rs = fs.createReadStream(path.join(CACHE, linksFile), { encoding: 'utf8', highWaterMark: 1 << 20 });
  const t0 = Date.now();
  for await (const chunk of rs) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const cols = line.split('\t');
      if (cols.length < 2) continue;
      const a = cols[0], b = cols[1];
      n++;
      if (cmnIds.has(b) && !cmnIds.has(a)) { enToCmn.set(a, b); linkedEnIds.add(a); }
      else if (cmnIds.has(a) && !cmnIds.has(b)) { enToCmn.set(b, a); linkedEnIds.add(b); }
      if (n % 10000000 === 0) {
        console.log('  已扫 ' + (n / 1e6).toFixed(0) + 'M 行，英中配对 ' + enToCmn.size + '（' + ((Date.now() - t0) / 1000).toFixed(0) + 's）');
      }
    }
  }
  console.log('links 行数 ' + n + '，捞出英中配对 ' + enToCmn.size + ' 对');
  console.log('其中命中我挑中的候选句: ' + [...enToCmn.keys()].filter((id) => needIds.has(id)).length + ' / ' + needIds.size);

  const pairs = {};
  for (const [enId, cmnId] of enToCmn) {
    const t = cmnText.get(cmnId);
    if (t) pairs[enId] = t;
  }
  fs.writeFileSync(PAIRS, JSON.stringify(pairs));
  fs.writeFileSync(path.join(CACHE, 'linked-en-ids.json'), JSON.stringify([...linkedEnIds]));
  console.log('已写出句对映射: ' + PAIRS + '  覆盖 ' + Object.keys(pairs).length + ' 条英语句');
  console.log('已写出"有中文配对的英语句 id"清单: ' + linkedEnIds.size + ' 条（下一步用它去英中句里找 CET 词例句）');
  process.exit(0);
}

/* ---------------- apply / report ---------------- */
const pairs = loadJson(PAIRS, {});
const apiCn = loadJson(API_CN, {});
const wmEx = loadJson(WM_EX, {});
const tatEx = loadJson(TAT_EX, {});
console.log('质量分层：① Tatoeba 可靠英中句对 ' + Object.keys(tatEx).length + ' 词'
  + '；② Tatoeba links 句对 ' + Object.keys(pairs).length + ' 条 + API ' + Object.keys(apiCn).length + ' 条'
  + '；③ WikiMatrix（自动对齐，约 8~12% 错配）' + Object.keys(wmEx).length + ' 词');

/** 取某条英语句的中文：先查 links 句对，再查 API 缓存 */
function cnOf(id) {
  const k = String(id || '');
  if (!k) return '';
  if (pairs[k]) return pairs[k];
  if (apiCn[k] && apiCn[k].cn) return apiCn[k].cn;
  return '';
}
/** 目标词在句中是否**恰好出现 1 次**（Q5 挖空的前提，PRD §4.4 硬规则）。
 *  必须排除连字符复合词：accident-prone 里的 accident、eagle-owl 里的 owl 都会让挖空失效。 */
function wordHits(sentence, word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?<![a-z-])' + esc + '(?![a-z-])', 'gi');
  return (sentence.match(re) || []).length;
}

/* 词性粗校验（与 build-deck 的 posFit 同一判据的精简版）：
   只用来否掉"明显是别的词性"的句子——例如 might 标 n.（力量）却配到情态动词用法。
   宁可退到次一级来源（或只有英文），也不要给学习者一个词性错配的例句。 */
const VERB_HINT = /\b(sound|be|have|do|go|come|get|make|take|see|know|think|say|tell|give|find|work|seem|look|feel|become|remain|stay|keep|let|put|run|set|turn|show|play|move|live|believe|happen|start|stop|grow|open|close|learn|teach|help|try|use|want|need|like|love|hate|speak|talk|ask|answer|call|mean|matter|cost|pay|bring|send|hold|stand|sit|lie|rise|fall|break|build|create|produce|provide|offer|accept|refuse|choose|decide|plan|hope|wish|expect|imagine|remember|forget|understand|explain|describe|include|contain|require|allow|prevent|avoid|reduce|increase|improve|change|begin|continue|finish|complete|achieve|solve|handle|manage|control|support|protect|attack|defend)\b/i;
/** 目标词若处在"助动词 + (副词/插入语) + 动词原形"位置，则它在句中是助动词，不可能是名词/形容词用法。
 *  允许跳过中间的副词与从句引导词：might **also** produce / might **that it** produce（维基句里真出现过）。 */
const SKIP = /^(also|still|just|even|only|never|always|often|usually|really|simply|actually|probably|possibly|certainly|indeed|rather|quite|very|too|so|well|then|now|here|there|that|it|they|we|you|he|she|i|not|n't|have|has|had|be|been|being|at|worst|best|least|most|all|the|a|an)$/;
function auxUseIn(sentence, word) {
  const words = sentence.split(/\s+/).map((w) => w.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, ''));
  const i = words.indexOf(word.toLowerCase());
  if (i <= 0 || i >= words.length - 1) return false;
  for (let k = i + 1; k < Math.min(words.length, i + 6); k++) {
    const w = words[k];
    if (!w) continue;
    if (VERB_HINT.test(w)) return true;   // 撞到动词原形 → 目标词是助动词
    if (!SKIP.test(w)) return false;      // 撞到别的实词 → 不是助动词用法
  }
  return false;
}
/** 返回 true 表示"词性明显不符，应换一句" */
function posMismatch(sentence, w) {
  if (!w.pos) return false;
  if ((w.pos === 'n.' || w.pos === 'adj.') && auxUseIn(sentence, w.word)) return true;
  return false;
}

/* 例句去重：按词频从高到低处理（词的顺序已经是 frq 升序），同一句只归一个词。
   WikiMatrix 只在"可靠的英中句对都用不上"时才启用，且例句与中文成对取自同一行
   —— 不能一边用 Tatoeba 的英文、一边配 WikiMatrix 的中文，那是两句不同的话。 */
const usedSentences = new Set();
let fromTatPair = 0, fromLinks = 0, fromApi = 0, fromAlt = 0, fromWm = 0, none = 0, dedup = 0, hitFixed = 0, posRejected = 0;

const ordered = [...deck].sort((a, b) => a.frq - b.frq);
const resultById = new Map();

for (const w of ordered) {
  let chosen = null;

  /* 第一层（最高质量）：Tatoeba 可靠英中句对（人工维护的翻译）。
     这一步的例句与中文成对来自同一句对，不做拆配。 */
  const tat = tatEx[w.word.toLowerCase()];
  if (tat && tat.en && tat.zh) {
    const key = tat.en.toLowerCase();
    if (!usedSentences.has(key) && wordHits(tat.en, w.word) === 1 && !posMismatch(tat.en, w)) {
      chosen = { sentence: tat.en, id: String(tat.id || ''), cn: tat.zh, src: 'tatoeba-pair' };
      fromTatPair++;
    } else if (posMismatch(tat.en, w)) {
      posRejected++;
    }
  }

  /* 第二层：我在 build-deck 里挑的候选句（主 + 备选），要求它在 links 里有可靠中文配对 */
  if (!chosen) {
    const cands = [{ sentence: w.example, id: String(w.example_id || '') }]
      .concat((w.alts || []).map((a) => ({ sentence: a.sentence, id: String(a.id) })))
      .filter((c) => c.sentence);
    for (const c of cands) {
      const cn = cnOf(c.id);
      if (!cn) continue;                                   // 没中文配对的先跳过，留给后面几层
      const key = c.sentence.toLowerCase();
      if (usedSentences.has(key)) { dedup++; continue; }
      if (wordHits(c.sentence, w.word) !== 1) { hitFixed++; continue; }
      chosen = { sentence: c.sentence, id: c.id, cn, src: pairs[c.id] ? 'tatoeba-links' : 'tatoeba-api' };
      if (pairs[c.id]) fromLinks++; else fromApi++;
      if (c.sentence !== w.example) fromAlt++;
      break;
    }
  }

  /* 第三层：WikiMatrix（自动对齐，中英成对给，只用于填空缺，错配率约 8~12%） */
  if (!chosen) {
    const wm = wmEx[w.word.toLowerCase()];
    if (wm && wm.en && wm.zh) {
      const key = wm.en.toLowerCase();
      if (!usedSentences.has(key) && wordHits(wm.en, w.word) === 1 && !posMismatch(wm.en, w)) {
        chosen = { sentence: wm.en, id: '', cn: wm.zh, src: 'wikimatrix' };
        fromWm++;
      } else if (posMismatch(wm.en, w)) {
        posRejected++;
      }
    }
  }

  /* 第四层：实在没有中文的，退回纯英文例句（宁可只有英文，也不要错配的中文） */
  if (!chosen) {
    const cands = [{ sentence: w.example, id: String(w.example_id || '') }]
      .concat((w.alts || []).map((a) => ({ sentence: a.sentence, id: String(a.id) })))
      .filter((c) => c.sentence);
    for (const c of cands) {
      const key = c.sentence.toLowerCase();
      if (usedSentences.has(key)) { dedup++; continue; }
      if (wordHits(c.sentence, w.word) !== 1) { hitFixed++; continue; }
      if (posMismatch(c.sentence, w)) { posRejected++; continue; }
      chosen = { sentence: c.sentence, id: c.id, cn: '', src: 'tatoeba-en-only' };
      break;
    }
  }

  if (!chosen) {
    resultById.set(w.id, { ...w, example: '', example_id: '', example_cn: '', example_fit: 0, example_src: '' });
    none++;
    continue;
  }
  usedSentences.add(chosen.sentence.toLowerCase());
  resultById.set(w.id, {
    ...w,
    example: chosen.sentence,
    example_id: chosen.id,
    example_cn: chosen.cn,
    example_src: chosen.src
  });
}

const final = deck.map((w) => resultById.get(w.id));

console.log('\n=== 合并结果（按质量分层）===');
console.log('  ① Tatoeba 可靠英中句对 : ' + fromTatPair + '   ← 人工维护，最可靠');
console.log('  ② Tatoeba links 句对   : ' + fromLinks);
console.log('  ② Tatoeba API          : ' + fromApi);
console.log('  ③ WikiMatrix 自动对齐  : ' + fromWm + '   ← 约 8~12% 错配，已在 README 与字段里标注');
console.log('  ④ 仅英文、无中文       : ' + final.filter((w) => w.example && !w.example_cn).length);
const reliableCn = fromTatPair + fromLinks + fromApi;
const allCn = final.filter((w) => w.example_cn).length;
console.log('  ——可靠中文合计         : ' + reliableCn + ' / ' + final.length
  + '  (' + ((reliableCn / final.length) * 100).toFixed(1) + '%)');
console.log('  ——中文合计（含自动对齐）: ' + allCn + ' / ' + final.length
  + '  (' + ((allCn / final.length) * 100).toFixed(1) + '%)');
console.log('  因去重换掉的候选      : ' + dedup);
console.log('  因"目标词非恰好1次"换掉: ' + hitFixed);
console.log('  因词性明显不符被否掉  : ' + posRejected + '（例如 might 标 n. 却配到情态动词用法）');
console.log('  最终无任何例句        : ' + none);
console.log('  有英文例句            : ' + final.filter((w) => w.example).length + ' / ' + final.length);
const dupLeft = new Set(final.filter((w) => w.example).map((w) => w.example.toLowerCase())).size;
const uniqExpected = final.filter((w) => w.example).length;
console.log('  例句重复数            : ' + (uniqExpected - dupLeft) + '（应为 0）');
const hitBad = final.filter((w) => w.example && wordHits(w.example, w.word) !== 1);
console.log('  挖空失效的例句        : ' + hitBad.length + '（应为 0）');
hitBad.slice(0, 5).forEach((w) => console.log('      ' + w.word + ': ' + w.example));

if (mode === 'apply') {
  const out = path.join(CACHE, 'deck-final.json');
  // alts / phonetic_ecdict / example_fit 只是构建期中间产物，不进最终词库
  const slim = final.map(({ alts, phonetic_ecdict, example_fit, ...rest }) => rest);
  fs.writeFileSync(out, JSON.stringify(slim, null, 1));
  console.log('\n已写出: ' + out + '  ' + (fs.statSync(out).size / 1048576).toFixed(2) + ' MB');
}
