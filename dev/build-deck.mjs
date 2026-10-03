/* dev/build-deck.mjs · 构建词库：ECDICT（词表+释义） × ipa-dict（音标） × Tatoeba（例句）
 * 用法：
 *   node dev/build-deck.mjs --match      # 匹配例句，产出 <缓存>/deck-draft.json
 *   node dev/build-deck.mjs --report     # 只统计，不写文件
 *
 * 数据来源与许可（都要写进 README）：
 *   - 词表 / 中文释义 / 词频：(ECDICT) skywind3000/ECDICT，MIT
 *   - 音标：open-dict-data/ipa-dict 的 en_US（标准 IPA，带重音），MIT
 *   - 例句：Tatoeba（tatoeba.org），CC BY 2.0 FR，需署名
 *
 * 三项关键处理（都是踩坑后加的）：
 *   1. 词性只取 translation 的**首个标记**；一个词有多个不同词性时不猜，留空。
 *      踩过的坑：之前取"第一条义项的标记"，出现 national 标成 n.（实际 adj.）。
 *   2. 例句按词性对齐：动词词条优先挑"目标词真的当动词用"的句子。
 *      踩过的坑：state（n. 州；状态）配到 "does it state that..."（动词用法）。
 *   3. 例句内容过滤分两级，且一律用词边界。
 *      踩过的坑：把 hell/stupid 也挡了 → shellfish、Hellebrandt 被子串误杀，且这些词本身就是 CET 词。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const MODE = process.argv.includes('--report') ? 'report' : 'match';
const SEED = Number(process.env.WQ_SEED || 20261003);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 词性与例句形态判定 ---------------- */
const POS_MARKERS = { v: 'v.', n: 'n.', adj: 'adj.', adv: 'adv.', prep: 'prep.', conj: 'conj.', pron: 'pron.', num: 'num.' };
/** 取 translation 里出现过的所有词性标记（去重、保持首次出现顺序） */
function markerSet(translation) {
  const t = String(translation || '');
  const out = [];
  const re = /(?:^|[\s,;，；])(vt|vi|vbl|v|npl|ns|n|adj|adv|ad|a|prep|conj|pron|num|int|aux|abbr)\./gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const raw = m[1].toLowerCase();
    const key = raw.startsWith('v') ? 'v'
      : raw.startsWith('n') ? 'n'
      : raw === 'adj' || raw === 'a' ? 'adj'
      : raw === 'adv' || raw === 'ad' ? 'adv'
      : raw;
    const pos = POS_MARKERS[key];
    if (pos && !out.includes(pos)) out.push(pos);
  }
  return out;
}
/** 首个词性 —— 只有在"全篇只有一个词性"时才可信 */
function primaryPos(markers) {
  return markers.length === 1 ? markers[0] : '';
}

const DET = /\b(a|an|the|this|that|these|those|my|your|his|her|its|our|their|some|any|no|every|each|another|such)\b/i;
const PREP = /\b(of|in|on|at|to|for|with|from|by|about|into|over|after|before|between|under|through|during|without|against|among|within|across|behind|beyond|toward|towards|upon|via|per)\b/i;
const BE = /\b(is|are|was|were|be|been|being|am|seems?|appears?|looks?|feels?|becomes?|gets?|remains?|sounds?|tastes?|smells?)\b/i;
const VERB_CUE = /\b(to|will|would|can|could|shall|should|may|might|must|do|does|did|don't|doesn't|didn't|won't|can't|please|let's|lets|never|always|often|usually|just|really)\b/i;
const ADJ_NOUN = /\b(good|bad|very|so|too|quite|rather|extremely|really|more|most|less|least|as)\b/i;

/** 情态动词 / 助动词：本身既可当名词又可当助动词（might / may / can / will / must / should…）。
 *  这类词若在句中是"助动词 + 动词原形"的用法，就不该配名词义（踩过的坑：
 *  might 标 n. 力量；权力，例句却是 "It might sound far-fetched"）。 */
