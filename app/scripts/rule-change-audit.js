'use strict';

/**
 * 规则编码器改动影响面审计
 * ----------------------------------------------------------------------------
 * 回答一个问题：修 D1–D13 之后，到底哪些句子的编码变了？
 *
 * 为什么需要这个脚本：改判据最容易犯的错是「修好了 8 句，顺手弄坏 20 句」。
 * 单测只覆盖我想到的句子，覆盖不到语料里的真实句式。所以这里做全量对比：
 * 把**修复前**的判据原样内嵌（OLD_RULE 就是 2026-10-30 之前 lib/ifias.js 的函数，
 * 一字未改），对同一批句子跑两遍，逐句列出变化。
 *
 * 判定标准：
 *   - 变化句应全部落在 D1–D13 登记范围内 → 属于预期修复；
 *   - 出现登记范围外的变化 → 属于回归，必须回退或补进手册。
 *
 * 用法：
 *   node scripts/rule-change-audit.js                  # 用内置示例语料
 *   node scripts/rule-change-audit.js --input <路径>    # 用自己的语料
 *   node scripts/rule-change-audit.js --out report.md
 */

const fs = require('fs');
const path = require('path');
const ifias = require('../lib/ifias.js');
const { DEMO_CORPUS, extractText } = require('./build-annotation-set.js');

const ROOT = path.resolve(__dirname, '..');

/**
 * 修复前的判据（2026-10-30 之前）。故意保留原文，不重构——
 * 一旦「顺手改好」它，这个脚本就失去基线意义。
 */
function OLD_RULE(text) {
  const t = String(text || '');
  const has = (arr) => arr.some((k) => t.indexOf(k) !== -1);

  if (has(['学生说', '生：', '学生答', '学生齐', '全班答', '学生读'])) {
    if (has(['问', '为什么', '是不是'])) return { code: '9.2', reason: '学生提问' };
    return { code: '8', reason: '学生应答' };
  }
  if (has(['小组', '同桌', '讨论一下', '交流一下', '合作'])) return { code: '10', reason: '同伴讨论' };
  if (/[?？]/.test(t) || has(['谁知道', '谁来', '想一想', '说说', '为什么', '怎么样', '你觉得',
    '你来说', '你来讲', '来回答', '说说看', '答一下'])) {
    if (has(['为什么', '怎么样', '说说看', '你觉得', '还能', '想一想', '有什么发现']))
      return { code: '4.1', reason: '开放性提问' };
    return { code: '4.2', reason: '封闭性提问' };
  }
  if (has(['很好', '非常好', '不错', '太棒', '正确', '请坐', '厉害', '有进步']))
    return { code: '2', reason: '表扬鼓励' };
  if (has(['对，就像', '正如刚才', '这位同学说的', '按他说的'])) return { code: '3', reason: '采纳观点' };
  if (has(['别急', '没关系', '我理解', '不要紧张', '慢慢来'])) return { code: '1', reason: '接受情感' };
  if (has(['不许', '怎么又', '安静点', '再说话', '站好', '罚'])) return { code: '7', reason: '批评权威' };
  if (has(['PPT', '投影', '屏幕', '平板', '视频', '看课件', '实验器材']))
    return { code: '13', reason: '技术操作' };
  if (has(['请', '大家', '翻开', '拿出', '一起来', '看黑板', '注意看', '坐好']))
    return { code: '6', reason: '教师指令' };
  if (has(['安静', '停顿', '思考一下', '做练习', '写一写'])) return { code: '12', reason: '教学沉寂' };
  return { code: '5', reason: '教师讲授' };
}

