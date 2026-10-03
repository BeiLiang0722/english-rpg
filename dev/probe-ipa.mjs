/* dev/probe-ipa.mjs · 探测可用的权威 IPA 音标数据源（临时工具）
 * 用法：node dev/probe-ipa.mjs
 * 目标：找到"覆盖率高 + 标准 IPA + 允许自用"的英语音标表，用来替换 ECDICT 的老式 ASCII 转写。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const HEAD = { 'user-agent': 'dsh-ipa-probe' };

/** 取 ECDICT 里的词做个命中率参照 */
const deck = JSON.parse(fs.readFileSync(path.join(CACHE, 'deck-draft.json'), 'utf8'));
const sample = deck.slice(0, 2000).map((w) => w.word.toLowerCase());
console.log('参照词数: ' + sample.length + '（deck 前 2000 词）\n');

const CANDIDATES = [
  {
    name: 'ipa-dict (open-dict-data) en_US',
    url: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt',
    parse: (text) => {
      const map = new Map();
      for (const line of text.split('\n')) {
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const w = line.slice(0, tab).trim().toLowerCase();
        const ipa = line.slice(tab + 1).trim();
        if (w && ipa && !map.has(w)) map.set(w, ipa.split(',')[0].trim());
      }
      return map;
    }
  },
  {
    name: 'ipa-dict en_UK',
    url: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_UK.txt',
    parse: (text) => {
      const map = new Map();
      for (const line of text.split('\n')) {
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const w = line.slice(0, tab).trim().toLowerCase();
        const ipa = line.slice(tab + 1).trim();
        if (w && ipa && !map.has(w)) map.set(w, ipa.split(',')[0].trim());
      }
      return map;
    }
  },
  {
    name: 'cmudict (ARPAbet，需转换，先只看可达性)',
    url: 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict',
    parse: () => null
  },
  {
    name: 'kaikki English IPA (体量大，先探 HEAD)',
    url: 'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl',
    parse: () => null,
    headOnly: true
  }
];

for (const c of CANDIDATES) {
  process.stdout.write('--- ' + c.name + '\n');
  try {
    if (c.headOnly) {
      const r = await fetch(c.url, { method: 'HEAD', headers: HEAD });
      console.log('    HEAD ' + r.status + '  content-length=' +
        ((Number(r.headers.get('content-length') || 0) / 1048576).toFixed(1)) + ' MB');
      continue;
    }
    const r = await fetch(c.url, { headers: HEAD });
    if (!r.ok) { console.log('    HTTP ' + r.status + '（跳过）'); continue; }
    const text = await r.text();
    console.log('    下载 ' + (text.length / 1048576).toFixed(2) + ' MB');
    const map = c.parse(text);
    if (!map) { console.log('    （仅探可达性）'); continue; }
    console.log('    词条数 ' + map.size);
    let hit = 0;
    const miss = [];
    for (const w of sample) {
      if (map.has(w)) hit++; else if (miss.length < 8) miss.push(w);
    }
    console.log('    对参照词的命中率: ' + hit + ' / ' + sample.length + '  (' + ((hit / sample.length) * 100).toFixed(1) + '%)');
    console.log('    未命中样例: ' + miss.join(', '));
    console.log('    样例音标: ' + ['state', 'might', 'part', 'system', 'government', 'carefully']
      .map((w) => w + '=' + (map.get(w) || '—')).join('  '));
    // 落盘备查
    fs.writeFileSync(path.join(CACHE, 'ipa-' + c.name.replace(/[^a-z0-9]+/gi, '_') + '.json'),
      JSON.stringify(Object.fromEntries([...map.entries()].slice(0, 200000))));
  } catch (e) {
    console.log('    失败: ' + e.message);
  }
}