const MODAL = /\b(can|could|may|might|will|would|shall|should|must|ought|need|dare)\b/i;
const VERB_BASE_HINT = /\b(sound|be|have|do|go|come|get|make|take|see|know|think|say|tell|give|find|work|seem|look|feel|become|remain|stay|keep|let|put|run|set|turn|show|play|move|live|believe|happen|start|stop|grow|open|close|learn|teach|help|try|use|want|need|like|love|hate|speak|talk|ask|answer|call|mean|matter|cost|pay|bring|send|hold|stand|sit|lie|rise|fall|break|build|create|produce|provide|offer|accept|refuse|choose|decide|plan|hope|wish|expect|imagine|remember|forget|understand|explain|describe|include|contain|require|allow|prevent|avoid|reduce|increase|improve|change|begin|continue|finish|complete|achieve|solve|handle|manage|control|support|protect|attack|defend|own|possess|buy|sell|eat|drink|read|write|draw|sing|dance|walk|drive|fly|swim|climb|carry|drop|lift|push|pull|throw|catch|hit|cut|wear|wash|clean|cook|count|check|test|measure|compare|divide|join|connect|separate|return|leave|arrive|enter|follow|lead|join|share|borrow|lend|spend|save|earn|win|lose|fight|argue|agree|disagree|promise|refuse|admit|deny|notice|realize|discover|invent|design|paint|build|repair|fix|destroy|damage|hurt|heal|cure|treat|serve|deliver|collect|gather|spread|cover|hide|reveal|express|suggest|recommend|warn|threaten|praise|blame|forgive|thank|greet|invite|visit|join|marry|divorce|born|die)\b/i;

/** 目标词在句中的索引区间 */
function wordPos(lower, word) {
  for (let i = 0; i < lower.length; i++) if (lower[i] === word) return i;
  return -1;
}

/**
 * 例句与词性的形态一致性打分（>0 视为相符，<=0 视为不符）。
 * 这是启发式，不追求语言学精确，只用来把"明显是别的词性"的句子排到后面。
 */
function posFit(sentence, lower, word, pos) {
  const i = wordPos(lower, word);
  if (i < 0) return 0;
  const before1 = lower[i - 1] || '';
  const after1 = lower[i + 1] || '';
  /* 先判"助动词用法"：目标词后面紧跟动词原形 → 它在这里是助动词，不是名词/形容词 */
  const after2 = lower[i + 2] || '';
  const auxUse = (i > 0 && i < lower.length - 1 && VERB_BASE_HINT.test(after1) && !PREP.test(after1));
  switch (pos) {
    case 'v.':
      if (auxUse) return 2;
      if (VERB_CUE.test(sentence)) return 2;
      if (BE.test(sentence) && /\b\w+(ed|ing)\b/.test(lower.slice(Math.max(0, i - 2), i + 2).join(' '))) return 1;
      return 0;
    case 'n.': {
      // 助动词用法：明确不是名词用法，直接判负
      if (auxUse) return -2;
      let s = 0;
      if (DET.test(sentence)) s += 1;
      if (PREP.test(sentence)) s += 1;
      if (i > 0 && PREP.test(before1)) s += 1;   // 名词常在介词后
      if (after1 && PREP.test(after1)) s += 1;   // 名词后接 of/in/to
      if (s === 0 && VERB_CUE.test(sentence)) return -2;
      return s;
    }
    case 'adj.':
      if (auxUse) return 1;                       // "might sound" 里的 sound 是形容词补语位，但目标词是助动词时不算
      if (BE.test(sentence)) return 2;
      if (ADJ_NOUN.test(sentence)) return 1;
      if (DET.test(sentence) && after1) return 1;
      return 0;
    case 'adv.':
      return ADJ_NOUN.test(sentence) || VERB_CUE.test(sentence) ? 1 : 0;
    default:
      return 0;
  }
}

