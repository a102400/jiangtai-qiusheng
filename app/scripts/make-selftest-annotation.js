'use strict';

/**
 * 生成「规则引擎 vs 手册判据」对照标注（自检用，不是真人双标）
 * ------------------------------------------------------------------
 * 修好了什么（2026-10-30 第二次修）：
 *
 *   1. 原来按 id 匹配句子。抽样是「按编码分层」，判据一改，抽样集就重排，
 *      id 全部错位——脚本会把「用面积来解释」的裁决套到「没关系，说错也是收获」上，
 *      然后安静地输出一份看起来正常的报告。这是最危险的一类 bug：结果错但不报错。
 *      现在改成：先把手册裁决冻结成 handbook-labels.csv（含句子原文），
 *      之后一律按**文本**匹配。抽到表里没有的句子就明确报「未复核」，不猜。
 *
 *   2. 原来未列入覆盖表的句子直接沿用规则结果（manual = rule）。
 *      那等于用规则证明规则：被推翻的永远只有已知的几条，κ 天然偏高。
 *      现在 30 句全部逐条按手册裁决，一条不落地写进冻结表。
 *
 * 它仍然**不是**人机一致性，也**不是**研究数据：
 *   B 列是作者依据手册逐条裁决的结果，只有一个人判，没有独立双标。
 *   因此这里算出的 κ 只能叫「规则引擎 vs 手册判据」，不能叫「标注一致性」。
 *
 * 用法：
 *   node scripts/make-selftest-annotation.js --freeze   # 重建冻结表（改过手册判据时用）
 *   node scripts/make-selftest-annotation.js            # 按冻结表生成 A/B 两份 CSV
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SET = path.join(ROOT, 'annotation', 'set-30.csv');
const OUT_DIR = path.join(ROOT, 'annotation', 'selftest');
const LABELS = path.join(OUT_DIR, 'handbook-labels.csv');

/**
 * 作者按《iFIAS标注手册》对 30 句的逐条裁决。
 * 只在 --freeze 时用来生成 handbook-labels.csv；日常运行不读这张表，只读冻结文件。
 * 每条的「依据」都要能对应到手册第 3–4 节的判据或第 9 节的 D 编号。
 */
const BY_ID = {
  1: ['4.1', '问的是学生的推理过程，答案不唯一'],
  2: ['6', '齐读是课堂指令'],
  3: ['1', '接受并安抚学生情感'],
  4: ['2', '评价思路，不是确认某个答案'],
  5: ['5', '讲解结论，属讲授'],
  6: ['6', '引导注意，未操作设备（D2）'],
  7: ['2', '表扬鼓励'],
  8: ['6', '教师组织语言是指令，不是生生讨论（D6）'],
  9: ['6', '板书是行为要求，不是讲授（D13）'],
  10: ['5', '讲解推导步骤'],
  11: ['4.2', '指向既定答案'],
  12: ['4.1', '举例类答案不唯一（D9）'],
  13: ['4.2', '是非问句'],
  14: ['5', '教师自述演示步骤，未要求学生动手'],
  15: ['4.1', '解释类答案不唯一（D8）'],
  16: ['3', '采纳学生思路；规则判 5，属未修复的 D14'],
  17: ['5', '开场陈述'],
  18: ['6', '翻书看例题是课堂指令'],
  19: ['4.2', '事实性提问，答案唯一'],
  20: ['3', '确认并采纳具体答案（D1）'],
  21: ['7', '纪律压制，不是沉寂（D7）'],
  22: ['4.1', '需推理说明（D9）'],
  23: ['4.2', '是非问句'],
  24: ['6', '要求动手计算'],
  25: ['6', '引导注意，不是操纵技术（D2）'],
  26: ['4.2', '是非问句'],
  27: ['1', '接受情感，安抚'],
  28: ['4.1', '开放提问，问为什么成立'],
  29: ['3', '采纳学生观点'],
  30: ['12', '教学沉寂'],
};

