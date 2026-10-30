'use strict';

/**
 * 双人标注一致性分析
 * ------------------------------------------------------------------
 * 把两份独立标注算成一份可直接放进附录的报告：总 κ、对标口径 κ、单类 κ、
 * 混淆矩阵、分歧清单、以及「下一步该改哪条判据」。
 *
 * 用法：
 *   node scripts/cohen-kappa.js --a annotation/annotator-A.csv --b annotation/annotator-B.csv
 *   node scripts/cohen-kappa.js --a A.csv --b B.csv --limit 20      # 首轮试水
 *   node scripts/cohen-kappa.js --a A.csv --b B.csv --out report.md
 *
 * 支持两种 CSV：
 *   1. 标注页导出的：id,text,code
 *   2. set-N.csv：id,source,text,rule_code,...（用 --col A / --col B 指定列）
 */

const fs = require('fs');
const path = require('path');
const { cohenKappa, binaryKappa, confusion, disagreements, interpret } = require('./kappa');
const { CODE_TABLE } = require('../lib/ifias');

/* ---------- CSV 解析（处理 BOM、引号内逗号与换行） ---------- */
function parseCsv(text) {
  const src = text.replace(/^\ufeff/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch === '\r') { /* 跳过，等 \n 收尾 */ }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] && r[0].trim()));
}

function loadAnnotations(file, preferCols) {
  if (!fs.existsSync(file)) throw new Error('找不到标注文件：' + file);
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) throw new Error('空文件：' + file);
  const head = rows[0].map((h) => h.trim());
  const idIdx = head.indexOf('id');
  if (idIdx < 0) throw new Error(file + ' 缺少 id 列，无法对齐');

  let colIdx = -1;
  for (const c of preferCols) {
    const i = head.indexOf(c);
    if (i >= 0) { colIdx = i; break; }
  }
  if (colIdx < 0) throw new Error(file + ' 里找不到标注列（试过 ' + preferCols.join('/') + '），实际列：' + head.join(', '));

  const out = new Map();
  for (let r = 1; r < rows.length; r += 1) {
    const id = String(rows[r][idIdx] || '').trim();
    if (!id) continue;
    const code = String(rows[r][colIdx] || '').trim();
    out.set(id, code);
  }
  return { map: out, column: head[colIdx], head };
}

/* ---------- 参数 ---------- */
function parseArgs(argv) {
  const out = { a: '', b: '', limit: 0, outFile: '', col: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--a') out.a = argv[++i];
    else if (k === '--b') out.b = argv[++i];
    else if (k === '--limit') out.limit = Number(argv[++i]);
    else if (k === '--out') out.outFile = argv[++i];
    else if (k === '--col') out.col.push(argv[++i]);
  }
  if (!out.a || !out.b) {
    console.error('用法：node scripts/cohen-kappa.js --a A.csv --b B.csv [--limit 20] [--out report.md] [--col A --col B]');
    process.exit(1);
  }
  return out;
}

/* ---------- 类别映射 ---------- */
const labelOf = (code) => {
  const hit = CODE_TABLE.find((c) => c.code === code);
  return hit ? hit.label : '（未知码）';
};
const groupOf = (code) => {
  const hit = CODE_TABLE.find((c) => c.code === code);
  return hit ? hit.group : 'unknown';
};

// 对标冯秀梅等(2025) 的 5 类口径：1+2+3 → 反馈，4.1+4.2 → 提问
const FIVE_CLASS = {
  '1': '反馈', '2': '反馈', '3': '反馈',
  '4.1': '提问', '4.2': '提问',
  '5': '讲授', '6': '指令', '7': '批评',
};

