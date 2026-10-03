/* dev/probe-opus.mjs · 探 OPUS 等平行语料库能否提供英中例句对（临时工具）
 * 用法：node dev/probe-opus.mjs
 */
const HEAD = { 'user-agent': 'dsh-opus-probe' };

async function head(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: HEAD, redirect: 'follow' });
    const len = Number(r.headers.get('content-length') || 0);
    return { ok: r.ok, status: r.status, mb: len ? (len / 1048576).toFixed(1) + ' MB' : '?', type: r.headers.get('content-type') || '' };
  } catch (e) { return { ok: false, status: 0, err: e.message }; }
}

const CANDIDATES = [
  // OPUS 的 Moses 格式英中（en-zh）语料
  'https://object.pouta.csc.fi/OPUS-Tatoeba/v2023-04-12/moses/en-zh.txt.zip',
  'https://object.pouta.csc.fi/OPUS-OpenSubtitles/v2018/moses/en-zh.txt.zip',
  'https://object.pouta.csc.fi/OPUS-WikiMatrix/v1/moses/en-zh.txt.zip',
  'https://object.pouta.csc.fi/OPUS-QED/v2.0a/moses/en-zh.txt.zip',
  'https://object.pouta.csc.fi/OPUS-GlobalVoices/v2018q4/moses/en-zh.txt.zip',
  'https://object.pouta.csc.fi/OPUS-News-Commentary/v16/moses/en-zh.txt.zip',
  // 官方 Tatoeba 也可能有更大的导出
  'https://downloads.tatoeba.org/exports/sentences_detailed.tar.bz2',
  'https://downloads.tatoeba.org/exports/per_language/yue/yue_sentences.tsv.bz2'
];

console.log('=== 候选英中平行语料（HEAD 探测）===');
for (const u of CANDIDATES) {
  const r = await head(u);
  const mark = r.ok ? 'OK  ' : 'FAIL';
  console.log('  ' + mark + ' ' + String(r.status).padStart(4) + '  ' + String(r.mb).padStart(9) + '  ' +
    (r.type || r.err || '').slice(0, 30));
  console.log('        ' + u);
}

console.log('\n=== OPUS 索引页（看有哪些 en-zh 数据集）===');
try {
  const r = await fetch('https://opus.nlpl.eu/opusapi/?source=en&target=zh&preprocessing=moses', { headers: HEAD });
  const j = await r.json();
  const corpora = (j.corpora || []).slice(0, 20);
  console.log('  HTTP ' + r.status + '，找到 ' + (j.corpora || []).length + ' 个语料');
  corpora.forEach((c) => console.log('    ' + c.corpus + '  v' + c.version + '  ' + (c.size || '?') + ' 句对  ' + (c.license || '')));
} catch (e) {
  console.log('  失败: ' + e.message);
}