function parseCsv(text) {
  const src = text.replace(/^\ufeff/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i += 1; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

const csvCell = (v) => {
  const s = String(v === undefined || v === null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function readSet() {
  const rows = parseCsv(fs.readFileSync(SET, 'utf8'));
  const head = rows[0].map((h) => h.trim());
  const ci = (name) => head.indexOf(name);
  ['id', 'text', 'rule_code'].forEach((n) => {
    if (ci(n) < 0) throw new Error('set-30.csv 缺少列：' + n);
  });
  return rows.slice(1).map((r) => ({
    id: Number(r[ci('id')]),
    text: r[ci('text')],
    rule: r[ci('rule_code')],
  }));
}

/** --freeze：把 BY_ID 的裁决连同句子原文写成冻结表 */
function freeze(items) {
  const missing = items.filter((it) => !BY_ID[it.id]);
  if (missing.length) {
    throw new Error('下列句子没有手册裁决，先补 BY_ID 再冻结：\n'
      + missing.map((m) => '  #' + m.id + ' ' + m.text).join('\n'));
  }
  const lines = ['id,text,code,why'];
  items.forEach((it) => {
    const [code, why] = BY_ID[it.id];
    lines.push([it.id, it.text, code, why].map(csvCell).join(','));
  });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(LABELS, '\ufeff' + lines.join('\r\n'), 'utf8');
  console.log('已冻结手册裁决：' + items.length + ' 条 → annotation/selftest/handbook-labels.csv');
}

function main() {
  const items = readSet();

  if (process.argv.includes('--freeze')) {
    freeze(items);
    return;
  }

  if (!fs.existsSync(LABELS)) {
    throw new Error('缺少 handbook-labels.csv，先执行：node scripts/make-selftest-annotation.js --freeze');
  }

  // 按**文本**建立索引（不是 id）——抽样集重排后 id 会错位
  const labelRows = parseCsv(fs.readFileSync(LABELS, 'utf8'));
  const lhead = labelRows[0].map((h) => h.trim());
  const li = (n) => lhead.indexOf(n);
  const byText = new Map();
  labelRows.slice(1).forEach((r) => {
    byText.set(r[li('text')], { code: r[li('code')], why: r[li('why')], id: r[li('id')] });
  });

  const aLines = ['id,text,code'];
  const bLines = ['id,text,code'];
  const diff = [];
  const unreviewed = [];

  items.forEach((it) => {
    const lab = byText.get(it.text);
    if (!lab) {
      // 不猜、不沿用规则结果。抽到没复核过的句子就明确记下来。
      unreviewed.push(it);
      return;
    }
    aLines.push([it.id, it.text, it.rule].map(csvCell).join(','));
    bLines.push([it.id, it.text, lab.code].map(csvCell).join(','));
    if (lab.code !== it.rule) diff.push({ id: it.id, text: it.text, rule: it.rule, manual: lab.code, why: lab.why });
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'selftest-A-rule.csv'), '\ufeff' + aLines.join('\r\n'), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'selftest-B-manual.csv'), '\ufeff' + bLines.join('\r\n'), 'utf8');

  const reviewed = items.length - unreviewed.length;
  const readme = [
    '# 自检数据说明（不是研究数据）',
    '',
    '本目录的 CSV 用于验证 κ 分析链路，**不可作为论文中的人工一致性证据**。',
    '',
    '| 文件 | 内容 | 性质 |',
    '| :-- | :-- | :-- |',
    '| `selftest-A-rule.csv` | 规则引擎 `ruleCodeOne()` 的编码结果 | 程序输出，可复算 |',
    '| `selftest-B-manual.csv` | 作者依据《iFIAS标注手册》逐条裁决的结果 | **单人裁决，非独立双标** |',
    '| `handbook-labels.csv` | 手册裁决的冻结表（含句子原文） | 按文本匹配，避免抽样重排后错位 |',
    '',
    '由 `scripts/make-selftest-annotation.js` 生成。由此算出的 κ 只能命名为',
    '**「规则引擎 vs 手册判据」一致度**，用于量化规则引擎与手册的差距，',
    '**不能**命名为「标注一致性」或「人机一致性」。',
    '',
    '## 本次覆盖情况',
    '',
    '| 项目 | 值 |',
    '| :-- | --: |',
    '| 抽样集句子数 | ' + items.length + ' |',
    '| 已按手册裁决 | ' + reviewed + ' |',
    '| 未复核（未纳入 κ） | ' + unreviewed.length + ' |',
    '',
    ...(unreviewed.length ? [
      '### 未复核句子（不纳入 κ，必须补裁决）',
      '',
      '> 这些句子是抽样集里有、冻结表里没有的。脚本**不会**用规则结果替它们填空，',
      '> 所以它们被排除在 κ 之外。抽样集变化后需补 `BY_ID` 并重新 `--freeze`。',
      '',
      ...unreviewed.map((u) => '- #' + u.id + ' ' + u.text),
      '',
    ] : []),
    '## 本次被手册推翻的判定',
    '',
    '| id | 句子 | 规则判 | 手册判 | 依据 |',
    '| --: | :-- | :-- | :-- | :-- |',
    ...diff.map((d) => `| ${d.id} | ${d.text} | ${d.rule} | ${d.manual} | ${d.why} |`),
    '',
    `共 ${diff.length} 条 / ${reviewed} 条已裁决。`,
    '',
    '> 若这一栏为 0，且覆盖率为 100%，说明规则已与该手册在这批句子上完全对齐。',
    '> 但这**不能**读成「规则已经正确」：B 列只有一个人判，且这 30 句就是修判据时看过的句子。',
    '> 真正的泛化证据要看 `scripts/rule-change-audit.js` 的回归数为 0，以及尚未做的人工双标。',
  ];

  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readme.join('\n'), 'utf8');

  console.log(`生成完成：已裁决 ${reviewed} 条，其中被手册推翻 ${diff.length} 条`);
  if (unreviewed.length) console.log(`⚠ 有 ${unreviewed.length} 条未复核，已排除在 κ 之外（见 README.md）`);
  console.log('产物目录：annotation/selftest/');
  diff.forEach((d) => console.log(`  #${d.id} ${d.rule} → ${d.manual}  ${d.text}`));
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { parseCsv, BY_ID, csvCell };
