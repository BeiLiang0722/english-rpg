/* dev/fetch-corpus.mjs · 下载构建词库所需的语料（临时工具，产物落在系统临时目录，不入库）
 * 用法：
 *   node dev/fetch-corpus.mjs eng        # Tatoeba 英语句子
 *   node dev/fetch-corpus.mjs cmn        # Tatoeba 中文句子
 *   node dev/fetch-corpus.mjs links      # Tatoeba 句对映射（143MB，最大）
 *   node dev/fetch-corpus.mjs all
 * 说明：走 Node 自带 OpenSSL，绕开本机损坏的 Schannel/WinHTTP。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE = path.join(os.tmpdir(), 'wq-corpus');
fs.mkdirSync(CACHE, { recursive: true });

const TARGETS = {
  eng: 'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2',
  cmn: 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2',
  links: 'https://downloads.tatoeba.org/exports/links.tar.bz2',
  // 权威 IPA 音标（标准 IPA、带重音标记；对 CET 词覆盖 100%）。
  // 为什么要它：ECDICT 的 phonetic 列是老式 ASCII 转写（steit / 'sistәm），缺重音与长音符，不适合学习。
  ipa: 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt'
};

async function download(key) {
  const url = TARGETS[key];
  const dest = path.join(CACHE, key + '-' + path.basename(url));

  // 完整体积从远端 HEAD 取；本地若小于它，就是上次中断留下的半成品，必须重下。
  // （踩过的坑：只判断"文件存在且非空"会把截断文件当成已完成，之后所有分析都建立在残缺数据上。）
  let expected = 0;
  try {
    const h = await fetch(url, { method: 'HEAD', headers: { 'user-agent': 'dsh-corpus' } });
    expected = Number(h.headers.get('content-length') || 0);
  } catch { /* 取不到就退化为"存在即跳过" */ }

  if (fs.existsSync(dest)) {
    const size = fs.statSync(dest).size;
    if (expected && size < expected) {
      console.log('发现半成品（' + (size / 1048576).toFixed(1) + ' / ' + (expected / 1048576).toFixed(1) + ' MB），删除后重下: ' + path.basename(dest));
      fs.unlinkSync(dest);
    } else {
      console.log('已完整，跳过: ' + path.basename(dest) + '  (' + (size / 1048576).toFixed(1) + ' MB)');
      return dest;
    }
  }

  const t0 = Date.now();
  const r = await fetch(url, { headers: { 'user-agent': 'dsh-corpus' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  const total = Number(r.headers.get('content-length') || expected || 0);
  console.log('开始下载 ' + key + '  ' + (total / 1048576).toFixed(1) + ' MB');
  const out = fs.createWriteStream(dest);
  let got = 0, lastLog = 0;
  for await (const chunk of r.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
    const pct = total ? (got / total) * 100 : 0;
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      console.log('  ' + (got / 1048576).toFixed(1) + ' / ' + (total / 1048576).toFixed(1) + ' MB  (' + pct.toFixed(1) + '%)');
    }
  }
  await new Promise((res) => out.end(res));
  const finalSize = fs.statSync(dest).size;
  if (total && finalSize < total) throw new Error('下载不完整：' + finalSize + ' < ' + total);
  console.log('完成 ' + key + '  ' + (finalSize / 1048576).toFixed(1) + ' MB  用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  return dest;
}

const which = (process.argv[2] || 'all').toLowerCase();
const keys = which === 'all' ? Object.keys(TARGETS) : [which];
for (const k of keys) {
  if (!TARGETS[k]) { console.error('未知目标: ' + k + '（可选 eng / cmn / links / all）'); process.exit(1); }
}
for (const k of keys) await download(k);
console.log('\n缓存目录: ' + CACHE);
for (const f of fs.readdirSync(CACHE)) console.log('  ' + f + '  ' + (fs.statSync(path.join(CACHE, f)).size / 1048576).toFixed(1) + ' MB');