/* ---------------- 语料过滤 ---------------- */
const HARD = /\b(porn\w*|porno|erotic|nude|naked|rape|raped|rapist|prostitut\w*|whore|slut|bitch|fuck\w*|shit\w*|cunt|cock|penis|vagina|boobs?|tits?|orgasm|masturbat\w*|condom|nigger|fag|retard\w*|suicide|suicidal|skinflick\w*|sleazy|brothel|stripper|striptease|orgy|orgies|pimp|hooker|abortion\w*|syphilis|gonorrhea|diarrhea|vomit\w*|feces|fart\w*|booze|hangover|slave|slaves|slavery|slaveholder|enslaved|human trafficking)\b/i;
const EXPLICIT_CONTEXT = /\b(i|we|you|let's|lets)\b[^.]{0,40}\b(kill|shoot|stab|beat|murder|hang|rape)\b|\b(kill|shoot|stab|beat|hang)\s+(him|her|them|me|us|you)\b/i;
const CJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
/** 网络梗 / 胡话类：这类句子在 Tatoeba 里不少，做例句会让人以为英语就是这样 */
const NONSENSE = /\b(fart\w*|poop\w*|burp\w*|booger\w*|butt\b|toilet|urinal|diaper|nipple|booger)\b/i;

/* ---------------- 载入各数据源 ---------------- */
const cetFile = path.join(CACHE, 'cet-words.json');
if (!fs.existsSync(cetFile)) { console.error('缺少 cet-words.json，先跑 node dev/build-cet-words.mjs'); process.exit(1); }
const cet = JSON.parse(fs.readFileSync(cetFile, 'utf8'));
const byWord = new Map(cet.map((w) => [w.word.toLowerCase(), w]));

const ipaFile = fs.readdirSync(CACHE).find((f) => /^ipa-.*en_US\.json$/.test(f));
const ipa = ipaFile ? JSON.parse(fs.readFileSync(path.join(CACHE, ipaFile), 'utf8')) : {};
console.log('目标词: ' + byWord.size + '；IPA 词条: ' + Object.keys(ipa).length + (ipaFile ? '' : '（缺！）'));

const corpusName = fs.readdirSync(CACHE).find((f) => /^eng-.*\.tsv$/.test(f));
if (!corpusName) { console.error('缓存里没有 eng-*.tsv'); process.exit(1); }
const corpusPath = path.join(CACHE, corpusName);
console.log('语料: ' + corpusName + '  ' + (fs.statSync(corpusPath).size / 1048576).toFixed(1) + ' MB');

/* ---------------- 流式匹配 ---------------- */
const ALTS_PER_WORD = 8;
const buckets = new Map();     // word -> Map<句长, {sentence,id,fit}>
const altsByWord = new Map();  // word -> [{sentence,id,n,fit}]（按词性相符优先、长度靠近 10 词排序）
const hist = {}, histHit = {};
let totalLines = 0, hitLines = 0, droppedByContent = 0;

const stream = fs.createReadStream(corpusPath, { encoding: 'utf8', highWaterMark: 1 << 20 });
let buf = '';
const t0 = Date.now();

for await (const chunk of stream) {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const c1 = line.indexOf('\t');
    if (c1 < 0) continue;
    const c2 = line.indexOf('\t', c1 + 1);
    if (c2 < 0) continue;
    const sentence = line.slice(c2 + 1).trim();
    if (!sentence || sentence.length > 150) continue;
    if (/https?:|www\.|@/.test(sentence)) continue;
    if (HARD.test(sentence) || EXPLICIT_CONTEXT.test(sentence) || NONSENSE.test(sentence) || CJK.test(sentence)) {
      droppedByContent++;
      continue;
    }

    const words = sentence.split(/\s+/);
    const n = words.length;
    if (n < 3 || n > 30) continue;
    totalLines++;
    hist[n] = (hist[n] || 0) + 1;

    const lower = words.map((w) => w.toLowerCase().replace(/^[^a-z]+|[^a-z']+$/g, ''));
    let anyHit = false;
    for (let i = 0; i < lower.length; i++) {
      const w = lower[i];
      const entry = w ? byWord.get(w) : null;
      if (!entry) continue;
      let count = 0;
      for (const x of lower) if (x === w) count++;
      if (count !== 1) continue;
      anyHit = true;
      histHit[n] = (histHit[n] || 0) + 1;

      const fit = entry.pos ? posFit(sentence, lower, w, entry.pos) : 0;
      let byLen = buckets.get(w);
      if (!byLen) { byLen = new Map(); buckets.set(w, byLen); }
      const prev = byLen.get(n);
      if (!prev || fit > prev.fit) byLen.set(n, { sentence, id: line.slice(0, c1), fit });

      if (n >= 7 && n <= 16) {
        let alts = altsByWord.get(w);
        if (!alts) { alts = []; altsByWord.set(w, alts); }
        if (!alts.some((x) => x.sentence === sentence)) {
          alts.push({ sentence, id: line.slice(0, c1), n, fit });
          // 排序键：词性相符优先 → 长度靠近 10 词优先
          alts.sort((a, b) => (b.fit - a.fit) || (Math.abs(a.n - 10) - Math.abs(b.n - 10)));
          if (alts.length > ALTS_PER_WORD) alts.length = ALTS_PER_WORD;
        }
      }
    }
    if (anyHit) hitLines++;
  }
}

const fmt = (o, max = 18) => Object.keys(o).map(Number).sort((a, b) => a - b)
  .slice(0, max).map((k) => k + ':' + o[k]).join(' ');
console.log('\n扫描 ' + totalLines + ' 行（' + ((Date.now() - t0) / 1000).toFixed(1) + 's），含目标词 ' + hitLines
  + '，因内容被过滤 ' + droppedByContent);
console.log('全部句子长度直方图 : ' + fmt(hist));
console.log('含目标词长度直方图 : ' + fmt(histHit));

/* ---------------- 组词条：音标换成 IPA，例句按词性挑 ---------------- */
const rnd = mulberry32(SEED);
const deck = [];
for (const w of cet) {
  const key = w.word.toLowerCase();
  const byLen = buckets.get(key);
  const alts = altsByWord.get(key) || [];
  let pick = null;

  if (byLen && byLen.size) {
    // 先看有没有"词性相符"的候选（fit > 0）；有就只在相符的里面挑，没有才退回全部
    const all = [...byLen.entries()].map(([n, v]) => ({ n, ...v }));
    const fitting = all.filter((c) => c.fit > 0);
    const pool = fitting.length ? fitting : all;
    const weight = (n) => (n >= 8 && n <= 12 ? 1 : n >= 7 && n <= 16 ? 0.5 : 0.15);
    const ws = pool.map((c) => weight(c.n));
    const total = ws.reduce((a, b) => a + b, 0);
    let r = rnd() * total;
    pick = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) { pick = pool[i]; break; } }
  }

  const example = pick ? pick.sentence : '';
  const exampleId = pick ? String(pick.id) : '';
  const altList = [{ sentence: example, id: exampleId, fit: pick ? pick.fit : 0 }]
    .filter((x) => x.sentence)
    .concat(alts.filter((a) => a.sentence !== example));

  deck.push({
    ...w,
    phonetic: ipa[key] || '',            // 用 IPA 覆盖 ECDICT 的老式转写
    phonetic_ecdict: w.phonetic || '',    // 原值留档，便于核对与回退
    example,
    example_id: exampleId,
    example_fit: pick ? pick.fit : 0,
    alts: altList
  });
}

const withEx = deck.filter((w) => w.example);
const withIpa = deck.filter((w) => w.phonetic);
const posKnown = deck.filter((w) => w.pos);
console.log('\n=== 结果 ===');
console.log('  词条总数        : ' + deck.length);
console.log('  有例句          : ' + withEx.length + '  (' + ((withEx.length / deck.length) * 100).toFixed(1) + '%)');
console.log('  有 IPA 音标     : ' + withIpa.length + '  (' + ((withIpa.length / deck.length) * 100).toFixed(1) + '%)');
console.log('  词性可确证      : ' + posKnown.length + '  (' + ((posKnown.length / deck.length) * 100).toFixed(1) + '%)  ← 多词性的一律留空');
const fitDist = {};
withEx.forEach((w) => { const k = w.example_fit > 0 ? '相符' : '未判'; fitDist[k] = (fitDist[k] || 0) + 1; });
console.log('  例句词性相符    : ' + JSON.stringify(fitDist));
const lenDist = {};
withEx.forEach((w) => { const n = w.example.split(/\s+/).length; lenDist[n] = (lenDist[n] || 0) + 1; });
console.log('  例句长度分布    : ' + fmt(lenDist));

console.log('\n--- 抽样 12 条 ---');
for (let i = 0; i < 12; i++) {
  const w = deck[Math.floor((i + 0.5) * (deck.length / 12))];
  console.log('  ' + w.word.padEnd(15) + (w.pos || '—').padEnd(6) + (w.phonetic || '—').padEnd(20) + w.meaning_cn);
  console.log('      ' + (w.example || '（无例句）') + (w.example_fit > 0 ? '' : '   [词性未确证]'));
}

if (MODE === 'match') {
  const out = path.join(CACHE, 'deck-draft.json');
  fs.writeFileSync(out, JSON.stringify(deck, null, 1));
  console.log('\n已写出: ' + out + '  ' + (fs.statSync(out).size / 1048576).toFixed(2) + ' MB');
}