/** 已登记的预期改动：命中的句子必须是「从 D 判据的错值 → 手册值」 */
const EXPECTED = [
  { id: 'D1', test: (t) => /好[，,]\s*(?:是|等于)?\s*\d/.test(t), from: ['2'], to: '3', why: '确认并采纳具体答案' },
  { id: 'D2', test: (t) => /(看|在)(大)?屏幕|看课件/.test(t) && !/打开|播放|切换|点开|操作/.test(t), from: ['13'], to: '6', why: '引导注意≠操作设备' },
  { id: 'D4', test: (t) => /[?？]|想一想|为什么/.test(t) && /因为|所以|也就是说|答案是/.test(t), from: ['4.1', '4.2'], to: '5', why: '设问自答按讲授计' },
  { id: 'D6', test: (t) => /小组|同桌|讨论一下|交流一下|合作/.test(t) && !/^[（(]/.test(t.trim()), from: ['10'], to: '6', why: '教师组织语言是指令' },
  { id: 'D7', test: (t) => /安静|别说话|闭嘴/.test(t) && /听我|我说|别|不许|再说|坐好|大家安静|你们|同学们/.test(t), from: ['12'], to: '7', why: '纪律压制≠沉寂' },
  { id: 'D8', test: (t) => /能不能|可不可以/.test(t) && /解释|说明|证明/.test(t), from: ['4.2'], to: '4.1', why: '解释类答案不唯一' },
  { id: 'D9', test: (t) => /举个例子|例子|有什么关系|有什么区别|什么特点/.test(t), from: ['4.2', '5', '6'], to: '4.1', why: '开放要求' },
  { id: 'D13', test: (t) => /^[（(][^）)]*板书[^）)]*[）)]$/.test(t.trim()), from: ['5'], to: '6', why: '板书是行为要求' },
];

function classify(text, from, to) {
  if (from === to) return null;
  const hit = EXPECTED.find((e) => e.to === to && e.test(text));
  if (hit) return { id: hit.id, why: hit.why, expected: true };
  return { id: null, why: '未登记的变化，需复核是否为回归', expected: false };
}

function loadUnits(input) {
  if (!input) return ifias.splitUnits(DEMO_CORPUS.join('\n'));
  const st = fs.statSync(input);
  const files = st.isFile() ? [input] : fs.readdirSync(input)
    .filter((f) => ['.txt', '.md', '.srt', '.vtt', '.json'].includes(path.extname(f).toLowerCase()))
    .map((f) => path.join(input, f));
  const units = [];
  files.forEach((f) => {
    const text = extractText(fs.readFileSync(f, 'utf8'), path.extname(f).toLowerCase());
    units.push(...ifias.splitUnits(text));
  });
  return units;
}

function main() {
  const argv = process.argv.slice(2);
  const gi = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const input = gi('--input');
  const outPath = gi('--out');

  const units = loadUnits(input);
  const rows = [];
  units.forEach((u) => {
    const before = OLD_RULE(u).code;
    const after = ifias.ruleCodeOne(u).code;
    if (before === after) return;
    rows.push({ text: u, before, after, ...classify(u, before, after) });
  });

  const expectRows = rows.filter((r) => r.expected);
  const regressRows = rows.filter((r) => !r.expected);
  const L = [];
  L.push('# 规则编码器改动影响面');
  L.push('');
  L.push('> 由 `scripts/rule-change-audit.js` 生成。对比修复前判据（内嵌原文）与当前判据，逐句列出变化。');
  L.push('> 语料单元数：**' + units.length + '**；编码发生变化：**' + rows.length + '** 句。');
  L.push('');
  L.push('| 结果 | 句数 |');
  L.push('| :-- | --: |');
  L.push('| 预期修复（落在 D1–D13 登记内） | ' + expectRows.length + ' |');
  L.push('| 未登记的变化（疑似回归） | ' + regressRows.length + ' |');
  L.push('');
  if (rows.length) {
    L.push('## 逐句变化');
    L.push('');
    L.push('| # | 句子 | 原码 | 新码 | 归因 |');
    L.push('| --: | :-- | :-- | :-- | :-- |');
    rows.forEach((r, i) => {
      L.push('| ' + (i + 1) + ' | ' + r.text.replace(/\|/g, '\\|') + ' | ' + r.before + ' | ' + r.after
        + ' | ' + (r.expected ? '**' + r.id + '** ' + r.why : '⚠ ' + r.why) + ' |');
    });
    L.push('');
  } else {
    L.push('两个判据在这批语料上输出完全一致。');
    L.push('');
  }
  if (regressRows.length) {
    L.push('## 需要复核的句子');
    L.push('');
    L.push('下列变化不在登记范围内。要么补进手册第 9 节，要么把判据改回去：');
    L.push('');
    regressRows.forEach((r) => L.push('- 「' + r.text + '」 ' + r.before + ' → ' + r.after));
    L.push('');
  }

  const md = L.join('\n');
  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), md, 'utf8');
    console.log('报告已写入：' + outPath);
  } else {
    console.log(md);
  }
  // 有回归时以非零码退出，便于 CI 拦住
  if (regressRows.length) process.exitCode = 4;
}

if (require.main === module) main();
module.exports = { OLD_RULE, classify, EXPECTED };
