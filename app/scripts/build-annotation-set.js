'use strict';

/**
 * 标注集构建器
 * ------------------------------------------------------------------
 * 从转写稿里切句、用规则编码器分层、抽出可复现的标注样本。
 *
 * 为什么分层而不是纯随机：
 *   随机抽 200 句，结果会 70% 是「讲授」——因为课堂本来就是这样。
 *   那样算出的 κ 主要反映"能不能认出讲授"，而 4.1/4.2、2/3 这些真正容易分歧的
 *   细类样本太少，κ 的置信区间宽到没有意义。所以按规则编码分层，保证每类都有量。
 *
 * 为什么标注页不显示规则编码：
 *   一旦标注员看到"系统判的是 4.2"，他的判断会被锚定，算出来的 κ 是"人和系统的
 *   一致程度"，而不是"两个独立判断的一致程度"。前者偏高且无法解释。
 *   所以 CSV 里有 rule_code（供事后分析），标注页里没有。
 *
 * 用法：
 *   node scripts/build-annotation-set.js --input annotation/corpus --n 200
 *   node scripts/build-annotation-set.js --input a.txt --n 60 --seed 7
 *   node scripts/build-annotation-set.js --demo          # 用内置示例语料跑通链路
 *
 * 产物（默认 annotation/）：
 *   set-<n>.csv        标注表（含 A/B 空列）
 *   label.html         离线双人标注页
 *   sample-report.md   抽样报告（来源、类别分布、可复现参数）
 */

const fs = require('fs');
const path = require('path');
const ifias = require('../lib/ifias');

const ROOT = path.resolve(__dirname, '..');

/* ---------- 参数 ---------- */
function parseArgs(argv) {
  const out = { input: '', n: 200, seed: 20261030, outDir: path.join(ROOT, 'annotation'), demo: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--input' || a === '-i') out.input = argv[++i];
    else if (a === '--n') out.n = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--out') out.outDir = path.resolve(argv[++i]);
    else if (a === '--demo') out.demo = true;
  }
  if (!out.input && !out.demo) {
    console.error('用法：node scripts/build-annotation-set.js --input <文件或目录> [--n 200] [--seed 20261030]');
    console.error('   或：node scripts/build-annotation-set.js --demo');
    process.exit(1);
  }
  return out;
}

/* ---------- 确定性 PRNG（mulberry32）：同一 seed 抽同一批句子 ---------- */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 读语料 ---------- */
function listCorpusFiles(input) {
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) throw new Error('找不到输入路径：' + abs);
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [abs];
  const exts = new Set(['.txt', '.md', '.srt', '.vtt', '.json']);
  return fs.readdirSync(abs)
    .map((f) => path.join(abs, f))
    .filter((f) => fs.statSync(f).isFile() && exts.has(path.extname(f).toLowerCase()));
}

