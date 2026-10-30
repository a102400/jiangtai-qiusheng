'use strict';

/**
 * 生成「规则引擎 vs 手册判据」对照标注（自检用，不是真人双标）
 * ------------------------------------------------------------------
 * 用途有两个，都要写清楚，不能混淆：
 *   1. 验证 build-annotation-set → cohen-kappa 这条链路能跑通；
 *   2. 量化规则引擎与本项目《iFIAS标注手册》的判据差多少。
 *
 * 它**不是**人机一致性，也**不是**研究数据：
 *   B 列是作者依据手册逐条裁决的结果，只有一个人判，没有独立双标。
 *   因此这里算出的 κ 只能叫「规则引擎 vs 手册判据」，不能叫「标注一致性」。
 *
 * 修正依据全部来自《iFIAS标注手册》第 3–4 节与第 9 节歧义登记表（D1/D2/D6/D7 等）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SET = path.join(ROOT, 'annotation', 'set-30.csv');
const OUT_DIR = path.join(ROOT, 'annotation', 'selftest');

/** 依据手册裁决的覆盖表：句子 → 手册码 + 理由（key 用 id 更稳，避免文本微调失配） */
const MANUAL = {
  3: ['4.1', '「用面积来解释」答案不唯一，属开放（手册 4.1 判据：换人回答答案会不同）'],
  8: ['4.1', '问「有什么关系」需推理说明，非唯一答案'],
  9: ['6', '「小组讨论一下」是教师组织语言 = 指令；10 指学生之间的讨论（手册 D6）'],
  10: ['7', '「安静，先听我说完」是纪律压制与权威维护（手册 D7）'],
  13: ['6', '「（板书课题）」是教师行为要求，属指令；不是知识讲授'],
  23: ['6', '「看大屏幕」是引导注意，未动手操作设备（手册 D2）'],
  24: ['4.1', '「举个例子」答案不唯一'],
  28: ['3', '「好，是 5」是对学生答案的确认与采纳，不是表扬（手册 D1）'],
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

const rows = parseCsv(fs.readFileSync(SET, 'utf8'));
const head = rows[0].map((h) => h.trim());
const ci = (name) => head.indexOf(name);
const idI = ci('id');
const textI = ci('text');
const ruleI = ci('rule_code');

fs.mkdirSync(OUT_DIR, { recursive: true });

const csvCell = (v) => {
  const s = String(v === undefined || v === null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const aLines = ['id,text,code'];
const bLines = ['id,text,code'];
const diff = [];

for (let i = 1; i < rows.length; i += 1) {
  const id = Number(rows[i][idI]);
  const text = rows[i][textI];
  const rule = rows[i][ruleI];
  const manual = MANUAL[id] ? MANUAL[id][0] : rule; // 未列入覆盖表的，视为与规则一致
  aLines.push([id, text, rule].map(csvCell).join(','));
  bLines.push([id, text, manual].map(csvCell).join(','));
  if (manual !== rule) diff.push({ id, text, rule, manual, why: MANUAL[id][1] });
}

fs.writeFileSync(path.join(OUT_DIR, 'selftest-A-rule.csv'), '\ufeff' + aLines.join('\r\n'), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'selftest-B-manual.csv'), '\ufeff' + bLines.join('\r\n'), 'utf8');

const readme = [
  '# 自检数据说明（不是研究数据）',
  '',
  '本目录的两份 CSV 用于验证 κ 分析链路，**不可作为论文中的人工一致性证据**。',
  '',
  '| 文件 | 内容 | 性质 |',
  '| :-- | :-- | :-- |',
  '| `selftest-A-rule.csv` | 规则引擎 `ruleCodeOne()` 的编码结果 | 程序输出，可复算 |',
  '| `selftest-B-manual.csv` | 作者依据《iFIAS标注手册》逐条裁决的结果 | **单人裁决，非独立双标** |',
  '',
  '由 `scripts/make-selftest-annotation.js` 生成。由此算出的 κ 只能命名为',
  '**「规则引擎 vs 手册判据」一致度**，用于量化规则引擎的已知缺陷，',
  '**不能**命名为「标注一致性」或「人机一致性」。',
  '',
  '真正的标注一致性必须由两名标注员互不交流、独立标完同一批句子后算出。',
  '',
  '## 本次被手册推翻的判定',
  '',
  '| id | 句子 | 规则判 | 手册判 | 依据 |',
  '| --: | :-- | :-- | :-- | :-- |',
  ...diff.map((d) => `| ${d.id} | ${d.text} | ${d.rule} | ${d.manual} | ${d.why} |`),
  '',
  `共 ${diff.length} 条 / ${rows.length - 1} 条。`,
];

fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readme.join('\n'), 'utf8');

console.log(`生成完成：${rows.length - 1} 条，其中被手册推翻 ${diff.length} 条`);
console.log('产物目录：annotation/selftest/');
diff.forEach((d) => console.log(`  #${d.id} ${d.rule} → ${d.manual}  ${d.text}`));