const pct = (v) => (v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%');
const k3 = (v) => (v === null || v === undefined ? '—' : v.toFixed(3));

/* ---------- 主流程 ---------- */
function main() {
  const args = parseArgs(process.argv.slice(2));
  const prefer = args.col.length ? args.col : ['code', 'A', 'B', 'final'];
  const A = loadAnnotations(args.a, prefer);
  const B = loadAnnotations(args.b, prefer);

  // 对齐
  const idsAll = [...A.map.keys()].filter((id) => B.map.has(id));
  idsAll.sort((x, y) => Number(x) - Number(y));
  const ids = args.limit > 0 ? idsAll.slice(0, args.limit) : idsAll;

  const onlyA = [...A.map.keys()].filter((id) => !B.map.has(id)).length;
  const onlyB = [...B.map.keys()].filter((id) => !A.map.has(id)).length;

  const skipped = [];
  const pairs = [];
  const pairIds = [];
  ids.forEach((id) => {
    const a = A.map.get(id);
    const b = B.map.get(id);
    const bad = (c) => !c || c === 'SKIP' || c === 'skip' || c === '';
    if (bad(a) || bad(b)) { skipped.push(id); return; }
    pairs.push([a, b]);
    pairIds.push(id);
  });

  const overall = cohenKappa(pairs);

  // 5 类对标口径：只保留能映射进 5 类的样本，并如实报告剔除了多少
  const fivePairs = [];
  let droppedForFive = 0;
  pairs.forEach(([a, b]) => {
    if (FIVE_CLASS[a] && FIVE_CLASS[b]) fivePairs.push([FIVE_CLASS[a], FIVE_CLASS[b]]);
    else droppedForFive += 1;
  });
  const five = cohenKappa(fivePairs);

  // 7 类 8 码口径：教师语言全部保留（不含学生/沉寂/技术）
  const teacherCodes = ['1', '2', '3', '4.1', '4.2', '5', '6', '7'];
  const sevenPairs = pairs.filter(([a, b]) => teacherCodes.includes(a) && teacherCodes.includes(b));
  const seven = cohenKappa(sevenPairs);

  const conf = confusion(pairs);
  const dis = disagreements(pairs, pairIds, groupOf);

  // 主要分歧格：非对角元素排序
  const cells = [];
  conf.codes.forEach((ca, i) => {
    conf.codes.forEach((cb, j) => {
      if (i === j) return;
      const n = conf.matrix[i][j];
      if (n > 0) cells.push({ a: ca, b: cb, n });
    });
  });
  cells.sort((x, y) => y.n - x.n);

  /* ---------- 组装报告 ---------- */
  const L = [];
  L.push('# iFIAS 双人标注一致性报告');
  L.push('');
  L.push('> 由 `scripts/cohen-kappa.js` 生成。κ 用于回答「两名标注员在多大程度上是独立且一致地编码的」，');
  L.push('> 扣除了「两人都爱标讲授」这种靠猜也能对的部分。');
  L.push('');
  L.push('## 一、样本与对齐');
  L.push('');
  L.push('| 项目 | 值 |');
  L.push('| :-- | :-- |');
  L.push('| A 文件 | ' + path.basename(args.a) + '（列 `' + A.column + '`） |');
  L.push('| B 文件 | ' + path.basename(args.b) + '（列 `' + B.column + '`） |');
  L.push('| 双方共有 id | ' + idsAll.length + ' |');
  L.push('| 本次纳入 | ' + ids.length + (args.limit > 0 ? '（--limit ' + args.limit + '）' : '') + ' |');
  L.push('| 有效配对 | **' + pairs.length + '** |');
  L.push('| 含未标注/跳过 | ' + skipped.length + (skipped.length ? '（id: ' + skipped.slice(0, 12).join(', ') + (skipped.length > 12 ? '…' : '') + '）' : '') + ' |');
  L.push('| 仅在 A 中 | ' + onlyA + ' |');
  L.push('| 仅在 B 中 | ' + onlyB + ' |');
  L.push('');

  if (!pairs.length) {
    L.push('**无法计算 κ**：没有一条同时被两人标注的记录。检查两份文件是否是同一批句子、id 是否对得上。');
    emit(L, args);
    return;
  }

  L.push('## 二、三个口径的 κ');
  L.push('');
  L.push('| 口径 | 类别数 | n | 一致率 Po | 期望一致率 Pe | **κ** | 解读 |');
  L.push('| :-- | --: | --: | --: | --: | --: | :-- |');
  L.push('| 全量（系统 16 码） | ' + new Set(pairs.flat()).size + ' | ' + overall.n + ' | ' + pct(overall.po) + ' | ' + pct(overall.pe) + ' | **' + k3(overall.kappa) + '** | ' + interpret(overall.kappa) + ' |');
  L.push('| 教师语言（8 码） | ' + new Set(sevenPairs.flat()).size + ' | ' + seven.n + ' | ' + pct(seven.po) + ' | ' + pct(seven.pe) + ' | **' + k3(seven.kappa) + '** | ' + interpret(seven.kappa) + ' |');
  L.push('| 对标 5 类（冯秀梅等 2025） | ' + new Set(fivePairs.flat()).size + ' | ' + five.n + ' | ' + pct(five.po) + ' | ' + pct(five.pe) + ' | **' + k3(five.kappa) + '** | ' + interpret(five.kappa) + ' |');
  L.push('');
  L.push('> **为什么必须三个都报**：只报 5 类会显得比实际好（合并降低了难度）；只报全量又无法与已有基准对话。');
  if (droppedForFive > 0) {
    L.push('> 5 类口径剔除了 ' + droppedForFive + ' 条（一方判为学生/沉寂/技术类，该体系里没有对应类别）。剔除数量必须如实报告，否则 κ 会被系统性抬高。');
  }
  L.push('');
  L.push('**参考基准**：冯秀梅等（2025）用 n-gram + 机器学习编码，报告准确率 0.9168、**κ = 0.871**。本项目的人工一致性若低于此，说明「机器编码不可靠」这个结论站不住——因为连人都标不一致。');
  L.push('');
  if (pairs.length < 50) {
    L.push('> ⚠️ **样本量警告：有效配对只有 ' + pairs.length + ' 条。**');
    L.push('> Cohen\'s κ 在小样本上方差极大（n=30 时 95% 置信区间常宽达 ±0.2）。');
    L.push('> 这个数字只能用作**试标校准**，不能用来宣称「编码体系可靠」。正式报告建议 n ≥ 200。');
    L.push('');
  }

  L.push('## 三、单类 κ（这一类本身是否可靠）');
  L.push('');
  L.push('| 码 | 类别 | A 判为该类 | B 判为该类 | 单类 κ | 结论 |');
  L.push('| :-- | :-- | --: | --: | --: | :-- |');
  const usedCodes = [...new Set(pairs.flat())].sort();
  usedCodes.forEach((code) => {
    const cntA = overall.distA.get(code) || 0;
    const cntB = overall.distB.get(code) || 0;
    const r = binaryKappa(pairs, code);
    // 样本量不足时 κ 的取值毫无意义：某一类只出现 1 次，两人一不一致都能算出 0 或 1。
    // 与其给一个会被人引用的假数字，不如直接标「不可解释」。
    let flag;
    if (Math.min(cntA, cntB) < 5) flag = '⚠ 样本 <5，κ 不可解释';
    else if (r.kappa !== null && r.kappa < 0.4) flag = '⚠ 判据需重写';
    else if (r.kappa !== null && r.kappa < 0.6) flag = '偏弱';
    else flag = '可用';
    L.push('| ' + code + ' | ' + labelOf(code) + ' | ' + cntA + ' | ' + cntB + ' | ' + k3(r.kappa) + ' | ' + flag + ' |');
  });
  L.push('');
  L.push('> 单类 κ 低于 0.40 时，问题通常不在标注员，而在**这一类的定义本身**。按手册第 8 节的顺序处理：先看它在混淆矩阵里跟谁混，再决定改判据还是合并。');
  L.push('');

  L.push('## 四、混淆矩阵（行 = A，列 = B）');
  L.push('');
  const shown = conf.codes;
  L.push('| A \\ B | ' + shown.join(' | ') + ' |');
  L.push('| :-- | ' + shown.map(() => '--:').join(' | ') + ' |');
  shown.forEach((ca, i) => {
    L.push('| **' + ca + '** ' + labelOf(ca) + ' | ' + conf.matrix[i].map((n, j) => (i === j ? (n ? '_' + n + '_' : '0') : (n ? '**' + n + '**' : '0'))).join(' | ') + ' |');
  });
  L.push('');
  L.push('> 对角线（斜体）是两人一致的部分；加粗的是分歧。**最大的那个加粗数字，就是 κ 上不去的主因。**');
  L.push('');

  L.push('## 五、主要分歧（按发生次数）');
  L.push('');
  if (!cells.length) {
    L.push('无分歧。');
  } else {
    L.push('| A 判为 | B 判为 | 次数 | 是否跨组 | 处理建议 |');
    L.push('| :-- | :-- | --: | :-- | :-- |');
    cells.slice(0, 8).forEach((c) => {
      const cross = groupOf(c.a) !== groupOf(c.b);
      L.push('| ' + c.a + ' ' + labelOf(c.a) + ' | ' + c.b + ' ' + labelOf(c.b) + ' | ' + c.n + ' | ' + (cross ? '**跨组**' : '组内') + ' | ' + (cross ? '最优先：会改变报告的教师/学生占比，先修这条' : '在手册第 4 节加一条判据') + ' |');
    });
  }
  L.push('');
  L.push('> 跨组分歧（如把讲授标成学生应答）会直接改变报告里的百分比结论，优先级高于组内分歧。');
  L.push('');

  L.push('## 六、分歧明细（前 20 条，供逐条讨论）');
  L.push('');
  if (!dis.length) {
    L.push('无分歧。');
  } else {
    L.push('| id | A | B | 严重度 |');
    L.push('| --: | :-- | :-- | :-- |');
    dis.slice(0, 20).forEach((d) => {
      L.push('| ' + d.id + ' | ' + d.a + ' ' + labelOf(d.a) + ' | ' + d.b + ' ' + labelOf(d.b) + ' | ' + d.severity + ' |');
    });
    if (dis.length > 20) L.push('');
    if (dis.length > 20) L.push('其余 ' + (dis.length - 20) + ' 条略。');
  }
  L.push('');

  L.push('## 七、结论');
  L.push('');
  const k5 = five.kappa;
  if (k5 === null) {
    L.push('- 5 类口径无法计算（样本里没有可映射的配对）。');
  } else if (k5 >= 0.7) {
    L.push('- 5 类 κ = ' + k3(k5) + '，**达到验收线（≥0.70）**，可作为机器编码评测的基准。');
  } else {
    L.push('- 5 类 κ = ' + k3(k5) + '，**未达验收线（≥0.70）**。');
    if (cells.length) {
      L.push('- 主要分歧是 `' + cells[0].a + ' → ' + cells[0].b + '`（' + cells[0].n + ' 次）。先只改这一条的判据，重标受影响的句子，不要全量返工。');
    }
  }
  if (seven.kappa !== null && five.kappa !== null && Math.abs(seven.kappa - five.kappa) < 0.05) {
    L.push('- 8 码 κ 与 5 类 κ 接近（差 ' + k3(Math.abs(seven.kappa - five.kappa)) + '），说明分歧主要发生在**大边界**（如讲授 vs 指令），而不是 4.1 vs 4.2 这类细分边界。');
  }
  if (skipped.length) {
    L.push('- 有 ' + skipped.length + ' 条未标注，κ 的分母是 ' + pairs.length + ' 条。未标注数必须写进论文，否则读者会以为是全样本。');
  }
  L.push('');
  L.push('> 本报告只描述一致性，不评价教学质量。κ 高只说明「两个人按同一本手册能标出同样的结果」，不代表编码体系有效。');

  emit(L, args);
}

function emit(lines, args) {
  const md = lines.join('\n');
  if (args.outFile) {
    fs.writeFileSync(path.resolve(args.outFile), md, 'utf8');
    console.log('报告已写入：' + args.outFile);
  }
  console.log('\n' + md);
}

main();
