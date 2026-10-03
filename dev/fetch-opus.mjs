/* dev/fetch-opus.mjs · 下载 OPUS 英中平行语料（临时工具，产物在缓存目录）
 * 用法：node dev/fetch-opus.mjs wikimatrix|qed|news
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
const SOURCES = {
  wikimatrix: 'https://object.pouta.csc.fi/OPUS-WikiMatrix/v1/moses/en-zh.txt.zip',
  qed: 'https://object.pouta.csc.fi/OPUS-QED/v2.0a/moses/en-zh.txt.zip',
  news: 'https://object.pouta.csc.fi/OPUS-News-Commentary/v16/moses/en-zh.txt.zip'
};

const key = (process.argv[2] || 'wikimatrix').toLowerCase();
const url = SOURCES[key];
if (!url) { console.error('未知源: ' + key + '（可选 ' + Object.keys(SOURCES).join(' / ') + '）'); process.exit(1); }

const dest = path.join(CACHE, 'opus-' + key + '.zip');
if (fs.existsSync(dest)) {
  console.log('已存在: ' + dest + '  ' + (fs.statSync(dest).size / 1048576).toFixed(1) + ' MB');
  process.exit(0);
}

console.log('下载 ' + key + ' …');
const t0 = Date.now();
const r = await fetch(url, { headers: { 'user-agent': 'dsh-opus' } });
if (!r.ok) throw new Error('HTTP ' + r.status);
const total = Number(r.headers.get('content-length') || 0);
const out = fs.createWriteStream(dest);
let got = 0, last = 0;
for await (const chunk of r.body) {
  got += chunk.length;
  if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
  if (Date.now() - last > 8000) {
    last = Date.now();
    console.log('  ' + (got / 1048576).toFixed(1) + ' / ' + (total / 1048576).toFixed(1) + ' MB');
  }
}
await new Promise((res) => out.end(res));
console.log('完成 ' + (fs.statSync(dest).size / 1048576).toFixed(1) + ' MB  用时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
console.log('下一步：用 7z 解压 ' + dest + ' 看内部结构');
