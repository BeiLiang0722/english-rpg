/* dev/build-cet-words.mjs · 从 ECDICT 提取 CET-4/6 词表（临时工具，产物入临时目录）
 * 用法：node dev/build-cet-words.mjs
 * 输出：<缓存目录>/cet-words.json = [{id, word, phonetic, pos, meaning_cn, meaning_en, frq, tags, collins}]
 *
 * 关键处理（照实测结论）：
 *   - ECDICT 的 `pos` 列在 CET 词上 100% 为空 → 从 `translation` 的 `vt./n./adj.` 前缀解析
 *   - `frq` 越小越高频（0 表示无数据，剔除或排最后）
 *   - `tag` 形如 "gk cet4 cet6 ky toefl gre"，按空格切分取 cet4/cet6
 *   - `translation` 里的 `\n` 是字面量（不是换行），需替换后再取第一条义项
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
fs.mkdirSync(CACHE, { recursive: true });
const URL = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv';
const LOCAL = path.join(CACHE, 'ecdict.csv');

function parseLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/* ---------- 1. 确保本地有 ecdict.csv ---------- */
if (!fs.existsSync(LOCAL) || fs.statSync(LOCAL).size < 1000000) {
  console.log('下载 ecdict.csv …');
  const t0 = Date.now();
  const r = await fetch(URL, { headers: { 'user-agent': 'dsh-corpus' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const total = Number(r.headers.get('content-length') || 0);
  const out = fs.createWriteStream(LOCAL);
  let got = 0, last = 0;
  for await (const chunk of r.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
    if (Date.now() - last > 5000) { last = Date.now(); console.log('  ' + (got / 1048576).toFixed(1) + '/' + (total / 1048576).toFixed(1) + ' MB'); }
  }
  await new Promise((res) => out.end(res));
  console.log('完成 ' + (fs.statSync(LOCAL).size / 1048576).toFixed(1) + ' MB，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
} else {
  console.log('复用已有 ecdict.csv  ' + (fs.statSync(LOCAL).size / 1048576).toFixed(1) + ' MB');
}

/* ---------- 2. 流式提取 ---------- */
/* ---- 词性判定（修正版）----
 * 旧做法：只看 translation 开头一个标记 → national 被判成 n.（因为第一条义项恰好是名词）。
 * 新做法：收集全篇出现过的**所有**词性标记；只有当"全篇只有一个词性"时才落定，否则留空。
 * 宁可留空（App 里干扰项会退化到跨词性生成），也不要给学习者一个错标的词性。
 */
const ALL_MARKERS = /(?:^|[\s,;，；])(vt|vi|vbl|v|npl|ns|n|adj|adv|ad|a|prep|conj|pron|num|int|aux|abbr)\./gi;
function markerSet(translation) {
  const t = String(translation || '');
  const out = [];
  let m;
  ALL_MARKERS.lastIndex = 0;
  while ((m = ALL_MARKERS.exec(t)) !== null) {
    const raw = m[1].toLowerCase();
    const pos = raw.startsWith('v') ? 'v.'
      : raw.startsWith('n') ? 'n.'
      : raw === 'adj' || raw === 'a' ? 'adj.'
      : raw === 'adv' || raw === 'ad' ? 'adv.'
      : raw === 'prep' ? 'prep.'
      : raw === 'conj' ? 'conj.'
      : raw === 'pron' ? 'pron.'
      : raw === 'num' ? 'num.'
      : '';
    if (pos && !out.includes(pos)) out.push(pos);
  }
  return out;
}
function primaryPos(translation) {
  const set = markerSet(translation);
  return set.length === 1 ? set[0] : '';
}
/**
 * 取释义：ECDICT 的 translation 形如 "vt. 放弃, 抛弃, 遗弃\\nn. 放任, 无拘束"。
 * 只取第一条义项会出问题——义项顺序不按常用度排（superior 的第一条是"长者"，不是"更好的"）。
 * 折中做法：保留前 2~3 条义项拼起来（≤14 字），既给出常用义，又不至于成为一本词典。
 * 同时去掉「使…」「见…」「[网络]」「[经]」这类不能作为干扰项首字的开头。
 */
function pickMeaning(translation) {
  let t = String(translation || '').replace(/\\n/g, '\n');
  const lines = t.split('\n').map((s) => s.trim()).filter(Boolean);
  const senses = [];
  for (const line of lines) {
    // 去掉词性标记与领域标记
    let s = line
      .replace(/^(vt|vi|v|n|adj|adv|prep|conj|pron|num|a|ad|ns|npl|int|aux|abbr)\.\s*/i, '')
      .replace(/\[[^\]]*\]/g, ' ')
      .trim();
    for (const piece of s.split(/[,;，；]/)) {
      const p = piece.trim();
      if (!p) continue;
      if (/^(见|同上|参考|见上)/.test(p)) continue;
      if (p.length > 14) continue;
      senses.push(p);
    }
    if (senses.length >= 3) break;
  }
  const uniq = [...new Set(senses)];
  let out = '';
  for (const s of uniq) {
    const next = out ? out + '；' + s : s;
    if (next.length > 14) break;
    out = next;
    if (out.split('；').length >= 2) break;
  }
  return out || (uniq[0] || '').slice(0, 14) || String(translation).slice(0, 14);
}
function firstDef(def) {
  const d = String(def || '').replace(/\\n/g, '\n').split('\n')[0].trim();
  return d.replace(/^[a-z]+\.\s*/i, '').slice(0, 160);
}

const cnt = { total: 0, kept: 0, cet4: 0, cet6: 0, noPos: 0, noFrq: 0 };
const rows = [];
let buf = '';
let header = null;
const COL = {};
const stream = fs.createReadStream(LOCAL, { encoding: 'utf8', highWaterMark: 1 << 20 });
const t0 = Date.now();

for await (const chunk of stream) {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).replace(/\r$/, '');
    buf = buf.slice(nl + 1);
    if (!line) continue;
    if (!header) { header = parseLine(line); header.forEach((h, i) => (COL[h] = i)); continue; }
    if (!line.includes('cet')) continue;
    cnt.total++;
    const row = parseLine(line);
    const tag = (row[COL.tag] || '').trim();
    const tags = tag.split(/\s+/).filter(Boolean);
    const is4 = tags.includes('cet4'), is6 = tags.includes('cet6');
    if (!is4 && !is6) continue;

    const word = (row[COL.word] || '').trim();
    if (!/^[a-z][a-z'-]*$/i.test(word)) continue;       // 纯英文单词
    const translation = (row[COL.translation] || '').trim();
    if (!translation) continue;
    const pos = primaryPos(translation);
    if (!pos) cnt.noPos++;
    const frq = Number(row[COL.frq] || 0);
    if (!(frq > 0)) cnt.noFrq++;

    rows.push({
      word: word.toLowerCase(),
      phonetic: (row[COL.phonetic] || '').trim(),
      pos,
      meaning_cn: pickMeaning(translation),
      meaning_en: firstDef(row[COL.definition]),
      frq: frq > 0 ? frq : 999999,
      collins: (row[COL.collins] || '').trim(),
      tags: [is4 ? 'cet4' : null, is6 ? 'cet6' : null].filter(Boolean)
    });
    if (is4) cnt.cet4++; else cnt.cet6++;
  }
}
console.log('扫描完成 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

/* ---------- 3. 去重 + 排序 + 编 id ---------- */
const byWord = new Map();
for (const r of rows) {
  const prev = byWord.get(r.word);
  if (!prev || r.frq < prev.frq) byWord.set(r.word, r);
}
const list = [...byWord.values()].sort((a, b) => a.frq - b.frq || a.word.localeCompare(b.word));
list.forEach((r, i) => { r.id = 'w' + String(i + 1).padStart(4, '0'); });

console.log('\n=== 提取结果 ===');
console.log('  CET 候选行  : ' + cnt.total);
console.log('  去重后词数  : ' + list.length + '（cet4 标注 ' + cnt.cet4 + ' / cet6 标注 ' + cnt.cet6 + '）');
console.log('  词性解析失败: ' + cnt.noPos);
console.log('  无 frq 数据 : ' + cnt.noFrq);
const posDist = {};
list.forEach((r) => { posDist[r.pos || '(空)'] = (posDist[r.pos || '(空)'] || 0) + 1; });
console.log('  词性分布    : ' + JSON.stringify(posDist));
console.log('  有音标      : ' + list.filter((r) => r.phonetic).length + ' / ' + list.length);
console.log('  有英文释义  : ' + list.filter((r) => r.meaning_en).length + ' / ' + list.length);
console.log('\n--- 最高频 15 词 ---');
list.slice(0, 15).forEach((r) => console.log('  ' + r.id + '  ' + r.word.padEnd(14) + (r.pos || '-').padEnd(6) + ' frq=' + String(r.frq).padStart(7) + '  ' + r.meaning_cn));

const out = path.join(CACHE, 'cet-words.json');
fs.writeFileSync(out, JSON.stringify(list, null, 1));
console.log('\n已写出: ' + out + '  ' + (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