/** 从语料文本里取正文。.md 去掉标题行与引用块（它们不是课堂话语） */
function extractText(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  let text = raw;
  if (ext === '.json') {
    try {
      const j = JSON.parse(raw);
      text = typeof j === 'string' ? j : JSON.stringify(j, null, 0);
      // 从 JSON 里捞所有可能的话语字段
      const bucket = [];
      (function walk(v) {
        if (typeof v === 'string' && v.length > 4) bucket.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      })(j);
      text = bucket.join('\n');
    } catch (e) { /* 非 JSON，按纯文本处理 */ }
  } else if (ext === '.md') {
    text = raw.split('\n')
      .filter((l) => !/^\s*#/.test(l) && !/^\s*>/.test(l) && !/^\s*\|/.test(l) && !/^\s*```/.test(l))
      .join('\n');
  } else if (ext === '.srt' || ext === '.vtt') {
    text = raw.split('\n')
      .filter((l) => !/^\s*\d+$/.test(l) && !/-->/.test(l) && !/^WEBVTT/.test(l))
      .join('\n');
  }
  return text;
}

/* ---------- 内置示例语料（仅用于跑通链路，不是研究数据） ---------- */
const DEMO_CORPUS = [
  '同学们好，今天我们学习勾股定理。',
  '先看大屏幕，这个直角三角形的两条直角边分别是 a 和 b，斜边是 c。',
  '那这三条边之间有什么关系呢？',
  '大家先自己算一算，直角边是 3 和 4 的时候，斜边是多少。',
  '算完了吗？谁来说说你的答案？',
  '好，是 5，请坐。',
  '你为什么觉得是 5 呢？能不能用面积来解释一下？',
  '很好，这个思路很清晰。',
  '正如刚才这位同学说的，我们可以用四个直角三角形拼成一个大正方形。',
  '第一步，把四个三角形摆成边长为 a 加 b 的正方形。',
  '第二步，中间空出来的部分，边长正好是 c。',
  '所以 a 的平方加 b 的平方就等于 c 的平方。',
  '别急，这道题容易卡住，慢慢来。',
  '请大家翻开课本第 32 页，看例题 2。',
  '拿出练习本，把这道题的步骤写完整。',
  '（板书课题）',
  '（停顿 1 秒）',
  '嗯，很好，你比上次进步了。',
  '安静，先听我说完。',
  '小组讨论一下，还有没有别的拼法。',
  '大家一起来读一遍这个结论。',
  '看黑板，注意这里的等号方向。',
  '听懂了吗？',
  '对不对？',
  '谁能举个生活里的例子？',
  '这个结论在古代叫什么？',
  '谁能告诉我，勾三股四弦五是什么意思？',
  '没关系，说错也是收获。',
  '按他的思路我们往下推。',
  '我们来看这个推导过程为什么成立。',
];

/* ---------- 切句 + 编码 ---------- */
function buildUnits(files) {
  const units = [];
  files.forEach((file) => {
    const text = extractText(file);
    const parts = ifias.splitUnits(text);
    parts.forEach((t) => {
      const clean = String(t).trim();
      if (clean.length < 2) return;
      const coded = ifias.ruleCodeOne(clean);
      units.push({ text: clean, code: coded.code, reason: coded.reason, source: path.basename(file) });
    });
  });
  return units;
}

/* ---------- 分层抽样 ---------- */
function stratifiedSample(units, n, seed) {
  const rng = makeRng(seed);
  const byCode = new Map();
  units.forEach((u) => {
    if (!byCode.has(u.code)) byCode.set(u.code, []);
    byCode.get(u.code).push(u);
  });

  // 类内先打乱（确定性）
  const groups = [...byCode.entries()].map(([code, arr]) => {
    const shuffled = arr.slice();
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return { code, arr: shuffled };
  });

  const total = units.length;
  const target = Math.min(n, total);
  if (target < n) {
    console.warn(`⚠ 语料只有 ${total} 个单元，不足 ${n} 句，将全量纳入。建议补充语料后再标。`);
  }

  // 按比例分配 + 最大余数补足
  const alloc = new Map();
  let assigned = 0;
  groups.forEach((g) => {
    const exact = (target * g.arr.length) / total;
    const base = Math.min(Math.floor(exact), g.arr.length);
    alloc.set(g.code, { base, frac: exact - Math.floor(exact), cap: g.arr.length });
    assigned += base;
  });
  let rest = target - assigned;
  const order = groups.slice().sort((x, y) => (alloc.get(y.code).frac - alloc.get(x.code).frac));
  while (rest > 0) {
    let progressed = false;
    for (const g of order) {
      const slot = alloc.get(g.code);
      if (rest <= 0) break;
      if (slot.base < slot.cap) { slot.base += 1; rest -= 1; progressed = true; }
    }
    if (!progressed) break; // 所有类都取满了
  }

  const picked = [];
  groups.forEach((g) => {
    picked.push(...g.arr.slice(0, alloc.get(g.code).base));
  });
  // 最终顺序再打乱一次，避免同类聚在一起（标注员会因此形成惯性）
  for (let i = picked.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked;
}

/* ---------- 输出 ---------- */
const csvCell = (v) => {
  const s = String(v === undefined || v === null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function writeCsv(file, rows) {
  const header = ['id', 'source', 'text', 'rule_code', 'rule_label', 'A', 'B', 'final', 'note'];
  const labelOf = (code) => {
    const hit = ifias.CODE_TABLE.find((c) => c.code === code);
    return hit ? hit.label : '';
  };
  const lines = [header.join(',')];
  rows.forEach((r, i) => {
    lines.push([i + 1, r.source, r.text, r.code, labelOf(r.code), '', '', '', ''].map(csvCell).join(','));
  });
  // BOM：不带的话 Excel 打开中文是乱码，标注员会以为文件坏了
  fs.writeFileSync(file, '\ufeff' + lines.join('\r\n'), 'utf8');
}

function buildLabelHtml(rows) {
  const codes = [
    { code: '1', label: '接受情感', key: '1' },
    { code: '2', label: '表扬鼓励', key: '2' },
    { code: '3', label: '采纳观点', key: '3' },
    { code: '4.1', label: '开放提问', key: '4' },
    { code: '4.2', label: '封闭提问', key: '5' },
    { code: '5', label: '讲授', key: '6' },
    { code: '6', label: '指令', key: '7' },
    { code: '7', label: '批评权威', key: '8' },
    { code: '8', label: '学生被动应答', key: 'q' },
    { code: '9.1', label: '学生主动应答', key: 'w' },
    { code: '9.2', label: '学生主动提问', key: 'e' },
    { code: '10', label: '同伴讨论', key: 'r' },
    { code: '11', label: '混乱', key: 'a' },
    { code: '12', label: '有益沉寂', key: 's' },
    { code: '13', label: '教师操作技术', key: 'd' },
    { code: '14', label: '学生操作技术', key: 'f' }
  ];
  // 句子数据里刻意不包含 rule_code：看到系统判断会被锚定，κ 就失去意义
  const items = rows.map((r, i) => ({ id: i + 1, text: r.text, source: r.source }));
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>iFIAS 标注页</title>
<style>
  :root { --bg:#0f1115; --panel:#181b22; --line:#2a2f3a; --fg:#e8ebf0; --dim:#8b93a3;
          --accent:#5b9dff; --ok:#3ecf8e; --warn:#ffb454; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; }
  header { display:flex; align-items:center; gap:16px; padding:14px 22px; border-bottom:1px solid var(--line); }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  .bar { flex:1; height:6px; background:var(--line); border-radius:3px; overflow:hidden; }
  .bar > i { display:block; height:100%; width:0; background:var(--accent); transition:width .15s; }
  .count { color:var(--dim); font-variant-numeric:tabular-nums; font-size:14px; }
  main { max-width:860px; margin:0 auto; padding:34px 22px 60px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:34px 30px; }
  .meta { color:var(--dim); font-size:13px; margin-bottom:16px; }
  .sentence { font-size:27px; line-height:1.55; font-weight:600; min-height:96px; letter-spacing:.3px; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:26px; }
  button.c { background:#20242e; color:var(--fg); border:1px solid var(--line); border-radius:10px;
             padding:14px 8px; font-size:15px; cursor:pointer; text-align:center; transition:.12s; }
  button.c:hover { border-color:var(--accent); background:#252b38; }
  button.c kbd { display:block; font-size:11px; color:var(--dim); margin-top:4px; font-family:inherit; }
  .row { display:flex; gap:10px; margin-top:20px; }
  .row button { flex:1; padding:12px; border-radius:10px; border:1px solid var(--line);
                background:#20242e; color:var(--fg); cursor:pointer; font-size:14px; }
  .row button.primary { background:var(--accent); border-color:var(--accent); color:#0b1220; font-weight:600; }
  .done { padding:60px 20px; text-align:center; }
  .done h2 { font-size:24px; }
  .hint { color:var(--dim); font-size:13px; margin-top:22px; line-height:1.9; }
  .badge { display:inline-block; padding:2px 8px; border-radius:6px; background:#20242e;
           color:var(--dim); font-size:12px; margin-left:8px; }
</style>
</head>
<body>
<header>
  <h1>iFIAS 标注 <span class="badge" id="who">未选择</span></h1>
  <div class="bar"><i id="prog"></i></div>
  <div class="count" id="count">0 / 0</div>
</header>
<main>
  <div class="card" id="card">
    <div class="meta" id="meta"></div>
    <div class="sentence" id="sen">加载中…</div>
    <div class="grid" id="grid"></div>
    <div class="row">
      <button id="prev">← 上一条 (Backspace)</button>
      <button class="primary" id="skip">跳过 (Enter)</button>
    </div>
    <div class="hint">
      标注前请先读《iFIAS标注手册》。本页<b>不显示系统判断</b>，避免锚定。<br>
      进度自动存在本机浏览器，刷新不丢；标完点「导出 CSV」交给组织者。
    </div>
  </div>
  <div class="done" id="done" style="display:none">
    <h2>已标完 ${items.length} 句</h2>
    <p class="hint">请导出 CSV，文件名为 <code>annotator-&lt;你的代号&gt;.csv</code></p>
    <div class="row" style="max-width:420px;margin:24px auto 0">
      <button class="primary" id="export2">导出 CSV</button>
    </div>
  </div>
</main>
<script>
const ITEMS = ${JSON.stringify(items)};
const CODES = ${JSON.stringify(codes)};
const KEYMAP = Object.fromEntries(CODES.map(c => [c.key, c.code]));

const who = prompt('你的标注员代号（A / B）：', 'A') || 'A';
document.getElementById('who').textContent = who;
const STORE = 'ifias-annot-' + who + '-${rows.length}';
let marks = {};
try { marks = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { marks = {}; }
let cur = 0;
while (cur < ITEMS.length && marks[ITEMS[cur].id]) cur++;

const grid = document.getElementById('grid');
CODES.forEach(c => {
  const b = document.createElement('button');
  b.className = 'c';
  b.innerHTML = c.code + ' ' + c.label + '<kbd>键 ' + c.key + '</kbd>';
  b.onclick = () => mark(c.code);
  grid.appendChild(b);
});

function save() { localStorage.setItem(STORE, JSON.stringify(marks)); }
function render() {
  const done = Object.keys(marks).length;
  document.getElementById('count').textContent = done + ' / ' + ITEMS.length;
  document.getElementById('prog').style.width = (done / ITEMS.length * 100) + '%';
  if (cur >= ITEMS.length) {
    document.getElementById('card').style.display = 'none';
    document.getElementById('done').style.display = 'block';
    return;
  }
  document.getElementById('card').style.display = 'block';
  document.getElementById('done').style.display = 'none';
  const it = ITEMS[cur];
  document.getElementById('meta').textContent = '第 ' + it.id + ' 句 · 来源 ' + it.source;
  document.getElementById('sen').textContent = it.text;
}
function mark(code) {
  if (cur >= ITEMS.length) return;
  marks[ITEMS[cur].id] = code;
  save();
  cur++;
  render();
}
function back() { if (cur > 0) { cur--; render(); } }
function skip() {
  if (cur >= ITEMS.length) return;
  marks[ITEMS[cur].id] = 'SKIP';
  save(); cur++; render();
}
document.getElementById('prev').onclick = back;
document.getElementById('skip').onclick = skip;
document.onkeydown = (e) => {
  if (e.key === 'Backspace') { e.preventDefault(); back(); return; }
  if (e.key === 'Enter') { e.preventDefault(); skip(); return; }
  const code = KEYMAP[e.key.toLowerCase()];
  if (code) { e.preventDefault(); mark(code); }
};
function exportCsv() {
  const head = ['id', 'text', 'code'];
  const lines = [head.join(',')];
  ITEMS.forEach(it => {
    const c = marks[it.id] || '';
    const t = '"' + String(it.text).replace(/"/g, '""') + '"';
    lines.push([it.id, t, c].join(','));
  });
  const blob = new Blob(['\\ufeff' + lines.join('\\r\\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'annotator-' + who + '.csv';
  a.click();
}
document.getElementById('export2').onclick = exportCsv;
render();
</script>
</body>
</html>`;
}

function buildReport(rows, args, totalUnits, fileCount) {
  const cnt = new Map();
  rows.forEach((r) => cnt.set(r.code, (cnt.get(r.code) || 0) + 1));
  const labelOf = (code) => {
    const hit = ifias.CODE_TABLE.find((c) => c.code === code);
    return hit ? hit.label : '';
  };
  const lines = [];
  lines.push('# 标注集抽样报告');
  lines.push('');
  lines.push('> 本文件由 `scripts/build-annotation-set.js` 生成，记录抽样参数，保证任何人可复现同一份样本。');
  lines.push('');
  lines.push('| 项目 | 值 |');
  lines.push('| :-- | :-- |');
  lines.push('| 语料文件数 | ' + fileCount + ' |');
  lines.push('| 切出的可用单元 | ' + totalUnits + ' |');
  lines.push('| 抽样句数 | ' + rows.length + ' |');
  lines.push('| 随机种子 | ' + args.seed + ' |');
  lines.push('| 抽样方法 | 按规则编码分层 + 类内确定性打乱 + 最大余数补齐 |');
  lines.push('');
  lines.push('## 类别分布');
  lines.push('');
  lines.push('| 码 | 类别 | 句数 | 占比 |');
  lines.push('| :-- | :-- | --: | --: |');
  [...cnt.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).forEach(([code, n]) => {
    lines.push('| ' + code + ' | ' + labelOf(code) + ' | ' + n + ' | ' + Math.round((n / rows.length) * 1000) / 10 + '% |');
  });
  lines.push('');
  lines.push('## 使用提示');
  lines.push('');
  lines.push('1. 两份 CSV 分给两名标注员，**标注前先读《iFIAS标注手册》，标注期间不许讨论具体句子**；');
  lines.push('2. 打开 `label.html` 标注，标完导出 `annotator-A.csv` / `annotator-B.csv`；');
  lines.push('3. 合并：`node scripts/cohen-kappa.js --a annotation/annotator-A.csv --b annotation/annotator-B.csv`；');
  lines.push('4. 首轮先标 20 句试水，κ < 0.60 就停下修手册，不要硬标完。');
  lines.push('');
  lines.push('> 类别分布若某一类为 0，说明语料里没有这种话语。**不要为了凑数人为补句子**——那会让 κ 虚高。');
  return lines.join('\n');
}

/* ---------- 主流程 ---------- */
function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.outDir, { recursive: true });

  let units;
  let fileCount;
  if (args.demo) {
    const text = DEMO_CORPUS.join('\n');
    units = ifias.splitUnits(text).map((t) => {
      const clean = String(t).trim();
      const coded = ifias.ruleCodeOne(clean);
      return { text: clean, code: coded.code, reason: coded.reason, source: 'demo-corpus' };
    }).filter((u) => u.text.length >= 2);
    fileCount = 0;
    console.log('使用内置示例语料（仅用于跑通链路，不是研究数据）');
  } else {
    const files = listCorpusFiles(args.input);
    if (!files.length) throw new Error('目录里没有可读的语料文件（支持 .txt/.md/.srt/.vtt/.json）');
    fileCount = files.length;
    units = buildUnits(files);
    console.log(`读取 ${files.length} 个文件，切出 ${units.length} 个单元`);
  }

  const rows = stratifiedSample(units, args.n, args.seed);
  const base = path.join(args.outDir, 'set-' + rows.length);
  writeCsv(base + '.csv', rows);
  fs.writeFileSync(base + '-label.html', buildLabelHtml(rows), 'utf8');
  fs.writeFileSync(base + '-report.md', buildReport(rows, args, units.length, fileCount), 'utf8');

  const cnt = new Map();
  rows.forEach((r) => cnt.set(r.code, (cnt.get(r.code) || 0) + 1));
  console.log(`\n抽样完成：${rows.length} 句（语料共 ${units.length} 单元）`);
  console.log('类别分布：' + [...cnt.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([c, n]) => c + '×' + n).join('  '));
  console.log('\n产物：');
  console.log('  ' + path.relative(ROOT, base + '.csv'));
  console.log('  ' + path.relative(ROOT, base + '-label.html'));
  console.log('  ' + path.relative(ROOT, base + '-report.md'));
}

// 只在直接运行时执行（被测试 require 时不应跑 main）
if (require.main === module) main();

module.exports = {
  makeRng, stratifiedSample, buildLabelHtml, csvCell, extractText, buildUnits, DEMO_CORPUS,
};
